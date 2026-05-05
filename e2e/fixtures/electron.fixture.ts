import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'path';
import globalSetup from '../global-setup';

export interface ElectronFixtures {
    readonly electronApp: ElectronApplication;
    readonly mainWindow: Page;
    readonly rendererConsole: RendererConsoleEntry[];
}

export type RendererConsoleSource = 'console' | 'pageerror';

export interface RendererConsoleEntry {
    readonly source: RendererConsoleSource;
    readonly level: string;
    readonly text: string;
}

export type E2eElectronRole = 'host' | 'client';

export interface E2eElectronLaunchOptions {
    readonly port: string;
    readonly role?: E2eElectronRole;
}

export interface E2eElectronLaunchConfig {
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

/** Filter out undefined entries from process.env to satisfy electron.launch's env type. */
function inheritEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );
}

let e2eBuildReady = false;

function ensureE2eBuild(mainEntry: string, preloadPath: string, rendererEntry: string): void {
    if (
        e2eBuildReady &&
        existsSync(mainEntry) &&
        existsSync(preloadPath) &&
        existsSync(rendererEntry)
    ) {
        return;
    }
    if (!existsSync(mainEntry) || !existsSync(preloadPath) || !existsSync(rendererEntry)) {
        globalSetup();
    }
    e2eBuildReady = true;
}

export function createE2eElectronLaunchConfig(
    options: E2eElectronLaunchOptions,
): E2eElectronLaunchConfig {
    const root = path.resolve(__dirname, '../..');
    const e2eBuildRoot = path.join(root, '.e2e-build');
    const mainEntry = path.join(e2eBuildRoot, 'electron', 'main', 'index.js');
    const preloadPath = path.join(e2eBuildRoot, 'electron', 'preload', 'api.js');
    const rendererEntry = path.join(root, 'renderer', 'out', 'index.html');

    ensureE2eBuild(mainEntry, preloadPath, rendererEntry);

    const env: Record<string, string> = {
        ...inheritEnv(),
        CHIMERA_E2E: '1',
        CHIMERA_E2E_PRELOAD_PATH: preloadPath,
        CHIMERA_E2E_RENDERER_ENTRY: rendererEntry,
        NODE_ENV: 'test',
        CHIMERA_PORT: options.port,
    };

    if (options.role !== undefined) {
        env['CHIMERA_ROLE'] = options.role;
    }

    return {
        args: [mainEntry],
        env,
    };
}

export async function launchE2eElectronApplication(
    options: E2eElectronLaunchOptions,
): Promise<ElectronApplication> {
    const launchConfig = createE2eElectronLaunchConfig(options);

    return electron.launch({
        args: [...launchConfig.args],
        env: launchConfig.env,
    });
}

function attachRendererConsoleCapture(page: Page, entries: RendererConsoleEntry[]): void {
    page.on('console', (message) => {
        entries.push({
            source: 'console',
            level: message.type(),
            text: message.text(),
        });
    });

    page.on('pageerror', (error) => {
        entries.push({
            source: 'pageerror',
            level: 'error',
            text: error.message,
        });
    });
}

/**
 * Base Electron fixture — launches a single ElectronApplication for boot-smoke and
 * single-player tests.
 *
 * Sets CHIMERA_E2E=1, NODE_ENV=test, CHIMERA_PORT=7778, and E2E path overrides
 * in the child process env.
 * Teardown calls app.close() unconditionally.
 *
 * Invariant 5:  window.__chimera is exposed only through preload/api.ts.
 * Invariant 27: CHIMERA_E2E must never appear in production packaging — set here only.
 */
export const test = base.extend<ElectronFixtures>({
    // eslint-disable-next-line no-empty-pattern
    rendererConsole: async ({}, use) => {
        const entries: RendererConsoleEntry[] = [];
        await use(entries);
    },

    electronApp: async ({ rendererConsole }, use) => {
        const app = await launchE2eElectronApplication({ port: '7778' });
        app.on('window', (page) => {
            attachRendererConsoleCapture(page, rendererConsole);
        });
        try {
            await use(app);
        } finally {
            await app.close();
        }
    },

    mainWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});

export { expect };
