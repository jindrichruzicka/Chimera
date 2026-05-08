import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { test as lobbyTest } from './lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';
import { MatchPage } from '../pages/MatchPage';

export interface GameFixtures {
    readonly hostApp: ElectronApplication;
    readonly clientApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly clientWindow: Page;
}

/**
 * Advances both windows through the full lobby → match transition.
 *
 * Flow:
 *  1. Host creates lobby
 *  2. Client joins via lobby code
 *  3. Both players toggle ready
 *  4. Host clicks start match
 *  5. Waits for match canvas to become visible in both windows
 *
 * Invariant #42: The match must reach game-over through normal pipeline
 * processing; the fixture never directly mutates tick.
 *
 * §13.11: CHIMERA_E2E is set by the launcher — not here.
 */
async function advanceToMatch(hostWindow: Page, clientWindow: Page): Promise<void> {
    const hostLobby = new LobbyPage(hostWindow);
    const clientLobby = new LobbyPage(clientWindow);

    await hostLobby.hostLobby();
    const lobbyCode = await hostLobby.lobbyCode();
    await clientLobby.joinLobby(lobbyCode);

    await hostLobby.waitForPlayerCount(2);
    await clientLobby.waitForPlayerCount(2);

    await hostLobby.toggleReady();
    await clientLobby.toggleReady();

    const hostPlayerId = await hostLobby.localPlayerId();
    const clientPlayerId = await clientLobby.localPlayerId();
    if (!hostPlayerId) throw new Error('Could not determine host player ID');
    if (!clientPlayerId) throw new Error('Could not determine client player ID');

    await expect
        .poll(() =>
            Promise.all([
                hostLobby.playerReadyStatusById(hostPlayerId),
                hostLobby.playerReadyStatusById(clientPlayerId),
            ]),
        )
        .toEqual(['true', 'true']);

    await hostLobby.startButton.click();

    const hostMatch = new MatchPage(hostWindow);
    const clientMatch = new MatchPage(clientWindow);
    await hostMatch.canvas.waitFor({ state: 'visible' });
    await clientMatch.canvas.waitFor({ state: 'visible' });
}

/**
 * Game fixture — extends the lobby fixture with the full match-start sequence.
 *
 * The `_matchStarted` auto-fixture runs before every test in this suite,
 * advancing both windows through lobby → match so specs can focus on
 * in-match assertions.
 *
 * §13.8: game.fixture.ts — Extends lobby: match started, tick driver wired.
 */
export const test = lobbyTest.extend<{ readonly _matchStarted: void }>({
    // @chimera-review: auto fixture must reference hostWindow/clientWindow to
    // trigger dependency resolution; the eslint empty-destructure suppression
    // used in lobby.fixture does not apply here.
    _matchStarted: [
        async ({ hostWindow, clientWindow }, use) => {
            await advanceToMatch(hostWindow, clientWindow);
            await use();
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
