import * as path from 'node:path';
import { app, BrowserWindow } from 'electron';

/**
 * Narrow slice of `Electron.App` required by `registerAppLifecycle`.
 * Declared here so callers (and tests) are not forced to construct a full
 * `Electron.App` instance to exercise lifecycle behaviour.
 */
export interface AppLifecycleHost {
    on(event: 'window-all-closed' | 'activate', handler: () => void): unknown;
    quit(): void;
}

export interface CreateMainWindowOptions {
    readonly preloadPath: string;
}

export interface RegisterAppLifecycleOptions {
    readonly app: AppLifecycleHost;
    readonly platform: NodeJS.Platform;
    readonly getOpenWindowCount: () => number;
    readonly createWindow: () => void;
}

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;

/**
 * Construct the primary renderer `BrowserWindow`.
 *
 * Security invariants (see architecture overview, Appendix B #3 and #4):
 *   - `nodeIntegration` MUST be `false`
 *   - `contextIsolation` MUST be `true`
 *
 * The preload script path is passed in rather than resolved here so the
 * caller controls filesystem layout and tests can assert the wiring.
 */
export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
    return new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: options.preloadPath,
        },
    });
}

/**
 * Install the app-lifecycle listeners required for correct cross-platform
 * behaviour:
 *   - `window-all-closed`: quit the app on win32/linux; on macOS the process
 *     stays alive until the user explicitly quits (Cmd-Q).
 *   - `activate`: re-create the main window when the dock icon is clicked
 *     and no windows are currently open (macOS).
 */
export function registerAppLifecycle(options: RegisterAppLifecycleOptions): void {
    const { app: appHost, platform, getOpenWindowCount, createWindow } = options;

    appHost.on('window-all-closed', () => {
        if (platform !== 'darwin') {
            appHost.quit();
        }
    });

    appHost.on('activate', () => {
        if (getOpenWindowCount() === 0) {
            createWindow();
        }
    });
}

/**
 * Entry-point orchestration. Kept as a distinct function so tests can import
 * the helpers above without triggering Electron lifecycle side effects.
 *
 * Preload path follows the convention declared in issue #2:
 *   `path.join(__dirname, '../preload/api.js')`
 */
export function main(): void {
    const preloadPath = path.join(__dirname, '..', 'preload', 'api.js');

    const createWindow = (): void => {
        createMainWindow({ preloadPath });
    };

    void app.whenReady().then(createWindow);

    registerAppLifecycle({
        app,
        platform: process.platform,
        getOpenWindowCount: () => BrowserWindow.getAllWindows().length,
        createWindow,
    });
}

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    main();
}
