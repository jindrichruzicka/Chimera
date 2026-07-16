/**
 * Spectator mode — end-to-end.
 * §13 E2E Testing (Playwright) · §4.14 Multiplayer Provider · §4.6 State Projection
 *
 * Proves the spectator flow end-to-end across two isolated Electron processes on
 * a dedicated port. Each test hosts a two-seat match (one human host + one AI
 * seat), then launches a second process that joins the RUNNING match:
 *
 *   1. Admit-as-spectator + followed view + perspective switch — with the host's
 *      "Allow spectators" toggle ON, the joiner is admitted as a read-only
 *      spectator (Invariant #114), receives a seated player's projected board
 *      (never GameSnapshot — Invariants #3 / #8), sees the read-only HUD with
 *      controls locked and no host-only save, and the Tab hotkey re-points the
 *      followed seat out-of-band (Invariant #115).
 *   2. spectators_disabled — with the toggle OFF, a mid-match join is rejected;
 *      the game DOES declare the capability, so the reason is `spectators_disabled`.
 *   3. match_in_progress — with the manifest capability forced absent (the
 *      `disableSpectators` e2e seam — only tactics is wired for e2e matches), a
 *      mid-match join is rejected as `match_in_progress`.
 *
 * Why host + AI (not host + human client): every e2e process boots the same
 * default profile namespace (`local-default`), so a SECOND human joiner collides
 * on the profile gate before ever reaching the spectator classifier. A lone AI
 * seat gives two seats to follow while keeping the spectator the only human
 * joiner. The dedicated port keeps the file from colliding with the many
 * port-7779 fixture specs under `workers: 2` (separate files run on separate
 * workers). The reject reason survives the IPC boundary as the join error
 * message (surfaced in the `lobby-error` banner), so each negative case asserts
 * its exact reason.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { launchE2eElectronApplication } from '../fixtures/electron.fixture';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';

// Dedicated to this file — no other spec binds it, so the two processes never
// contend with a concurrently-scheduled fixture spec on the shared port 7779.
const SPECTATOR_PORT = '7793';

interface StartedMatch {
    readonly hostApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly lobbyCode: string;
    /** The human host's seat id — one of the two seats a spectator can follow. */
    readonly hostId: string;
}

async function bootWindow(app: ElectronApplication): Promise<Page> {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    return window;
}

/**
 * Launch a single human host, seat one AI, and drive the lobby to a started
 * two-seat match. When `allowSpectators` is set the host flips the reserved
 * toggle BEFORE Start, so it rides into the running match via `snapshot.setup`
 * (Invariant #101) where the join classifier reads it. `disableSpectators`
 * forces the host's manifest capability absent for the no-capability reject path.
 */
async function startHostPlusAiMatch(options: {
    readonly allowSpectators: boolean;
    readonly disableSpectators?: boolean;
}): Promise<StartedMatch> {
    const hostApp = await launchE2eElectronApplication({
        port: SPECTATOR_PORT,
        role: 'host',
        initialRoute: '/lobby',
        ...(options.disableSpectators === true ? { disableSpectators: true } : {}),
    });
    const hostWindow = await bootWindow(hostApp);
    const hostLobby = new TacticsLobbyPage(hostWindow);

    await hostLobby.hostLobby();
    const lobbyCode = await hostLobby.lobbyCode();

    if (options.allowSpectators) {
        await hostLobby.enableSpectators();
        await hostLobby.expectSpectatorsEnabled(true);
    }

    // Host + one AI = two seats, one human — so the later human spectator is the
    // sole human joiner and never collides on the default e2e profile namespace.
    await hostLobby.addAi();
    await hostLobby.expectAiCount(1);

    await hostLobby.toggleReady();
    await expect(hostLobby.startButton).toBeEnabled({ timeout: 20_000 });
    await hostLobby.startButton.click();

    const hostGame = new GamePage(hostWindow);
    await expect(hostGame.canvas).toBeVisible({ timeout: 20_000 });

    const hostId = await hostLobby.localPlayerId();
    if (hostId === null) {
        throw new Error('Could not resolve the host player id.');
    }

    return { hostApp, hostWindow, lobbyCode, hostId };
}

async function closeMatch(match: StartedMatch | null): Promise<void> {
    await match?.hostApp.close().catch(() => undefined);
}

/** The local session role as the authoritative main process reports it. */
async function readLocalRole(window: Page): Promise<string> {
    return window.evaluate(() => {
        const lobby = (
            globalThis as {
                readonly __chimera?: {
                    readonly lobby?: { readonly getLocalRole?: () => Promise<string> };
                };
            }
        ).__chimera?.lobby;
        if (typeof lobby?.getLocalRole !== 'function') {
            return 'unknown';
        }
        return lobby.getLocalRole();
    });
}

