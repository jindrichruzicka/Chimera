import type { ElectronApplication, Page } from '@playwright/test';
import { launchE2eElectronApplication, test as electronTest } from './electron.fixture';

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
 * §13.11 (CHIMERA_E2E production gate): CHIMERA_E2E must never appear in production packaging — set here only.
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
});

export { expect } from '@playwright/test';
