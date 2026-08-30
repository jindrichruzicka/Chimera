/**
 * apps/action/e2e/fixtures/electron.fixture.ts
 *
 * The action suite's base Electron fixture: one launched `ElectronApplication`
 * per test, booted at this game's own main menu on a fresh Chromium profile.
 *
 * It is deliberately SMALLER than the tactics suite's. This app ships no
 * multiplayer flow, so there is no host/client pair, no lobby bootstrap and no
 * direct-game latch to model: every spec here starts where a player starts — on
 * the menu — and drives the shipped verbs from there. The `CHIMERA_E2E`
 * auto-start seams are not offered at all, because a spec that booted straight
 * into a match would leave `chimera:lobby:quick-start` untested on its only
 * production path.
 *
 * This is the app's own copy rather than a shared module: `apps/<game>` may not
 * import another game's directory (module boundaries §3).
 *
 * `CHIMERA_E2E` is set by this fixture, on the launch it makes. No packaging
 * script sets it, and `tools/e2e-workflow.test.ts` pins that the CI workflow's
 * `env:` blocks do not either — those two are the properties that are checked;
 * a launched app in this suite reaches the flag from here and nowhere it could
 * inherit. The launched app reaches the bridge through the preload this fixture
 * points it at, which is the only module allowed to expose `window.__chimera`
 * (Invariant #5); `CHIMERA_DEBUG` is stripped on the way in, so an e2e launch
 * can never enter the runtime debug layer (Invariant #27, §4.12).
 */

import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from '../../../../electron/main/renderer-url';
import { ACTION_GAME_ID } from '@chimera-engine/action/simulation/constants.js';
import globalSetup, {
    resolveActionE2eBuildRoot,
    resolveActionE2eOutfiles,
    resolveActionRendererEntry,
} from '../global-setup';
import { inheritEnv } from './inherit-env';
import { E2E_USER_DATA_ROOT } from './user-data-root';
import { captureMainProcessOutput, openE2eWindow } from './open-window';

export type E2eInitialRoute = `/${string}`;

/** A shell route carrying this game's context, the way production launches do. */
export function actionRoute(route: E2eInitialRoute): E2eInitialRoute {
    return `${route}?gameId=${ACTION_GAME_ID}`;
}

/**
 * Where every launch boots.
 *
 * The production launch URL for a hosted game is `buildRendererGameLaunchUrl`'s
 * `/main-menu/?gameId=<id>`, so booting anywhere else — or here without the
 * context — would put the spec on the ENGINE-default menu, which contributes
 * none of this game's entries.
 */
export const ACTION_MENU_ROUTE: E2eInitialRoute = actionRoute('/main-menu');

export interface E2eElectronLaunchOptions {
    /**
     * `CHIMERA_PORT` for this launch. A spec that hosts a session needs one of
     * its own — see {@link ElectronOptions.actionPort}, which is how a spec
     * file declares it.
     */
    readonly port: string;
    /** Boot route; defaults to {@link ACTION_MENU_ROUTE}. */
    readonly initialRoute?: E2eInitialRoute;
}

export interface E2eElectronLaunchConfig {
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

export interface ElectronFixtures {
    readonly electronApp: ElectronApplication;
    readonly mainWindow: Page;
}

export interface ElectronOptions {
    /**
     * `CHIMERA_PORT` for this spec file's launches.
     *
     * A Playwright OPTION rather than a constant, because the config runs two
     * workers: `fullyParallel: false` serialises the tests inside one file, not
     * the files themselves, so two spec files run at once. Nearly every spec
     * here hosts a quick-started session, which binds the port — so each file
     * declares one of its own through `test.use({ actionPort })` and two
     * concurrent workers cannot collide.
     */
    readonly actionPort: string;
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
    // The pid separates two WORKERS (each restarts the counter at zero); the
    // counter separates two launches inside one worker. Both are needed: a spec
    // that relaunches would otherwise re-open the previous app's profile, and
    // "a fresh profile has no autosave" would become a fact about test order.
    const dirName = [
        process.pid.toString(),
        userDataLaunchCounter.toString(),
        safeUserDataSegment(options.port),
    ].join('-');
    // Under E2E_USER_DATA_ROOT, never an ad-hoc temp path: the profile outlives
    // its app, and global-setup's per-run reap can only reach a profile put
    // inside that root.
    const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);

