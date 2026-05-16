/**
 * e2e/fixtures/direct-match.fixture.ts
 *
 * Direct-match fixture — launches a host + client pair that bootstrap directly
 * into a running match without going through the lobby UI.
 *
 * Both processes use `CHIMERA_E2E_DIRECT_MATCH_ROLE` (host | client) to
 * trigger auto-host / auto-join in the main process.  The host stores its
 * lobby code in `__e2eHooks.directMatchLobbyCode`; the fixture polls until
 * it is non-null, then passes it to the client via
 * `CHIMERA_E2E_DIRECT_MATCH_JOIN_ADDRESS`.
 *
 * Use this fixture for specs that test in-match behaviour and do NOT need to
 * exercise the lobby → match transition.  The only test that SHOULD keep
 * using `game.fixture` (the full lobby flow) is `match-flow.spec.ts`.
 *
 * §13.8: direct-match.fixture.ts — Bypasses lobby UI; both windows start on
 * /match with an established host + client connection.
 *
 * Invariants upheld:
 *   #27 — CHIMERA_E2E is set by the launcher — not here.
 *   #42 — The match must reach game-over through normal pipeline processing;
 *          the fixture never directly mutates tick.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from './electron.fixture';
import { GamePage } from '../pages/GamePage';

export type E2eFirstPlayer = 'host' | 'client';

export interface DirectMatchFixtureOptions {
    readonly firstPlayer: E2eFirstPlayer;
    readonly passAndPlay: boolean;
}

export interface DirectMatchFixtures {
    readonly hostApp: ElectronApplication;
    readonly clientApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly clientWindow: Page;
}

const DIRECT_MATCH_PORT = '7779';
/** Polling interval while waiting for the lobby code from the host process. */
const LOBBY_CODE_POLL_MS = 100;
/** Total time to wait for the lobby code before failing (ms). */
const LOBBY_CODE_TIMEOUT_MS = 10_000;

/**
 * Poll `__e2eHooks.directMatchLobbyCode` in the host process until it is
 * non-null or the timeout expires.
 */
async function waitForLobbyCode(hostApp: ElectronApplication): Promise<string> {
    const deadline = Date.now() + LOBBY_CODE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const code: string | null = await hostApp.evaluate(() => {
            type E2eHookGlobal = typeof globalThis & {
                __e2eHooks?: { directMatchLobbyCode: string | null };
            };
            return (globalThis as E2eHookGlobal).__e2eHooks?.directMatchLobbyCode ?? null;
        });
        if (code !== null) {
            return code;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, LOBBY_CODE_POLL_MS));
    }
    throw new Error(
        `direct-match fixture: timed out waiting for host to expose directMatchLobbyCode ` +
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
    throw new Error('direct-match fixture: timed out waiting for host E2E hooks');
}

/**
 * Direct-match fixture — extends the base Electron fixture with a host+client
 * pair that starts directly in match state, bypassing lobby UI.
 *
 * The `_matchStarted` auto-fixture blocks every test until both windows show
 * the match canvas.
 */
export const test = electronTest.extend<
    DirectMatchFixtureOptions & { readonly _matchStarted: void } & DirectMatchFixtures
>({
    firstPlayer: ['host', { option: true }],
    passAndPlay: [false, { option: true }],

    hostApp: async ({ firstPlayer, passAndPlay }, use) => {
        const app = await launchE2eElectronApplication({
            port: DIRECT_MATCH_PORT,
            role: 'host',
            directMatchRole: 'host',
            initialRoute: '/match',
            passAndPlay,
        });
        try {
            await configureFirstPlayer(app, firstPlayer);
            await use(app);
        } finally {
            await app.close();
        }
    },

    clientApp: async ({ hostApp, passAndPlay }, use) => {
        if (passAndPlay) {
            await use(hostApp);
            return;
        }

        const lobbyCode = await waitForLobbyCode(hostApp);

        const app = await launchE2eElectronApplication({
            port: DIRECT_MATCH_PORT,
            role: 'client',
            directMatchRole: 'client',
            directMatchJoinAddress: lobbyCode,
            initialRoute: '/match',
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
    _matchStarted: [
        async ({ hostWindow, clientWindow }, use) => {
            const hostMatch = new GamePage(hostWindow);
            const clientMatch = new GamePage(clientWindow);

            // Both windows load /match directly; MatchPage waits for the
            // first snapshot while the hidden direct-match lobby auto-starts.
            await expect(hostMatch.canvas).toBeVisible({ timeout: 15_000 });
            await expect(clientMatch.canvas).toBeVisible({ timeout: 15_000 });

            await use();
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
