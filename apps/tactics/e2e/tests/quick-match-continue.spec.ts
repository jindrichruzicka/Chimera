/**
 * F87 — quick-match-continue.spec.ts
 * §4.37 Renderer Shell Pages UI Contract · §13 E2E Testing (Playwright)
 *
 * The two lobby-less match entries the tactics menu contributes, end to end on
 * the packaged-equivalent build, plus the classic lobby flow beside them —
 * because "both flows coexist" is the claim, and a spec that exercised only the
 * new one could not see the old one break.
 *
 * Driven entirely through the SHIPPED UI. In particular Quick Match is clicked,
 * so the real `chimera:lobby:quick-start` verb runs on its only production path;
 * the `CHIMERA_E2E` direct-game latch is deliberately not used here, since a
 * spec that booted straight into a match would leave the verb untested.
 *
 * What each test proves:
 *   1. A fresh profile offers Quick Match and holds Continue DISABLED — there
 *      is nothing to continue, and the engine gate answers that, not the game.
 *   2. Quick Match → match: the window never visits `/lobby` (URL trace, not a
 *      sampled URL), no lobby screen ever mounts, and the entry is sequenced
 *      behind an opaque screen rather than jumped. Leaving that session lands
 *      on `/main-menu`, NOT on a lobby it never had. Continue is then enabled,
 *      restores the board as it was before the leave, and leaving the RESTORED
 *      session still lands on the main menu — the session-mode stamp survived
 *      the round trip through the save file.
 *   3. New Game still opens the lobby, and a lobby-born session still returns
 *      to its lobby on Leave.
 *
 * CRITICAL — never click `end-turn` in this spec. Autosave fires after every
 * successful `engine:end_turn`, so an end-turn would write an autosave at a
 * board state the spec never recorded — and the AI seat would then take its own
 * turn on top of it. The Continue leg would restore that board instead of the
 * one it captured, and the mismatch would read as a broken restore.
 *
 * Invariants exercised end to end:
 *   #99/#101 — the quick start authors game params as the host and seat
 *      attributes as the seat owner, and both ride into `snapshot.setup`; the
 *      engine-owned `engine.sessionMode` stamp travels with them, which is what
 *      the second leave in test 2 reads after a restore.
 *   #108 — Continue rides the existing `saves:load` restore funnel; nothing
 *      here calls a restore path of its own.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from '../fixtures/electron.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { waitForGameRevealed } from '../helpers/lobby-match';
import {
    durationWhere,
    installRevealTimeline,
    readRevealTimeline,
} from '../helpers/reveal-timeline';
import { installRouteTrace, readRouteTrace, visitedRoutePaths } from '../helpers/route-trace';
import { GamePage } from '../pages/GamePage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { TacticsLobbyPage } from '../pages/TacticsLobbyPage';

// ─── Timing ──────────────────────────────────────────────────────────────────
// CI runs ~an order slower than local: canvas ops cost seconds and cross-screen
// hops several more. Never wrap the GamePage move helpers in shorter expect
// timeouts — they carry their own generous internal budgets.

const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;
/** Budget for the whole `chimera:lobby:quick-start` sequence, plus the reveal. */
const QUICK_START_TIMEOUT_MS = 60_000;
/** Menu-restore budget: coordinator re-hosts + re-seats + applies checkpoint. */
const RESTORE_TIMEOUT_MS = 60_000;

// ─── Fixture ─────────────────────────────────────────────────────────────────

/**
 * Dedicated port for this spec: it HOSTS lobbies (the quick start binds one,
 * and so does the New Game test), so it cannot share the base fixture's 7778
 * with the specs that only browse shell screens.
 */
const QUICK_MATCH_PORT = '7796';

interface QuickMatchFixtures {
    readonly quickMatchApp: ElectronApplication;
    readonly quickMatchWindow: Page;
}