    rmSync(userDataDir, { recursive: true, force: true });
    mkdirSync(userDataDir, { recursive: true });

    return userDataDir;
}

export function createE2eElectronLaunchConfig(
    options: E2eElectronLaunchOptions,
): E2eElectronLaunchConfig {
    // apps/action/e2e/fixtures → repo root is four levels up.
    const root = path.resolve(__dirname, '../../../..');
    const outfiles = resolveActionE2eOutfiles(resolveActionE2eBuildRoot(root));
    const rendererEntry = resolveActionRendererEntry(root);
    // Game apps live under apps/<gameId>/; the protocol handler injects the
    // `assets` segment itself.
    const gameAssetsRoot = path.join(root, 'apps');

    ensureE2eBuild(outfiles.main, outfiles.preload, rendererEntry);
    const userDataDir = createFreshE2eUserDataDir(options);

    const initialRoute = options.initialRoute ?? ACTION_MENU_ROUTE;
    // The static-export router needs a trailing slash on the PATH; a query
    // string (`?gameId=action`) must stay behind it untouched.
    const queryIndex = initialRoute.indexOf('?');
    const routePath = queryIndex === -1 ? initialRoute : initialRoute.slice(0, queryIndex);
    const routeQuery = queryIndex === -1 ? '' : initialRoute.slice(queryIndex);
    const routePathWithSlash = routePath.endsWith('/') ? routePath : `${routePath}/`;

    const env: Record<string, string> = {
        ...inheritEnv(),
        CHIMERA_E2E: '1',
        CHIMERA_E2E_PRELOAD_PATH: outfiles.preload,
        CHIMERA_E2E_RENDERER_ENTRY: rendererEntry,
        CHIMERA_E2E_GAME_ASSETS_ROOT: gameAssetsRoot,
        CHIMERA_E2E_INITIAL_URL: `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}${routePathWithSlash}${routeQuery}`,
        NODE_ENV: 'test',
        CHIMERA_PORT: options.port,
    };

    return {
        args: [outfiles.main, `--user-data-dir=${userDataDir}`],
        env,
    };
}

export async function launchE2eElectronApplication(
    options: E2eElectronLaunchOptions,
): Promise<ElectronApplication> {
    const launchConfig = createE2eElectronLaunchConfig(options);

    const app = await electron.launch({
        args: [...launchConfig.args],
        env: launchConfig.env,
    });
    // Recording starts here rather than at the first window wait: an app that
    // dies during `app.whenReady()` has written its reason to stderr and exited
    // long before any test asks for a window.
    captureMainProcessOutput(app);
    return app;
}

/** The port a spec that declares none takes. */
export const DEFAULT_ACTION_PORT = '7810';

export const test = base.extend<ElectronFixtures & ElectronOptions>({
    actionPort: [DEFAULT_ACTION_PORT, { option: true }],

    electronApp: async ({ actionPort }, use) => {
        // Menu boot, every time: no auto-start latch, so every match in this
        // suite is opened by the shipped verb on its only production path.
        // Every launch also gets a fresh user-data dir, which is what makes "a
        // fresh profile has no autosave" a fact about the app rather than about
        // test order.
        const app = await launchE2eElectronApplication({ port: actionPort });
        try {
            await use(app);
        } finally {
            await app.close().catch(() => undefined);
        }
    },

    mainWindow: async ({ electronApp }, use) => {
        await use(await openE2eWindow(electronApp));
    },
});

export { expect };
