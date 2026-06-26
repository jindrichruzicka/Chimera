import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import globalSetup from '../global-setup';
import { inheritEnv } from './inherit-env';

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

export interface E2eElectronLaunchOptions {
    readonly port: string;
}

export interface E2eElectronLaunchConfig {
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

let e2eBuildReady = false;
let userDataLaunchCounter = 0;

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

function safeUserDataSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function createFreshE2eUserDataDir(options: E2eElectronLaunchOptions): string {
    userDataLaunchCounter += 1;
    const dirName = [
        process.pid.toString(),
        userDataLaunchCounter.toString(),
        safeUserDataSegment(options.port),
    ].join('-');
    const userDataDir = path.join(os.tmpdir(), 'chimera-e2e-userdata', dirName);

    rmSync(userDataDir, { recursive: true, force: true });
    mkdirSync(userDataDir, { recursive: true });

    return userDataDir;
}

export function createE2eElectronLaunchConfig(
    options: E2eElectronLaunchOptions,
): E2eElectronLaunchConfig {
    // apps/<game>/e2e/fixtures → repo root is four levels up. .e2e-build stays at the repo root.
    const root = path.resolve(__dirname, '../../../..');
    const e2eBuildRoot = path.join(root, '.e2e-build');
    const mainEntry = path.join(e2eBuildRoot, 'electron', 'main', 'index.js');
    const preloadPath = path.join(e2eBuildRoot, 'electron', 'preload', 'api.js');
    // The app owns its Next host: the GUI is built to apps/<game>/renderer/out.
    const rendererEntry = path.join(
        root,
        'apps',
        '__game_kebab__',
        'renderer',
        'out',
        'index.html',
    );
    // Game apps live under apps/<gameId>/.
    const gameAssetsRoot = path.join(root, 'apps');

    ensureE2eBuild(mainEntry, preloadPath, rendererEntry);
    const userDataDir = createFreshE2eUserDataDir(options);

    const env: Record<string, string> = {
        ...inheritEnv(),
        CHIMERA_E2E: '1',
        CHIMERA_E2E_PRELOAD_PATH: preloadPath,
        CHIMERA_E2E_RENDERER_ENTRY: rendererEntry,
        CHIMERA_E2E_GAME_ASSETS_ROOT: gameAssetsRoot,
        NODE_ENV: 'test',
        CHIMERA_PORT: options.port,
    };

    return {
        args: [mainEntry, `--user-data-dir=${userDataDir}`],
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
 * Base Electron fixture — launches a single ElectronApplication for the boot-smoke spec.
 *
 * Sets CHIMERA_E2E=1, NODE_ENV=test, CHIMERA_PORT=7778, and the E2E path overrides in
 * the child process env. Teardown calls app.close() unconditionally.
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
