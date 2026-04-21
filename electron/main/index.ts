import * as path from 'node:path';
import * as fs from 'node:fs';
import { app, BrowserWindow, ipcMain } from 'electron';
import { CLEAN_EXIT_IPC_CHANNEL, CLEAN_EXIT_FLAG_FILENAME } from '../../shared/constants.js';
import { registerSystemHandlers } from './ipc-handlers.js';

export { CLEAN_EXIT_IPC_CHANNEL, CLEAN_EXIT_FLAG_FILENAME };

/**
 * Narrow slice of `Electron.App` required by `registerAppLifecycle`.
 * Declared here so callers (and tests) are not forced to construct a full
 * `Electron.App` instance to exercise lifecycle behaviour.
 */
export interface AppLifecycleHost {
    on(event: 'window-all-closed' | 'activate', handler: () => void): unknown;
    quit(): void;
}

/**
 * Runtime mode flag surfaced to the renderer via `--chimera-env=...` on
 * `process.argv`. Anything outside this union falls back to `'production'`
 * (see `resolveChimeraEnv`).
 */
export type ChimeraEnv = 'development' | 'production';

export interface CreateMainWindowOptions {
    readonly preloadPath: string;
    /** Absolute path to the Next.js static-export entry HTML file. */
    readonly rendererEntry: string;
    readonly env: ChimeraEnv;
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
 * Resolve the `ChimeraEnv` runtime mode from the raw `CHIMERA_ENV` environment
 * variable. Unknown or missing values default to `'production'` so that an
 * unconfigured production build cannot accidentally expose developer-mode
 * behaviour (e.g. DevTools).
 */
export function resolveChimeraEnv(raw: string | undefined): ChimeraEnv {
    return raw === 'development' ? 'development' : 'production';
}

/**
 * Narrow filesystem port used by the clean-exit flag helpers. Exposing only
 * the three calls actually required keeps tests free of real filesystem
 * access (see architecture section 10.0 — no real FS in unit tests).
 */
export interface CleanExitFileSystem {
    existsSync(path: string): boolean;
    writeFileSync(path: string, data: string): void;
    unlinkSync(path: string): void;
}

export interface CleanExitFlagOptions {
    readonly flagPath: string;
    readonly fs: CleanExitFileSystem;
}

export interface CleanExitCheckResult {
    readonly wasCleanExit: boolean;
}

/**
 * Narrow slice of `Electron.App` required to register the clean-exit hook.
 * A separate interface from `AppLifecycleHost` because the event name
 * `'before-quit'` is distinct from the lifecycle events handled there.
 */
export interface CleanExitAppHost {
    on(event: 'before-quit', handler: () => void): unknown;
}

/**
 * Narrow slice of `Electron.IpcMain` required to register the crash-status
 * handler. Declared locally so tests do not need a full `IpcMain`.
 */
export interface CleanExitIpcMain {
    handle(channel: string, handler: () => unknown): unknown;
}

export interface RegisterCleanExitHookOptions extends CleanExitFlagOptions {
    readonly app: CleanExitAppHost;
}

export interface RegisterCleanExitIpcOptions {
    readonly ipcMain: CleanExitIpcMain;
    readonly wasCleanExit: boolean;
}

/**
 * Inspect (and consume) the `lastCleanExit.flag` sentinel at startup.
 *
 * - If the flag is present, the previous shutdown completed cleanly. The flag
 *   is deleted immediately so the next launch starts from a blank slate; a
 *   subsequent force-kill will then be correctly detected as a crash.
 * - If the flag is absent, the previous session terminated without running
 *   the `before-quit` hook (crash, SIGKILL, power loss).
 *
 * Invariant 38 (Appendix B): the sentinel must be written atomically before
 * process exit; this helper only *consumes* it on startup.
 */
export function checkCleanExitFlag(options: CleanExitFlagOptions): CleanExitCheckResult {
    const { flagPath, fs: fsPort } = options;
    const wasCleanExit = fsPort.existsSync(flagPath);
    if (wasCleanExit) {
        fsPort.unlinkSync(flagPath);
    }
    return { wasCleanExit };
}

/**
 * Write the `lastCleanExit.flag` sentinel synchronously. Called from the
 * `before-quit` hook after all save operations have finished so that the
 * flag's presence genuinely signals a clean shutdown.
 */
export function writeCleanExitFlag(options: CleanExitFlagOptions): void {
    options.fs.writeFileSync(options.flagPath, '');
}

/**
 * Wire the clean-exit sentinel into Electron's `before-quit` event. The hook
 * writes synchronously to honour invariant 38 — the flag must land on disk
 * before the process exits.
 */
export function registerCleanExitHook(options: RegisterCleanExitHookOptions): void {
    const { app: appHost, flagPath, fs: fsPort } = options;
    appHost.on('before-quit', () => {
        writeCleanExitFlag({ flagPath, fs: fsPort });
    });
}

/**
 * Expose the captured clean-exit status to the renderer via a dedicated IPC
 * channel. The value is captured at startup (before any window opens) and
 * does not change over the lifetime of the process.
 */
export function registerCleanExitIpc(options: RegisterCleanExitIpcOptions): void {
    options.ipcMain.handle(CLEAN_EXIT_IPC_CHANNEL, () => options.wasCleanExit);
}

/**
 * Construct the primary renderer `BrowserWindow` and load the Next.js static
 * export (`renderer/out/index.html`).
 *
 * Security invariants (see architecture overview, Appendix B #3 and #4):
 *   - `nodeIntegration` MUST be `false`
 *   - `contextIsolation` MUST be `true`
 *
 * The preload script path and renderer entry are passed in rather than
 * resolved here so the caller controls filesystem layout and tests can
 * assert the wiring. The `--chimera-env=<env>` flag is injected via
 * `additionalArguments` so the renderer can read it from `process.argv`.
 */
export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
    const window = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: options.preloadPath,
            additionalArguments: [`--chimera-env=${options.env}`],
        },
    });

    void window.loadFile(options.rendererEntry);

    if (options.env === 'development') {
        window.webContents.openDevTools();
    }

    return window;
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
 *
 * Renderer entry follows issue #3:
 *   `path.join(__dirname, '../../renderer/out/index.html')`
 */
export function main(): void {
    const preloadPath = path.join(__dirname, '..', 'preload', 'api.js');
    const rendererEntry = path.join(__dirname, '..', '..', 'renderer', 'out', 'index.html');
    const env = resolveChimeraEnv(process.env['CHIMERA_ENV']);
    const flagPath = path.join(app.getPath('userData'), CLEAN_EXIT_FLAG_FILENAME);

    // Capture crash status before any window opens so the renderer can
    // reliably ask for it via the IPC channel.
    const { wasCleanExit } = checkCleanExitFlag({ flagPath, fs });
    registerCleanExitIpc({ ipcMain, wasCleanExit });
    registerCleanExitHook({ app, flagPath, fs });

    // Register the `chimera:system:*` channels (platform info, quit). Runs
    // before the first window opens so the renderer never races the handler
    // registration. Other preload namespaces land in later F02 tasks.
    registerSystemHandlers({
        ipcMain,
        app,
        platform: process.platform,
        electronVersion: process.versions.electron ?? '',
    });

    const createWindow = (): void => {
        createMainWindow({ preloadPath, rendererEntry, env });
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
