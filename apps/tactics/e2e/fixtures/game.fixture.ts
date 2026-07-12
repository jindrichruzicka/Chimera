import type { ElectronApplication, Page } from '@playwright/test';
import { test as lobbyTest } from './lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';
import { readyAndStart } from '../helpers/lobby-match';

export type E2eFirstPlayer = 'host' | 'client';

export interface GameFixtureOptions {
    readonly firstPlayer: E2eFirstPlayer;
}

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
 *  4. Host clicks start game
 *  5. Waits for match canvas to become visible in both windows
 *
 * Invariant #42: The match must reach game-over through normal pipeline
 * processing; the fixture never directly mutates tick.
 *
 * §13.11: CHIMERA_E2E is set by the launcher — not here.
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

async function advanceToGame(
    hostApp: ElectronApplication,
    hostWindow: Page,
    clientWindow: Page,
    firstPlayer: E2eFirstPlayer,
): Promise<void> {
    await configureFirstPlayer(hostApp, firstPlayer);

    const hostLobby = new LobbyPage(hostWindow);
    const clientLobby = new LobbyPage(clientWindow);

    await hostLobby.hostLobby();
    const lobbyCode = await hostLobby.lobbyCode();
    await clientLobby.joinLobby(lobbyCode);

    await hostLobby.waitForPlayerCount(2);
    await clientLobby.waitForPlayerCount(2);

    await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
}

/**
 * Game fixture — extends the lobby fixture with the full game-start sequence.
 *
 * The `_matchStarted` auto-fixture runs before every test in this suite,
 * advancing both windows through lobby → match so specs can focus on
 * in-match assertions.
 *
 * §13.8: game.fixture.ts — Extends lobby: game started, tick driver wired.
 */
export const test = lobbyTest.extend<GameFixtureOptions & { readonly _matchStarted: void }>({
    firstPlayer: ['host', { option: true }],

    // @chimera-review: auto fixture must reference hostWindow/clientWindow to
    // trigger dependency resolution; the eslint empty-destructure suppression
    // used in lobby.fixture does not apply here.
    _matchStarted: [
        async ({ hostApp, hostWindow, clientWindow, firstPlayer }, use) => {
            await advanceToGame(hostApp, hostWindow, clientWindow, firstPlayer);
            await use();
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