const test = electronTest.extend<QuickMatchFixtures>({
    // eslint-disable-next-line no-empty-pattern
    quickMatchApp: async ({}, use) => {
        // Menu boot: no directGameRole/passAndPlay. Every launch gets a fresh
        // user-data dir, which is what makes "a fresh profile has no autosave"
        // a fact about the app rather than about test order.
        const app = await launchE2eElectronApplication({
            port: QUICK_MATCH_PORT,
            initialRoute: '/main-menu',
        });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    quickMatchWindow: async ({ quickMatchApp }, use) => {
        const window = await quickMatchApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Open the tactics main menu and wait for the game's own shell to render it. */
async function openTacticsMenu(window: Page): Promise<MainMenuPage> {
    const menu = new MainMenuPage(window);
    await menu.goto({ gameId: 'tactics' });
    await expect
        .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
        .toContain('Quick Match');
    return menu;
}

/** Wait until a match has actually been entered AND revealed on this window. */
async function waitForRevealedMatch(window: Page, timeout: number): Promise<void> {
    await expect(new GamePage(window).canvas).toBeVisible({ timeout });
    await waitForGameRevealed(window);
}

/** Escape → Leave battle, through the game's own in-game menu. */
async function leaveThroughInGameMenu(window: Page): Promise<void> {
    const inGameMenu = new InGameMenuPage(window);
    await inGameMenu.openViaEscape();
    await inGameMenu.confirmLeave();
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Tactics Quick Match and Continue (§4.37)', () => {
    test('a fresh profile offers Quick Match and holds Continue disabled', async ({
        quickMatchWindow,
    }) => {
        const menu = await openTacticsMenu(quickMatchWindow);

        // Both entries are on the menu the game contributed…
        await expect(menu.quickMatchButton).toBeVisible();
        await expect(menu.continueButton).toBeVisible();
        // …and the engine's own availability gate answers for Continue: this
        // profile has never saved, so there is nothing to resume. The tactics
        // definition declares no `disabled` for it at all, so a Continue that
        // rendered enabled here would mean the engine gate never ran.
        await expect(menu.continueButton).toBeDisabled();
        await expect(menu.quickMatchButton).toBeEnabled();
    });

    test('Quick Match plays, leaves to the main menu, and Continue restores the same match', async ({
        quickMatchApp,
        quickMatchWindow,
    }) => {
        test.slow();

        const menu = await openTacticsMenu(quickMatchWindow);
        const game = new GamePage(quickMatchWindow);
        const lobby = new TacticsLobbyPage(quickMatchWindow);

        // Armed on the menu, before the click: both instruments record from
        // inside the page, because what they measure — a route passed THROUGH,
        // a screen held black — has already ended by the time an out-of-process
        // assertion could look. Both survive a client-side push, and every hop
        // below is one.
        await installRouteTrace(quickMatchWindow);
        await installRevealTimeline(quickMatchWindow);

        // ── 1. Quick Match → a live match, with no lobby anywhere on the way ──
        await menu.startQuickMatch();
        await waitForRevealedMatch(quickMatchWindow, QUICK_START_TIMEOUT_MS);
        await expect(quickMatchWindow).toHaveURL(/\/game\/?\?gameId=tactics$/);

        const entryTrace = await readRouteTrace(quickMatchWindow);
        // The whole journey, not a sampled endpoint: a lobby entered and left
        // within one commit would still be in this list.
        expect(visitedRoutePaths(entryTrace), `route trace: ${JSON.stringify(entryTrace)}`).toEqual(
            ['/main-menu', '/game'],
        );
        // And the game context rode every hop — a dropped `?gameId=` lands the
        // player on the engine-default menu on the way back out.
        expect(entryTrace.every((url) => url.includes('gameId=tactics'))).toBe(true);
        // The route trace above is what proves the lobby was never passed
        // through; this is the weaker present-tense read beside it — no lobby
        // chrome is on the page now, over a `/game` the window reached without
        // one.
        await expect(lobby.lobbyScreen).toHaveCount(0);

        // The entry was sequenced behind an opaque screen rather than jumped,
        // in two halves. Half one: the shell mounted while the app-level scrim
        // was still at full opacity. Read off the recorded INLINE opacity —
        // `toBeVisible` ignores opacity entirely, and this build collapses the
        // fade durations to zero, so the state is a commit, not a wall-clock
        // window.
        const timeline = await readRevealTimeline(quickMatchWindow);
        const context = `reveal timeline: ${JSON.stringify(timeline)}`;
        const heldMs = durationWhere(
            timeline,
            (sample) => sample.canvasMounted && sample.screenFadeOpacity === '1',
        );
        expect(heldMs, context).toBeGreaterThan(0);
        // Half two: it was revealed AFTER that, and not from the mount. The
        // `waitForGameRevealed` above proves the reveal happened; only the
        // recorded phase order proves it came second, which is the difference
        // between a sequenced entry and a jumped one.
        const phases = timeline.samples
            .map((sample) => sample.revealPhase)
            .filter((phase): phase is string => phase !== null);
        expect(phases, context).toContain('covered');
        expect(phases.indexOf('covered'), context).toBeLessThan(phases.indexOf('revealed'));

        // ── 2. Play one move; this is the board fact the restore must return ──
        await expect
            .poll(() => game.turnStatusText(), { timeout: NAV_TIMEOUT_MS })
            .toBe('Your turn');
        const gridAtStart = await game.localUnitGrid();
        const staminaAtStart = await game.staminaText();
        const tickAtStart = await getSimulationTick(quickMatchApp);
        await game.moveOwnedUnitToOpenTile();
        const gridBeforeLeave = await game.localUnitGrid();
        const staminaBeforeLeave = await game.staminaText();
        const tickBeforeLeave = await getSimulationTick(quickMatchApp);
        // Non-vacuity for the restore assertions in step 4, one per value: the
        // move really did change each of them, so "the same value after
        // Continue" is a fact about the restore rather than about a value that
        // never moved in the first place.
        expect(gridBeforeLeave).not.toEqual(gridAtStart);
        expect(staminaBeforeLeave).not.toBe(staminaAtStart);
        expect(tickBeforeLeave).toBeGreaterThan(tickAtStart);

        // ── 3. Leave: a quick session has no lobby, so this exit ends it ──────
        await leaveThroughInGameMenu(quickMatchWindow);
        await expect(quickMatchWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });
        await expect
            .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('Quick Match');

        // ── 4. Continue is now live, and resumes the same board ──────────────
        // Enabled by the `saves:slot-update` push the close's autosave fires —
        // no reload, and nothing on the game's side probed for it.
        await expect(menu.continueButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });
        await menu.continueLastMatch();
        await waitForRevealedMatch(quickMatchWindow, RESTORE_TIMEOUT_MS);
        await expect(quickMatchWindow).toHaveURL(/\/game\/?\?gameId=tactics$/);

        // Route arrival is not restoration. These are the facts from BEFORE the
        // leave: where the unit stood, what it had left to spend, and the tick
        // the simulation was on.
        await expect
            .poll(() => getSimulationTick(quickMatchApp), { timeout: RESTORE_TIMEOUT_MS })
            .toBe(tickBeforeLeave);
        expect(await game.localUnitGrid()).toEqual(gridBeforeLeave);
        await expect
            .poll(() => game.staminaText(), { timeout: NAV_TIMEOUT_MS })
            .toBe(staminaBeforeLeave);

        // ── 5. The stamp survived the save file: leaving still ends the session
        //       and lands on the menu, rather than looking for a lobby ─────────
        await leaveThroughInGameMenu(quickMatchWindow);
        await expect(quickMatchWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });

        // Nothing in the whole journey — two entries and two exits — went near
        // the lobby.
        const wholeTrace = await readRouteTrace(quickMatchWindow);
        expect(visitedRoutePaths(wholeTrace), `route trace: ${JSON.stringify(wholeTrace)}`).toEqual(
            ['/main-menu', '/game', '/main-menu', '/game', '/main-menu'],
        );
    });

    test('New Game still opens the lobby, and a lobby-born session returns to it on Leave', async ({
        quickMatchWindow,
    }) => {
        test.slow();

        const menu = await openTacticsMenu(quickMatchWindow);
        const lobby = new TacticsLobbyPage(quickMatchWindow);

        // The other fork of the same in-game Leave, on the same menu: a session
        // born in a lobby carries no `engine.sessionMode` stamp, so the host
        // exit stays `returnToLobby()` and the lobby is still there afterwards.
        await menu.clickButtonByLabel('New Game');
        await expect(quickMatchWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
        await lobby.hostLobby();
        await lobby.addAi();
        await lobby.expectAiCount(1);
        await lobby.toggleReady();
        await expect(lobby.startButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });
        await lobby.startButton.click();
        await waitForRevealedMatch(quickMatchWindow, NAV_TIMEOUT_MS);

        await leaveThroughInGameMenu(quickMatchWindow);

        await expect(lobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(quickMatchWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
    });
});
