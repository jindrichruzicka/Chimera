/**
 * F68 — save-restore-multiplayer.spec.ts (issue #830)
 * §13 E2E Testing (Playwright) · §4.11 Save/Load & Persistence · §4.14 Multiplayer Provider
 *
 * Covers the multiplayer save → restore lifecycle across two Electron
 * processes (host + client) on dedicated port 7789:
 *   1. Host menu (?gameId=tactics) → New Game → host lobby; client joins via
 *      the lobby code; both ready → start.
 *   2. Host moves a unit; record host stamina/grid + client grid. The client
 *      HUD exposes no save button (Invariant #25 — host-only save).
 *   3. Host saves via the HUD modal; capture the saved slot + tick. (The HUD
 *      save names only the LABEL — SessionRuntime.captureSaveFile defaults
 *      the slot to `autosave`, so the manual save and the end-turn autosave
 *      share one slot and the saves screen always shows exactly one row.)
 *   4. Client departs (relaunch config captured first so the later relaunch
 *      reuses the same --user-data-dir; the session ticket survives there).
 *   5. Host 3-step leave to the menu → Load Game → load the row. The restored
 *      roster has a missing REMOTE seat, so the coordinator parks in
 *      waiting-for-players: `waiting-for-players-modal` + join code appear.
 *      The restored snapshot broadcasts immediately, so the host hops
 *      /saves → /game and the restored board renders UNDER the overlay —
 *      that mid-restore hop is by design (#828: the overlay is mounted
 *      app-wide precisely to survive it).
 *   6. Client relaunches (boots back to /lobby) and rejoins through the real
 *      join-code UI. Seat reclaim rides the persisted session-ticket claims:
 *      LobbyManager.resolveJoinClaims injects {matchId, playerId} from
 *      <userData>/session-tickets.json — no env override involved. The
 *      restored session auto-starts on the last rejoin: overlay dismisses,
 *      the relaunched client keeps its original PlayerId, the host keeps the
 *      saved host id, tick equals the saved tick, and both windows'
 *      viewer-scoped grids match the step-2 values (matching grids on both
 *      windows simultaneously prove the seats).
 *   7. Ownership proof: host moves + ends turn; the client sees "Your turn"
 *      and moves — moveOwnedUnitToOpenTile only selects units with
 *      ownerId === viewerId, so success is the proof.
 *   8. Abort coverage — Cancel: host leaves the resumed match, menu-loads the
 *      save again (the missing client parks it in waiting), and Cancel
 *      dismisses the overlay, unwinds the hosted session (board unmounts),
 *      shows the "Restore cancelled" toast, and lands the host back on the
 *      /saves screen with ?gameId preserved (#842).
 *   9. Abort coverage — Escape, in the SAME host instance: the post-cancel
 *      /saves screen is live (no #843 snapshot-cache bounce back to the dead
 *      /game), so the next load starts right from it; Escape aborts through
 *      the identical handleClose path and lands on /saves again. Staying
 *      in-process is deliberate — it is the regression proof for #842/#843,
 *      which used to wedge the instance until an app restart.
 *
 * CRITICAL — no `end-turn` before the step-3 slot/tick reads and the step-5/8
 * row-count assertions consume them. Autosave fires after every successful
 * engine:end_turn (HostSessionPipeline) and overwrites the shared `autosave`
 * slot, clobbering the captured `__e2eHooks.lastSavedSlotId`/`lastSavedTick`.
 * The step-7 end-turn is safe: every read that depends on the manual save
 * happens before it (step 8 only needs SOME multiplayer save in the slot).
 *
 * The reconnect.spec.ts `CHIMERA_E2E_RECONNECT_PLAYER_ID` env is deliberately
 * NOT used: it drives the live-session `reconnectPlayerId` path, which the
 * provider honors only for identities that connected during the current live
 * session — never for merely-seeded restored seats. Restored seats are
 * reclaimable exclusively through matchId-proof ticket claims, which is the
 * production path this spec exercises. The rejoin is isolated in
 * `rejoinRestoredLobby` so the mechanism stays swappable in one place.
 *
 * Invariants upheld:
 *   #25    — only the host loads; the client re-enters via reconnect, never a
 *            client-side load. The client HUD renders no save affordance.
 *   #59/60 — seat reclaim relies on opaque ids (ticket/claims), never profile
 *            data; tickets never cross IPC.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from '../fixtures/electron.fixture';
import { getLastSavedSlotId, getLastSavedTick, getSimulationTick } from '../helpers/ipc-spy';
import { readyAndStart } from '../helpers/lobby-match';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { GamePage } from '../pages/GamePage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { SavesPage } from '../pages/SavesPage';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';

// ─── Timing ──────────────────────────────────────────────────────────────────
// CI runs ~an order slower than local: canvas ops cost 6-11s and cross-process
// hops several seconds. Never wrap the GamePage move helpers in shorter expect
// timeouts — they carry their own generous internal budgets.

const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;
/** Waiting overlay appearance: coordinator sanitize + re-host + re-seat. */
const OVERLAY_TIMEOUT_MS = 30_000;
/** Relaunch + rejoin + deferred start + snapshot broadcast on both peers. */
const RESTORE_TIMEOUT_MS = 60_000;
/**
 * Whole-spec budget. `test.slow()`'s 3× (270s) is too tight for two Electron
 * boots + a client relaunch + three load-until-waiting cycles.
 */
