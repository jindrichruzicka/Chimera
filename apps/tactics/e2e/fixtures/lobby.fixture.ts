import type { ElectronApplication, Page } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from './electron.fixture';
import { openE2eWindow } from './open-window';

export interface LobbyFixtures {
    readonly hostApp: ElectronApplication;
    readonly clientApp: ElectronApplication;
    readonly hostWindow: Page;
    readonly clientWindow: Page;
}

/**
 * Lobby fixture — extends the base Electron fixture with a host+client pair for
 * multiplayer tests.
 *
 * Both processes share port 7779.  Teardown calls app.close() on each process
 * unconditionally (host first, then client).
 *
 * Invariant 5:  window.__chimera is exposed only through preload/api.ts.
 * §13.11 (CHIMERA_E2E production gate): CHIMERA_E2E must never appear in production packaging — no
 * packaging script sets it, and `tools/e2e-workflow.test.ts` pins that the CI workflow's `env:`
 * blocks do not either.
 */
export const test = electronTest.extend<LobbyFixtures>({
    // @chimera-review: Playwright fixture signature requires empty destructuring for unused fixture dependencies
    // eslint-disable-next-line no-empty-pattern
    hostApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: '7779',
            role: 'host',
            initialRoute: '/lobby?gameId=tactics',
        });
        try {
            await use(app);
        } finally {
            await app.close();
        }
    },

    // @chimera-review: Playwright fixture signature requires empty destructuring for unused fixture dependencies
    // eslint-disable-next-line no-empty-pattern
    clientApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: '7779',
            role: 'client',
            initialRoute: '/lobby?gameId=tactics',
        });
        try {
            await use(app);
        } finally {
            await app.close();
        }
    },

    // The two windows go through `openE2eWindow` so a launch that never produces
    // a loaded window says WHICH of the pair was late and why — a bare
    // `Timeout 30000ms exceeded` here names neither.
    hostWindow: async ({ hostApp }, use) => {
        await use(await openE2eWindow(hostApp, 'host'));
    },

    clientWindow: async ({ clientApp }, use) => {
        await use(await openE2eWindow(clientApp, 'client'));
    },
});

export { expect } from '@playwright/test';
