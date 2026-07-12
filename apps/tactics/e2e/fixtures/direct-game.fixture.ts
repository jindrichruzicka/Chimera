/**
 * Direct-game fixture — launches a host + client pair that bootstrap directly
 * into a running game without going through the lobby UI.
 *
 * Both processes use `CHIMERA_E2E_DIRECT_GAME_ROLE` (host | client) to
 * trigger auto-host / auto-join in the main process.  The host stores its
 * lobby code in `__e2eHooks.directGameLobbyCode`; the fixture polls until
 * it is non-null, then passes it to the client via
 * `CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS`.
 *
 * Use this fixture for specs that test in-game behaviour and do NOT need to
 * exercise the lobby → game transition.  The only test that SHOULD keep
 * using `game.fixture` (the full lobby flow) is `game-flow.spec.ts`.
 *
 * §13.8: Bypasses lobby UI; both windows start on /game with an established
 * host + client connection.
 *
 * Invariants upheld:
 *   Invariant #27 — CHIMERA_E2E is set by the launcher — not here.
 *   Invariant #42 — The match must reach game-over through normal pipeline
 *          processing; the fixture never directly mutates tick.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
    launchE2eElectronApplication,
    test as electronTest,
    type E2eInitialRoute,
} from './electron.fixture';
import { GamePage } from '../pages/GamePage';

export type E2eFirstPlayer = 'host' | 'client';

export interface DirectGameFixtureOptions {
    readonly firstPlayer: E2eFirstPlayer;
    readonly passAndPlay: boolean;
    readonly launchClient: boolean;
    readonly hostInitialRoute: E2eInitialRoute;
    readonly clientInitialRoute: E2eInitialRoute;
    readonly waitForGameStarted: boolean;
    /** Launch the host in Runtime Debug Layer mode (`CHIMERA_DEBUG=1`, §4.12). */
    readonly debugMode: boolean;
}

export interface DirectGameFixtures {
    readonly hostApp: ElectronApplication;
    readonly clientApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly clientWindow: Page;
}

const DIRECT_GAME_PORT = '7779';
/** Polling interval while waiting for the lobby code from the host process. */
const LOBBY_CODE_POLL_MS = 100;
/** Total time to wait for the lobby code before failing (ms). */
const LOBBY_CODE_TIMEOUT_MS = 10_000;

/**
 * Poll `__e2eHooks.directGameLobbyCode` in the host process until it is
 * non-null or the timeout expires.
 */
async function waitForLobbyCode(hostApp: ElectronApplication): Promise<string> {
    const deadline = Date.now() + LOBBY_CODE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const code: string | null = await hostApp.evaluate(() => {
            type E2eHookGlobal = typeof globalThis & {
                __e2eHooks?: { directGameLobbyCode: string | null };
            };
            return (globalThis as E2eHookGlobal).__e2eHooks?.directGameLobbyCode ?? null;
        });
        if (code !== null) {
            return code;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, LOBBY_CODE_POLL_MS));
    }
    throw new Error(
        `direct-game fixture: timed out waiting for host to expose directGameLobbyCode ` +
            `after ${LOBBY_CODE_TIMEOUT_MS}ms`,
    );
}

async function configureFirstPlayer(
    hostApp: ElectronApplication,
    firstPlayer: E2eFirstPlayer,
): Promise<void> {
    const deadline = Date.now() + LOBBY_CODE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const configured = await hostApp.evaluate((_electron, role: E2eFirstPlayer) => {
            type E2eHookGlobal = typeof globalThis & {
                __e2eHooks?: { firstPlayerRole: E2eFirstPlayer };
            };
            const hooks = (globalThis as E2eHookGlobal).__e2eHooks;
            if (hooks === undefined) {
                return false;
            }
            hooks.firstPlayerRole = role;
            return true;
        }, firstPlayer);
        if (configured) {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, LOBBY_CODE_POLL_MS));
    }
    throw new Error('direct-game fixture: timed out waiting for host E2E hooks');
}

/**
 * Direct-game fixture — extends the base Electron fixture with a host+client
 * pair that starts directly in game state, bypassing lobby UI.
 *
 * By default, the `_gameStarted` auto-fixture blocks every test until both
 * windows show the game canvas. Specs that need to configure the host before
 * the client joins can set `launchClient: false` and launch the client manually.
 */
export const test = electronTest.extend<
    DirectGameFixtureOptions & { readonly _gameStarted: void } & DirectGameFixtures
>({
    firstPlayer: ['host', { option: true }],
    passAndPlay: [false, { option: true }],
    launchClient: [true, { option: true }],
    hostInitialRoute: ['/game', { option: true }],
    clientInitialRoute: ['/game', { option: true }],
    waitForGameStarted: [true, { option: true }],
    debugMode: [false, { option: true }],

    hostApp: async ({ firstPlayer, passAndPlay, hostInitialRoute, debugMode }, use) => {
        const app = await launchE2eElectronApplication({
            port: DIRECT_GAME_PORT,
            role: 'host',
            directGameRole: 'host',
            initialRoute: hostInitialRoute,
            passAndPlay,
            debugMode,
        });
        try {
            await configureFirstPlayer(app, firstPlayer);
            await use(app);
        } finally {
            await app.close();
        }
    },

    clientApp: async ({ hostApp, passAndPlay, launchClient, clientInitialRoute }, use) => {
        if (passAndPlay || !launchClient) {
            await use(hostApp);
            return;
        }

        const lobbyCode = await waitForLobbyCode(hostApp);

        const app = await launchE2eElectronApplication({
            port: DIRECT_GAME_PORT,
            role: 'client',
            directGameRole: 'client',
            directGameJoinAddress: lobbyCode,
            initialRoute: clientInitialRoute,
        });
        try {
            await use(app);
        } finally {
            await app.close();
        }
    },

    hostWindow: async ({ hostApp }, use) => {
        const w = await hostApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },

    clientWindow: async ({ clientApp }, use) => {
        const w = await clientApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },

    // @chimera-review: auto fixture must reference hostWindow/clientWindow to
    // trigger dependency resolution.
    _gameStarted: [
        async ({ hostWindow, clientWindow, waitForGameStarted }, use) => {
            if (waitForGameStarted) {
                const hostGame = new GamePage(hostWindow);
                const clientGame = new GamePage(clientWindow);

                // Both windows load /game directly by default; GamePage waits for the
                // first snapshot while the hidden direct-game lobby auto-starts.
                await expect(hostGame.canvas).toBeVisible({ timeout: 15_000 });
                await expect(clientGame.canvas).toBeVisible({ timeout: 15_000 });
            }

            await use();
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