test.describe('Spectator mode', () => {
    test('admits a mid-match join as a read-only spectator and switches the followed seat', async () => {
        let match: StartedMatch | null = null;
        let spectatorApp: ElectronApplication | null = null;
        try {
            match = await startHostPlusAiMatch({ allowSpectators: true });

            spectatorApp = await launchE2eElectronApplication({
                port: SPECTATOR_PORT,
                role: 'client',
                initialRoute: '/lobby',
            });
            const spectatorWindow = await bootWindow(spectatorApp);
            const spectatorLobby = new LobbyPage(spectatorWindow);
            const spectatorGame = new GamePage(spectatorWindow);

            // Join the RUNNING match. A spectator is pushed the followed seat's
            // projection immediately, carrying it straight to /game — so do not
            // wait for the lobby screen (attemptJoin, not joinLobby).
            await spectatorLobby.attemptJoin(match.lobbyCode);

            // Admitted as a spectator at the authoritative IPC seam (Invariant #114).
            await expect
                .poll(() => readLocalRole(spectatorWindow), { timeout: 20_000 })
                .toBe('spectator');

            // Receives a seated player's board and the read-only HUD.
            await expect(spectatorGame.canvas).toBeVisible({ timeout: 20_000 });
            await expect(spectatorWindow.getByTestId('spectator-hud')).toBeVisible();

            // Read-only: action controls are locked and the host-only save is withheld.
            await expect(spectatorGame.undoButton).toBeDisabled();
            await expect(spectatorGame.redoButton).toBeDisabled();
            await expect(spectatorGame.endTurnButton).toBeDisabled();
            await expect(spectatorGame.saveButton).toHaveCount(0);

            // Follows one seated player (never its own id — it is not seated).
            const followedBefore = await spectatorGame.projectedViewerId();
            expect(followedBefore).toBeTruthy();

            // Switch perspective with the Tab hotkey (engine:spectate-cycle). The
            // switch is out-of-band (Invariant #115): the host re-points and
            // pushes the newly-followed seat's projection, so poll until the
            // projected viewerId flips to the other seat.
            await spectatorWindow.keyboard.press('Tab');
            await expect
                .poll(() => spectatorGame.projectedViewerId(), { timeout: 15_000 })
                .not.toBe(followedBefore);

            const followedAfter = await spectatorGame.projectedViewerId();
            // Two seats (host + AI) → the follow cycles between them, one of which
            // is the human host; the read-only HUD stays visible throughout.
            expect([followedBefore, followedAfter]).toContain(match.hostId);
            await expect(spectatorWindow.getByTestId('spectator-hud')).toBeVisible();
        } finally {
            await spectatorApp?.close().catch(() => undefined);
            await closeMatch(match);
        }
    });

    test('rejects a mid-match join as spectators_disabled when the host left the toggle off', async () => {
        let match: StartedMatch | null = null;
        let joinerApp: ElectronApplication | null = null;
        try {
            match = await startHostPlusAiMatch({ allowSpectators: false });

            joinerApp = await launchE2eElectronApplication({
                port: SPECTATOR_PORT,
                role: 'client',
                initialRoute: '/lobby',
            });
            const joinerWindow = await bootWindow(joinerApp);
            const joinerLobby = new LobbyPage(joinerWindow);
            const joinerGame = new GamePage(joinerWindow);

            await joinerLobby.attemptJoin(match.lobbyCode);

            // Capability present, toggle off ⇒ spectators_disabled (Invariant #114).
            await expect(joinerLobby.errorBanner).toContainText('spectators_disabled', {
                timeout: 20_000,
            });
            // Never enters the board — no phantom seat, no hang.
            await expect(joinerGame.canvas).toHaveCount(0);
        } finally {
            await joinerApp?.close().catch(() => undefined);
            await closeMatch(match);
        }
    });

    test('rejects a mid-match join as match_in_progress when the game declares no spectator capability', async () => {
        let match: StartedMatch | null = null;
        let joinerApp: ElectronApplication | null = null;
        try {
            // The manifest capability is forced absent, so the reject reason is
            // match_in_progress regardless of the toggle (Invariant #114).
            match = await startHostPlusAiMatch({ allowSpectators: false, disableSpectators: true });

            joinerApp = await launchE2eElectronApplication({
                port: SPECTATOR_PORT,
                role: 'client',
                initialRoute: '/lobby',
            });
            const joinerWindow = await bootWindow(joinerApp);
            const joinerLobby = new LobbyPage(joinerWindow);
            const joinerGame = new GamePage(joinerWindow);

            await joinerLobby.attemptJoin(match.lobbyCode);

            await expect(joinerLobby.errorBanner).toContainText('match_in_progress', {
                timeout: 20_000,
            });
            await expect(joinerGame.canvas).toHaveCount(0);
        } finally {
            await joinerApp?.close().catch(() => undefined);
            await closeMatch(match);
        }
    });
});
