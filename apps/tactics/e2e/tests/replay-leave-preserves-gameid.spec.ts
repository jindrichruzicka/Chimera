/**
 * Regression: leaving the POST-GAME replay → lobby → leaving the lobby must
 * return the host to the TACTICS main menu, not the engine-default menu.
 *
 * The shell (incl. the main-menu override) resolves only from the `?gameId=` URL
 * query param. The post-game Replay opens `/replays/player/…` via a main-process
 * navigate push (`ReplayNavigationBridge`); that hop used to drop `?gameId=`. The
 * saveable leave then routes host → returnToLobby, and `GameStoreBootstrap`
 * re-reads the (now gameId-less) player URL to build `/lobby`, so the eventual
 * menu fell back to the engine default. This spec drives the full host round-trip
 * THROUGH the post-game replay and asserts the tactics menu returns.
 *
 * Uses the lobby fixture (not game.fixture): the match is started in-body AFTER
 * navigating the host into the production-like `?gameId=tactics` context, which
 * game.fixture's auto match-start (on the bare `/lobby` URL) cannot provide
 * (mirrors leave-to-tactics-menu.spec.ts).
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { GamePage } from '../pages/GamePage';
import { ReplayPlayerPage } from '../pages/ReplayPlayerPage';
import { readyAndStart } from '../helpers/lobby-match';

const TACTICS_GAME_ID = 'tactics';

// Cross-process return-to-lobby and the lobby→menu hop run an order slower on CI;
// give screen arrivals a generous budget (matches leave-to-tactics-menu.spec.ts).
const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;

/**
 * Make the host the active first player so it can drive the match to game-over
 * (replicates game.fixture's internal `configureFirstPlayer`, which lobby.fixture
 * does not run).
 */
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

/**
 * Reach the post-game summary the way a player does: with the result banner
 * showing, press Enter (the resolved-match `game:end-turn` binding becomes
 * "continue" and switches the renderer to the post-game summary screen).
 */
async function goToPostGameSummary(hostWindow: Page, hostGame: GamePage): Promise<void> {
    await expect.poll(() => hostGame.activeSceneId(), { timeout: 15_000 }).toBe('engine:game');
    await hostWindow.keyboard.press('Enter');
    await expect.poll(() => hostGame.activeScreenKey(), { timeout: 15_000 }).toBe('summary');
    await expect(hostGame.postGameSummary).toBeVisible();
}

test.describe('leave post-game replay → lobby → leave lobby returns to the tactics menu', () => {
    test('host round-trip through the replay lands on the tactics menu, not the engine default', async ({
        hostApp,
        hostWindow,
        clientWindow,
    }) => {
        const hostMenu = new MainMenuPage(hostWindow);
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        const hostGame = new GamePage(hostWindow);

        // The host drives the match to game-over, so it must move first.
        await makeHostFirstPlayer(hostApp);

        // 1. Enter the production-like game context: tactics main menu → New Game
        //    → /lobby?gameId=tactics, then host the lobby.
        await hostMenu.goto({ gameId: TACTICS_GAME_ID });
        await expect
            .poll(() => hostMenu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('New Game');
        await hostMenu.clickButtonByLabel('New Game');
        await expect(hostWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/);
        await hostLobby.hostLobby();

        // 2. Client joins the hosted lobby by code.
        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        // 3. Ready both seats and host-start the match.
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 4. Play to game-over and open the just-finished match in the player
        //    (saveable=1 → post-game replay; this is the hop that dropped gameId).
        await playToGameOver(hostGame);
        await goToPostGameSummary(hostWindow, hostGame);
        await hostGame.replayButton.click();
        const player = new ReplayPlayerPage(hostWindow);
        await expect(player.playButton).toBeVisible({ timeout: 30_000 });

        // 5. Esc → Leave: the saveable replay routes host → returnToLobby.
        await hostWindow.keyboard.press('Escape');
        const leaveConfirm = hostWindow.getByTestId('tactics-leave-confirm');
        await expect(leaveConfirm).toBeVisible();
        await leaveConfirm.click();

        // 6. The host lands back on the lobby — and the precise failure point: the
        //    lobby URL must still carry ?gameId=tactics (was dropped before the fix).
        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(hostWindow).toHaveURL(/\/lobby\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });

        // 7. Host leaves the lobby: leave the active lobby (→ pre-lobby), then Close.
        await hostLobby.leaveLobby();
        await hostWindow.getByTestId('lobby-close').click();

        // 8. The host must land on the TACTICS main menu, not the engine default.
        await expect(hostWindow.getByTestId('tactics-shell-background-title')).toHaveText(
            'Tactics',
            { timeout: SHELL_LOAD_TIMEOUT_MS },
        );
        const labels = await hostMenu.getButtonLabels();
        expect(labels).toContain('New Game');
        expect(labels).toContain('Load Game');
        // Engine-default "Play" must never appear once the tactics shell is loaded.
        expect(labels).not.toContain('Play');
    });
});
