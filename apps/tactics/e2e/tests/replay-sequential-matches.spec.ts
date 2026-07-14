/**
 * Regression: opening the deterministic replay of the SECOND match in a session
 * must play back without a `StaleActionError`.
 *
 * The session tick is monotonic across match boundaries (`engine:start_game` and
 * `engine:return_to_lobby` advance the tick rather than resetting it), so the
 * second match's first recorded action is at a tick > 0. The deterministic replay
 * used to reconstruct its initial snapshot hardcoded at tick 0, so advancing
 * playback fed `actions[0]` (e.g. tick 4) into the ActionPipeline against a tick-0
 * snapshot and the `chimera:replay:snapshot-range` IPC rejected with
 * `StaleActionError: action.tick (4) does not match snapshot.tick (0)`. Match 1's
 * replay worked only because it is the session's first match (start_game at tick 0).
 *
 * This drives a full host round-trip: play match 1 → open its replay (works) →
 * leave to lobby → play match 2 → open its replay → assert it plays to the final
 * tick with no StaleActionError.
 *
 * Uses the lobby fixture (not game.fixture) so the match is started in-body after
 * entering the production-like `?gameId=tactics` context, and so a SECOND match can
 * be started after returning to the lobby (mirrors replay-leave-preserves-gameid).
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { GamePage } from '../pages/GamePage';
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';
import { readyAndStart } from '../helpers/lobby-match';

const TACTICS_GAME_ID = 'tactics';

// The reserved sentinel that opens the in-memory recording of the just-finished
// match (mirrors `CURRENT_MATCH_REPLAY_PATH` in
// `simulation/foundation/replay-bridge-contract.ts`; hardcoded here because the
// Playwright spec runner does not resolve the `@chimera-engine/*` alias).
const CURRENT_MATCH_REPLAY_PATH = '::chimera-current-match::';

/** Minimal shape of the deterministic replay bridge this spec drives directly. */
interface ChimeraDeterministicReplayGlobal {
    readonly __chimera: {
        readonly replay: {
            openInPlayer(path: string, saveable: boolean): Promise<void>;
        };
    };
}

// Cross-process return-to-lobby and match restarts run an order slower on CI.
const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;

/** Make the host the active first player so it can drive each match to game-over. */
async function makeHostFirstPlayer(hostApp: ElectronApplication): Promise<void> {
    await hostApp.evaluate(() => {
        type E2eHookGlobal = typeof globalThis & {
            __e2eHooks?: { firstPlayerRole: 'host' | 'client' };
        };
        const hooks = (globalThis as E2eHookGlobal).__e2eHooks;
        if (hooks === undefined) {
            throw new Error('CHIMERA_E2E hooks are not available in the host process');
        }
        hooks.firstPlayerRole = 'host';
    });
}

/** Drive the host to game-over through the canonical move + attack flow. */
async function playToGameOver(hostGame: GamePage): Promise<void> {
    await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
    await hostGame.moveSelectedPrimitiveNearOpponent();
    await hostGame.attackAdjacentEnemy();
    await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
}

/** With the result banner showing, press Enter to reach the post-game summary. */
async function goToPostGameSummary(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');
    await hostWindow.keyboard.press('Enter');
    await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
    await expect(hostGame.postGameSummary).toBeVisible();
}

/**
 * Open the just-finished match's DETERMINISTIC replay and assert it plays back to
 * its final tick without surfacing a StaleActionError.
 *
 * This regression is specific to the deterministic replay's initial-snapshot
 * reconstruction: only the deterministic surface re-runs recorded actions through
 * the ActionPipeline (perspective playback serves already-projected frames and can
 * never raise a StaleActionError). The post-game summary now opens the PERSPECTIVE
 * player for host and client alike, so the deterministic in-memory recording is
 * opened directly through the still-exposed deterministic bridge — recorded in this
 * non-packaged e2e build exactly as before.
 */
async function openReplayAndAssertPlaysToEnd(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await goToPostGameSummary(hostWindow, hostGame);
    await hostWindow.evaluate(
        (sentinel) =>
            (
                globalThis as unknown as ChimeraDeterministicReplayGlobal
            ).__chimera.replay.openInPlayer(sentinel, true),
        CURRENT_MATCH_REPLAY_PATH,
    );

    const player = new ReplayPlayerPage(hostWindow);
    await expect(player.playButton).toBeVisible({ timeout: 30_000 });
    // Confirm the deterministic surface opened (the navigate push carried
    // kind=deterministic), so the pipeline-reconstruction path is the one exercised.
    // Exact match: the perspective group's label is a superstring of this one.
    await expect(
        hostWindow.getByRole('group', { name: 'Replay playback controls', exact: true }),
    ).toBeVisible();

    // Bounded playback: jump to one tick before the end, then Play the final tick.
    await player.seekToPenultimateTick();
    await player.play();
    await player.waitForFinalTick();

    // A rejected `chimera:replay:snapshot-range` (StaleActionError) replaces the
    // player with an error alert — it must never appear for the second match.
    await expect(hostWindow.getByText(/StaleActionError/)).toHaveCount(0);
}

test.describe('sequential matches: the second match replay plays back without a StaleActionError', () => {
    test('host can replay both matches of a session', async ({
        hostApp,
        hostWindow,
        clientWindow,
    }) => {
        // Two full matches played to game-over plus two replay playbacks: well
        // over the 90 s budget on the ~10× slower CI runner. test.slow()
        // triples the timeout.
        test.slow();

        const hostMenu = new MainMenuPage(hostWindow);
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        const hostGame = new GamePage(hostWindow);

        // The host drives every match to game-over, so it must move first.
        await makeHostFirstPlayer(hostApp);

        // 1. Enter the production-like context and host a lobby; client joins by code.
        await hostMenu.goto({ gameId: TACTICS_GAME_ID });
        await expect
            .poll(() => hostMenu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('New Game');
        await hostMenu.clickButtonByLabel('New Game');
        await expect(hostWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
        await hostLobby.hostLobby();

        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        // 2. MATCH 1 — start, play to game-over, and replay it (this already works).
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await playToGameOver(hostGame);
        await openReplayAndAssertPlaysToEnd(hostWindow, hostGame);

        // 3. Leave the post-game replay → returnToLobby. Both windows land in lobby.
        await hostWindow.keyboard.press('Escape');
        const leaveConfirm = hostWindow.getByTestId('tactics-leave-confirm');
        await expect(leaveConfirm).toBeVisible();
        await leaveConfirm.click();
        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(clientLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 4. MATCH 2 — start from the same lobby (session tick is now > 0, so its
        //    recorded actions begin at a non-zero tick), play to game-over...
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await playToGameOver(hostGame);

        // ...and replay it. Before the fix this rejected the snapshot-range IPC with
        // `StaleActionError: action.tick (N) does not match snapshot.tick (0)`.
        await openReplayAndAssertPlaysToEnd(hostWindow, hostGame);
    });
});
