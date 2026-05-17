/**
 * F38 — game-navigation.spec.ts
 *
 * Verifies the GameShell route is entered through the normal lobby flow and
 * that a bare /game visit without a snapshot returns to the lobby UI.
 */
import { test as gameTest, expect } from '../fixtures/game.fixture';
import { test as electronTest } from '../fixtures/electron.fixture';
import { GamePage } from '../pages/GamePage';
import { LobbyPage } from '../pages/LobbyPage';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const GAME_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/game/`;

gameTest(
    'lobby start navigates host and client into the registry GameShell',
    async ({ hostWindow, clientWindow }) => {
        const hostMatch = new GamePage(hostWindow);
        const clientMatch = new GamePage(clientWindow);

        await expect(hostMatch.canvas).toBeVisible();
        await expect(clientMatch.canvas).toBeVisible();
        await expect(hostMatch.sceneRouter).toHaveAttribute('data-active-scene-id', 'engine:match');
        await expect(clientMatch.sceneRouter).toHaveAttribute(
            'data-active-scene-id',
            'engine:match',
        );
    },
);

electronTest(
    'direct /game without a snapshot redirects to the lobby screen',
    async ({ mainWindow }) => {
        await mainWindow.goto(GAME_URL);

        const lobby = new LobbyPage(mainWindow);
        await lobby.waitForPreLobbyScreen();
        await expect(mainWindow.getByTestId('game-canvas')).toHaveCount(0);
    },
);