const SPEC_TIMEOUT_MS = 360_000;

const SAVE_LABEL = 'mp-save';

// ─── Fixture ─────────────────────────────────────────────────────────────────

/**
 * Dedicated port for this spec; does not collide with base (7778), lobby/game
 * (7779), save-load (7785), save-load-ui (7786), or settings (7787/7788) under
 * `workers: 2`.
 */
const MP_SAVE_PORT = '7789';

interface MpSaveFixtures {
    readonly hostApp: ElectronApplication;
    readonly clientApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly clientWindow: Page;
}

const test = electronTest.extend<MpSaveFixtures>({
    // Host boots the menu (no directGameRole) so the spec drives hosting
    // through the real UI. The gameId query is applied in-body via
    // MainMenuPage.goto — the fixture's initialRoute cannot carry a query
    // (it appends a trailing slash that would corrupt the value).
    // eslint-disable-next-line no-empty-pattern
    hostApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: MP_SAVE_PORT,
            role: 'host',
            initialRoute: '/main-menu',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    // The client is closed mid-test (the "comes back later" scenario), so
    // teardown tolerates an already-closed app.
    // eslint-disable-next-line no-empty-pattern
    clientApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: MP_SAVE_PORT,
            role: 'client',
            initialRoute: '/lobby',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    hostWindow: async ({ hostApp }, use) => {
        const window = await hostApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },

    clientWindow: async ({ clientApp }, use) => {
        const window = await clientApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

type E2eFirstPlayer = 'host' | 'client';

/**
 * Pin the first turn to the host before the lobby is created (copied from
 * game.fixture.ts, which keeps it module-private). The host must both own the
 * save and hold the turn at save time so the restored turnClock proves itself
 * in step 7.
 */
async function configureFirstPlayer(
    hostApp: ElectronApplication,
    firstPlayer: E2eFirstPlayer,
): Promise<void> {
    await hostApp.evaluate((_electron, role: E2eFirstPlayer) => {
        type E2eHookGlobal = typeof globalThis & {
            __e2eHooks?: { firstPlayerRole: E2eFirstPlayer };
        };
        const hooks = (globalThis as E2eHookGlobal).__e2eHooks;
        if (hooks === undefined) {
            throw new Error('CHIMERA_E2E hooks are not available in the host process');
        }
        hooks.firstPlayerRole = role;
    }, firstPlayer);
}

interface RendererLobbyState {
    readonly players: readonly { readonly playerId: string }[];
}

interface RendererChimeraBridge {
    readonly lobby: {
        getCurrentState(): Promise<RendererLobbyState | null>;
        getLocalPlayerId(): Promise<string | null>;
    };
}

type RendererGlobal = typeof globalThis & { readonly __chimera: RendererChimeraBridge };

async function requirePlayerId(lobby: TacticsLobbyPage, label: string): Promise<string> {
    const id = await lobby.localPlayerId();
    if (id === null) {
        throw new Error(`${label} local player ID was not available`);
    }
    return id;
}

async function connectedPlayerIds(page: Page): Promise<readonly string[]> {
    return page.evaluate(async () => {
        const state = await (globalThis as RendererGlobal).__chimera.lobby.getCurrentState();
        return state?.players.map((entry) => entry.playerId) ?? [];
    });
}

/**
 * Host 3-step leave back to the tactics main menu: Escape menu → confirm leave
 * (host returns to the active lobby), leave the lobby (→ pre-lobby entry),
 * Close (→ main menu). Polls the menu labels so the shell is fully loaded.
 */
async function leaveMatchToMainMenu(
    inGameMenu: InGameMenuPage,
    lobby: TacticsLobbyPage,
    menu: MainMenuPage,
): Promise<void> {
    await inGameMenu.openViaEscape();
    await inGameMenu.confirmLeave();
    await expect(lobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    await lobby.leaveLobby();
    await lobby.closeButton.click();
    await expect
        .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
        .toContain('Load Game');
}

/**
 * Menu → Load Game → the (single) save row: kick off a restore of the saved
 * multiplayer session and wait for the waiting-for-players overlay. Returns
 * the join code shown by the overlay. Every load re-hosts a fresh lobby, so
 * the code is only valid for this overlay instance.
 */
async function loadSaveUntilWaiting(
    menu: MainMenuPage,
    saves: SavesPage,
    hostWindow: Page,
): Promise<string> {
    await expect
        .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
        .toContain('Load Game');
    await menu.loadGameButton.click();
    return loadRowUntilWaiting(saves, hostWindow);
}

/**
 * The tail of `loadSaveUntilWaiting`, starting from an already-open /saves
 * screen — the post-abort re-load (step 9) begins right where the #842
 * cancel navigation landed.
 */
async function loadRowUntilWaiting(saves: SavesPage, hostWindow: Page): Promise<string> {
    await expect(saves.pageRoot).toBeVisible();
    // The HUD save and the end-turn autosave share the `autosave` slot, so
    // the list holds exactly one row throughout the spec.
    expect(await saves.rowCount()).toBe(1);
    await saves.loadFirstSave();
    await expect(hostWindow.getByTestId('waiting-for-players-modal')).toBeVisible({
        timeout: OVERLAY_TIMEOUT_MS,
    });
    return readJoinCode(hostWindow);
}

/** `Join code: X` → `X`, asserted non-empty. */
async function readJoinCode(hostWindow: Page): Promise<string> {
    const caption = await hostWindow.getByTestId('waiting-join-code').innerText();
    const code = caption.replace(/^Join code:\s*/u, '').trim();
    expect(code).not.toBe('');
    return code;
}

/**
 * Rejoin the restored lobby through the real join-code UI — THE seat-reclaim
 * seam. The reclaim mechanism is the persisted session-ticket claim (the
 * relaunch reuses the client's userData dir, so session-tickets.json
 * survives); if that mechanism ever changes, swap it here in one place.
 *
 * Uses attemptJoin (submit without waiting for the lobby screen): the
 * restored session auto-starts the moment the last missing seat rejoins, so
 * the client's lobby screen can flash and vanish before an assertion lands.
 * The caller asserts on the game canvas instead.
 */
async function rejoinRestoredLobby(clientWindow: Page, joinCode: string): Promise<void> {
    const lobby = new TacticsLobbyPage(clientWindow);
    await lobby.waitForPreLobbyScreen();
    await lobby.attemptJoin(joinCode);
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Save / restore — multiplayer', () => {
    test('host saves, both leave, menu-load waits for the client, ticket reclaim resumes both seats', async ({
        hostApp,
        clientApp,
        hostWindow,
        clientWindow,
    }) => {
        test.setTimeout(SPEC_TIMEOUT_MS);

        const menu = new MainMenuPage(hostWindow);
        const hostLobby = new TacticsLobbyPage(hostWindow);
        const clientLobby = new TacticsLobbyPage(clientWindow);
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        const inGameMenu = new InGameMenuPage(hostWindow);
        const saves = new SavesPage(hostWindow);
        const waitingModal = hostWindow.getByTestId('waiting-for-players-modal');

        // 1. Host menu → New Game → host lobby; client joins; ready → start.
        await configureFirstPlayer(hostApp, 'host');
        await menu.goto({ gameId: 'tactics' });
        await expect
            .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('New Game');
        await menu.clickButtonByLabel('New Game');
        await expect(hostWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
        await hostLobby.hostLobby();
        const originalLobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(originalLobbyCode);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        const hostId = await requirePlayerId(hostLobby, 'Host');
        const clientId = await requirePlayerId(clientLobby, 'Client');

        // 2. Host moves a unit; record the state the restore must reproduce.
        //    Each window's projection is viewer-scoped, so the grids recorded
        //    here identify the seats, not just the board.
        await expect
            .poll(() => hostGame.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('Your turn');
        await hostGame.moveOwnedUnitToOpenTile();
        const hostStamina = await hostGame.staminaText();
        const hostGrid = await hostGame.localUnitGrid();
        const clientGrid = await clientGame.localUnitGrid();

        // Host-only save affordance (Invariant #25): the host HUD shows the
        // save button, the client HUD renders none at all.
        await expect(hostGame.saveButton).toBeVisible();
        await expect(clientWindow.getByTestId('hud-save-btn')).toHaveCount(0);

        // 3. Host saves through the HUD modal; capture the saved slot + tick.
        await hostGame.saveGame(SAVE_LABEL);
        await expect.poll(() => getLastSavedSlotId(hostApp), { timeout: 30_000 }).not.toBeNull();
        const savedTick = await getLastSavedTick(hostApp);
        expect(savedTick).not.toBeNull();

        // 4. Client departs — capture the relaunch config first so the later
        //    relaunch reuses the same userData dir (surviving session ticket)
        //    and boots back to /lobby via the surviving CHIMERA_E2E_INITIAL_URL.
        const clientRelaunchConfig = await captureRelaunchConfig(clientApp);
        await clientApp.close();
        await expect
            .poll(() => connectedPlayerIds(hostWindow), { timeout: NAV_TIMEOUT_MS })
            .not.toContain(clientId);

        // 5. Host leaves to the menu, menu-loads the save: the missing remote
        //    seat parks the restore in waiting-for-players. The restored
        //    snapshot broadcasts immediately, so the host hops /saves → /game
        //    and the restored board renders under the overlay (#828 design).
        await leaveMatchToMainMenu(inGameMenu, hostLobby, menu);
        const joinCode = await loadSaveUntilWaiting(menu, saves, hostWindow);
        await expect(
            hostWindow.getByRole('status', { name: 'Waiting for players to reconnect' }),
        ).toBeVisible();
        await expect(hostGame.canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 6. Client relaunches and rejoins through the real join-code UI;
        //    the persisted session ticket reclaims its original seat and the
        //    deferred start fires once the roster completes.
        const relaunchedClientApp = await relaunchElectronApplication(clientRelaunchConfig, {
            CHIMERA_ROLE: 'client',
        });
        try {
            const relaunchedClientWindow = await relaunchedClientApp.firstWindow();
            await relaunchedClientWindow.waitForLoadState('domcontentloaded');
            await rejoinRestoredLobby(relaunchedClientWindow, joinCode);

            await expect(waitingModal).toBeHidden({ timeout: RESTORE_TIMEOUT_MS });
            await expect(hostGame.canvas).toBeVisible({ timeout: RESTORE_TIMEOUT_MS });
            const relaunchedClientGame = new GamePage(relaunchedClientWindow);
            await expect(relaunchedClientGame.canvas).toBeVisible({
                timeout: RESTORE_TIMEOUT_MS,
            });

            // Seat reclaim: the relaunched client keeps its original PlayerId
            // (ticket claim), the host keeps the saved host id.
            const relaunchedClientLobby = new TacticsLobbyPage(relaunchedClientWindow);
            await expect
                .poll(() => relaunchedClientLobby.localPlayerId(), { timeout: NAV_TIMEOUT_MS })
                .toBe(clientId);
            expect(await requirePlayerId(hostLobby, 'Restored host')).toBe(hostId);

            // State parity: tick, stamina, and both viewer-scoped grids equal
            // the step-2/3 values.
            await expect
                .poll(() => getSimulationTick(hostApp), { timeout: RESTORE_TIMEOUT_MS })
                .toBe(savedTick);
            await expect
                .poll(() => hostGame.staminaText(), { timeout: NAV_TIMEOUT_MS })
                .toBe(hostStamina);
            expect(await hostGame.localUnitGrid()).toEqual(hostGrid);
            await expect
                .poll(() => relaunchedClientGame.localUnitGrid(), { timeout: NAV_TIMEOUT_MS })
                .toEqual(clientGrid);

            // 7. Ownership proof — both players act on their original seats.
            //    The restored turnClock still holds the host's turn (the host
            //    moved but never ended the turn before saving). The end-turn
            //    autosave overwrites the shared slot — safe, every read of the
            //    manual save already happened.
            await expect
                .poll(() => hostGame.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
                .toBe('Your turn');
            await hostGame.moveOwnedUnitToOpenTile();
            await hostGame.endTurnButton.click();
            await expect
                .poll(() => relaunchedClientGame.turnStatusText(), { timeout: 30_000 })
                .toBe('Your turn');
            // moveOwnedUnitToOpenTile only selects units with
            // ownerId === viewerId — success proves the reclaimed seat acts.
            await relaunchedClientGame.moveOwnedUnitToOpenTile();
        } finally {
            await relaunchedClientApp.close();
        }

        // 8. Abort coverage — Cancel. With the client gone again, re-loading
        //    the save parks in waiting; Cancel dismisses the overlay, unwinds
        //    the hosted session (the restored board unmounts), toasts, and
        //    lands the host back on /saves with ?gameId preserved (#842).
        await expect
            .poll(() => connectedPlayerIds(hostWindow), { timeout: NAV_TIMEOUT_MS })
            .not.toContain(clientId);
        await leaveMatchToMainMenu(inGameMenu, hostLobby, menu);
        await loadSaveUntilWaiting(menu, saves, hostWindow);
        await hostWindow.getByTestId('waiting-cancel').click();
        await expect(waitingModal).toBeHidden();
        await expect(hostWindow.getByText('Restore cancelled')).toBeVisible();
        await expect(hostWindow).toHaveURL(/\/saves\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await expect(saves.pageRoot).toBeVisible();
        await expect(hostWindow.getByTestId('game-canvas')).toHaveCount(0, {
            timeout: NAV_TIMEOUT_MS,
        });

        // 9. Abort coverage — Escape, same host instance (the #842/#843
        //    regression proof: this in-process re-load used to bounce into a
        //    dead /game). Wait out the step-8 toast (info toasts expire after
        //    4s) so the post-Escape toast assertion is unambiguous.
        await expect(hostWindow.getByText('Restore cancelled')).toBeHidden({
            timeout: NAV_TIMEOUT_MS,
        });
        await loadRowUntilWaiting(saves, hostWindow);
        await hostWindow.keyboard.press('Escape');
        await expect(waitingModal).toBeHidden();
        await expect(hostWindow.getByText('Restore cancelled')).toBeVisible();
        await expect(hostWindow).toHaveURL(/\/saves\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await expect(saves.pageRoot).toBeVisible();
        await expect(hostWindow.getByTestId('game-canvas')).toHaveCount(0, {
            timeout: NAV_TIMEOUT_MS,
        });
    });
});
