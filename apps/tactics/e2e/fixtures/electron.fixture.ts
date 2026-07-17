import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'path';
import globalSetup from '../global-setup';
import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from '../../../../electron/main/renderer-url';
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

export type E2eElectronRole = 'host' | 'client';
export type E2eInitialRoute = `/${string}`;

export interface E2eElectronLaunchOptions {
    readonly port: string;
    readonly role?: E2eElectronRole;
    readonly initialRoute?: E2eInitialRoute;
    /** Configure direct-game host boot as a single-window two-local-seat match. */
    readonly passAndPlay?: boolean;
    /**
     * When set, the main process auto-hosts or auto-joins a lobby without
     * going through the lobby UI (`CHIMERA_E2E_DIRECT_GAME_ROLE` env var).
     */
    readonly directGameRole?: 'host' | 'client';
    /**
     * Lobby code the client process should join in direct-game mode
     * (`CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS` env var). Required when
     * `directGameRole === 'client'`.
     */
    readonly directGameJoinAddress?: string;
    /**
     * Launch the process in Runtime Debug Layer mode (`CHIMERA_DEBUG=1`),
     * enabling the debug bridge and the F9 Inspector window (Invariant #27:
     * debug mode is env-gated and never appears in production packaging —
     * NODE_ENV=test here keeps the gate satisfiable).
     */
    readonly debugMode?: boolean;
    /**
     * Override the game-assets root (`CHIMERA_E2E_GAME_ASSETS_ROOT`) for this
     * launch. Defaults to the repo `apps/` dir; the cursor overwrite spec
     * points it at a scratch copy with swapped cursor art. Must mirror the
     * `<root>/<gameId>/assets/<relativePath>` layout — the protocol handler
     * injects the `assets` segment itself.
     */
    readonly gameAssetsRoot?: string;
    /**
     * Force the hosted game to look like it declares NO spectator capability
     * (`CHIMERA_E2E_DISABLE_SPECTATORS=1`). Only tactics is wired for e2e
     * matches, so this lets the spectator spec exercise the "game has no
     * capability" reject path (`match_in_progress`) that is otherwise
     * unreachable with a capability-declaring game.
     */
    readonly disableSpectators?: boolean;
    /**
     * Force the host to run a live wall-clock `RealtimeTicker` at this interval
     * (`CHIMERA_E2E_REALTIME_TICK_MS`), overriding the manifest's `realtime`
     * flag. Only tactics is wired for e2e matches and tactics is turn-based
     * (`realtime: false`, null ticker), so this seam lets the heartbeat spec
     * exercise the real-time engine-tick loop — its autonomous firing and its
     * broadcast to clients — that is otherwise unreachable with a turn-based
     * game. Off outside this option: unset ⇒ the manifest flag stands.
     */
    readonly realtimeTickMs?: number;
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
    const role = options.role ?? 'single';
    const dirName = [
        process.pid.toString(),
        userDataLaunchCounter.toString(),
        safeUserDataSegment(role),
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
    // apps/tactics/e2e/fixtures → repo root is four levels up. .e2e-build stays
    // at the repo root.
    const root = path.resolve(__dirname, '../../../..');
    const e2eBuildRoot = path.join(root, '.e2e-build');
    const mainEntry = path.join(e2eBuildRoot, 'electron', 'main', 'index.js');
    const preloadPath = path.join(e2eBuildRoot, 'electron', 'preload', 'api.js');
    // The app owns its Next host: the GUI is built to apps/tactics/renderer/out,
    // not the root renderer/out.
    const rendererEntry = path.join(root, 'apps', 'tactics', 'renderer', 'out', 'index.html');
    // Game apps live under apps/<gameId>/.
    const gameAssetsRoot = path.join(root, 'apps');

    ensureE2eBuild(mainEntry, preloadPath, rendererEntry);
    const userDataDir = createFreshE2eUserDataDir(options);

    const env: Record<string, string> = {
        ...inheritEnv(),
        CHIMERA_E2E: '1',
        CHIMERA_E2E_PRELOAD_PATH: preloadPath,
        CHIMERA_E2E_RENDERER_ENTRY: rendererEntry,
        CHIMERA_E2E_GAME_ASSETS_ROOT: options.gameAssetsRoot ?? gameAssetsRoot,
        NODE_ENV: 'test',
        CHIMERA_PORT: options.port,
    };

    if (options.role !== undefined) {
        env['CHIMERA_ROLE'] = options.role;
    }

    const initialRoute =
        options.initialRoute ?? (options.directGameRole !== undefined ? '/game' : undefined);
    if (initialRoute !== undefined) {
        const initialRouteWithSlash = initialRoute.endsWith('/')
            ? initialRoute
            : `${initialRoute}/`;
        env['CHIMERA_E2E_INITIAL_URL'] =
            `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}${initialRouteWithSlash}`;
    }

    if (options.directGameRole !== undefined) {
        env['CHIMERA_E2E_DIRECT_GAME_ROLE'] = options.directGameRole;
    }

    if (options.directGameJoinAddress !== undefined) {
        env['CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS'] = options.directGameJoinAddress;
    }

    if (options.passAndPlay === true) {
        env['CHIMERA_E2E_PASS_AND_PLAY'] = '1';
    }

    if (options.debugMode === true) {
        env['CHIMERA_DEBUG'] = '1';
    }

    if (options.disableSpectators === true) {
        env['CHIMERA_E2E_DISABLE_SPECTATORS'] = '1';
    }

    if (options.realtimeTickMs !== undefined) {
        env['CHIMERA_E2E_REALTIME_TICK_MS'] = String(options.realtimeTickMs);
    }

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
