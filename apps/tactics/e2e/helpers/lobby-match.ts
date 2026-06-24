import { expect, type Page } from '@playwright/test';
import type { LobbyPage } from '../pages/LobbyPage';
import { GamePage } from '../pages/GamePage';

/**
 * e2e/helpers/lobby-match.ts
 *
 * Drive a connected host+client lobby to a started match and wait for both
 * match canvases. Shared by `game.fixture` and the in-game-menu/leave spec
 * (#743).
 *
 * Robust to the players' current ready state: each window flips its OWN seat's
 * ready toggle only when that seat is not already ready. This works from a fresh
 * lobby and from a restart after a host return-to-lobby (#736, which now clears
 * ready) without an unconditional toggle accidentally flipping an already-ready
 * seat back to unready and stalling the start gate.
 */
export async function readyAndStart(
    hostLobby: LobbyPage,
    clientLobby: LobbyPage,
    hostWindow: Page,
    clientWindow: Page,
): Promise<void> {
    const hostPlayerId = await hostLobby.localPlayerId();
    const clientPlayerId = await clientLobby.localPlayerId();
    if (!hostPlayerId) throw new Error('Could not determine host player ID');
    if (!clientPlayerId) throw new Error('Could not determine client player ID');

    // Each player owns its own ready toggle; flip only when not already ready.
    if ((await hostLobby.playerReadyStatusById(hostPlayerId)) !== 'true') {
        await hostLobby.toggleReady();
    }
    if ((await clientLobby.playerReadyStatusById(clientPlayerId)) !== 'true') {
        await clientLobby.toggleReady();
    }

    // Gate the host Start on the host's view of both seats being ready.
    await expect
        .poll(() =>
            Promise.all([
                hostLobby.playerReadyStatusById(hostPlayerId),
                hostLobby.playerReadyStatusById(clientPlayerId),
            ]),
        )
        .toEqual(['true', 'true']);

    await hostLobby.startButton.click();

    // Under the custom Electron protocol used in E2E, route transitions can
    // render the Match screen before the URL reflects `/game`. Gate on visible
    // match UI instead of URL assertions.
    const hostGame = new GamePage(hostWindow);
    const clientGame = new GamePage(clientWindow);
    await hostGame.canvas.waitFor({ state: 'visible' });
    await clientGame.canvas.waitFor({ state: 'visible' });
}
