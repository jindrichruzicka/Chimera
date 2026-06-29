/**
 * Regression: leaving a match → lobby → leaving the lobby must return the host
 * to the TACTICS main menu, not the engine-default menu.
 *
 * The renderer resolves which main menu to show from the `?gameId=` URL query
 * param (`main-menu/page.tsx`): no `gameId` → engine default (Play / Settings /
 * Quit); `gameId=tactics` → the tactics override (New Game / Load Game …).
 * Production boots with the param present (`buildRendererGameLaunchUrl`), but the
 * in-match navigation hops used to push bare paths and drop it: handleStartGame
 * (`/game`) and the host return-to-lobby (`/lobby`). Once dropped, leaving the
 * lobby lands on `/main-menu` with no `gameId` → engine default. This spec drives
 * the full host round-trip and asserts the tactics menu returns.
 *
 * Uses the lobby fixture (not game.fixture): the match is started in-body AFTER
 * navigating the host into the production-like `?gameId=tactics` context, which
 * game.fixture's auto match-start (on the bare `/lobby` URL) cannot provide.
 */

import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';
import { MainMenuPage } from '../pages/MainMenuPage';
import { GamePage } from '../pages/GamePage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { readyAndStart } from '../helpers/lobby-match';

// Return-to-lobby and the lobby→menu hop round-trip through two Electron
// processes; CI runs an order slower than local, so give cross-process screen
// arrivals a generous budget (matches in-game-menu-leave.spec.ts).
const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;

test.describe('leave match → lobby → leave lobby returns to the tactics menu', () => {
    test('host round-trip lands on the tactics main menu, not the engine default', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMenu = new MainMenuPage(hostWindow);
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        const hostInGameMenu = new InGameMenuPage(hostWindow);

        // 1. Enter the production-like game context: tactics main menu → New Game
        //    → /lobby?gameId=tactics, then host the lobby.
        await hostMenu.goto({ gameId: 'tactics' });
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

        // 3. Ready both seats and host-start the match (the hop that dropped the
        //    gameId query param on the way to /game).
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(new GamePage(hostWindow).canvas).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 4. Host leaves the match → returns to the lobby (#736).
        await hostInGameMenu.openViaEscape();
        await hostInGameMenu.confirmLeave();
        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // 5. Host leaves the lobby: leave the active lobby (→ pre-lobby), then Close.
        await hostLobby.leaveLobby();
        await hostWindow.getByTestId('lobby-close').click();

        // 6. The host must land on the TACTICS main menu, not the engine default.
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
