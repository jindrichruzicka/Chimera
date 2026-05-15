/**
 * F38 — match-navigation.spec.ts
 *
 * Verifies the GameShell route is entered through the normal lobby flow and
 * that a bare /match visit without a snapshot returns to the lobby UI.
 */
import { test as gameTest, expect } from '../fixtures/game.fixture';
import { test as electronTest } from '../fixtures/electron.fixture';
import { MatchPage } from '../pages/MatchPage';
import { LobbyPage } from '../pages/LobbyPage';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const MATCH_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/match/`;

gameTest(
    'lobby start navigates host and client into the registry GameShell',
    async ({ hostWindow, clientWindow }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);

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
    'direct /match without a snapshot redirects to the lobby screen',
    async ({ mainWindow }) => {
        await mainWindow.goto(MATCH_URL);

        const lobby = new LobbyPage(mainWindow);
        await lobby.waitForPreLobbyScreen();
        await expect(mainWindow.getByTestId('match-canvas')).toHaveCount(0);
    },
);
