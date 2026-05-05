import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'path';

export interface ElectronFixtures {
    readonly electronApp: ElectronApplication;
    readonly mainWindow: Page;
}

/** Filter out undefined entries from process.env to satisfy electron.launch's env type. */
function inheritEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );
}

/**
 * Base Electron fixture — launches a single ElectronApplication for boot-smoke and
 * single-player tests.
 *
 * Sets CHIMERA_E2E=1, NODE_ENV=test, CHIMERA_PORT=7778 in the child process env.
 * Teardown calls app.close() unconditionally.
 *
 * Invariant 5:  window.__chimera is exposed only through preload/api.ts.
 * Invariant 27: CHIMERA_E2E must never appear in production packaging — set here only.
 */
export const test = base.extend<ElectronFixtures>({
    electronApp: async (_fixtures, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...inheritEnv(),
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7778',
            },
        });
        await use(app);
        await app.close();
    },

    mainWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

export { expect };
