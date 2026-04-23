import * as path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { CLEAN_EXIT_IPC_CHANNEL } from '@chimera/shared/constants.js';
import {
    registerGameHandlers,
    registerLobbyHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
} from './ipc-handlers.js';
import { createLogger, type Logger, type LoggerSink } from './logger.js';
import { SaveManager } from './SaveManager.js';
import { SettingsManager } from './SettingsManager.js';
import { FileSettingsRepository } from './FileSettingsRepository.js';
import { InMemorySaveRepository } from '@chimera/simulation/persistence/index.js';
import { tacticsSettingsSchema } from '@chimera/games/tactics/settings-schema.js';

export { CLEAN_EXIT_IPC_CHANNEL };

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
 * Narrow slice of `Electron.IpcMain` required to register the crash-status
 * handler. Declared locally so tests do not need a full `IpcMain`.
 */
export interface CleanExitIpcMain {
    handle(channel: string, handler: () => unknown): unknown;
}

export interface RegisterCleanExitIpcOptions {
    readonly ipcMain: CleanExitIpcMain;
    readonly wasCleanExit: boolean;
}

// ─── SaveManager lifecycle wiring ─────────────────────────────────────────────

import type { SaveSlotMeta } from '@chimera/simulation/persistence/SaveRepository.js';

/**
 * Narrow slice of `Electron.App` required by the SaveManager lifecycle hook.
 */
export interface SaveManagerLifecycleAppHost {
    on(event: 'before-quit', handler: () => void): unknown;
}

export interface RegisterSaveManagerLifecycleOptions {
    readonly app: SaveManagerLifecycleAppHost;
    readonly saveManager: {
        clearCleanExitFlag(): Promise<boolean>;
        markCleanExit(): Promise<void>;
        checkCrashRecovery(knownGameIds: readonly string[]): Promise<SaveSlotMeta | null>;
    };
    readonly knownGameIds: readonly string[];
}

export interface SaveManagerLifecycleResult {
    /** The autosave slot meta if the previous session crashed and a save was found; null otherwise. */
    readonly autosaveMeta: SaveSlotMeta | null;
    /**
     * `true` when the clean-exit flag was present at startup (graceful shutdown);
     * `false` when it was absent (crash or first run).
     */
    readonly wasCleanExit: boolean;
}

/**
 * Wire `SaveManager` into the application lifecycle:
 *   1. Clear the clean-exit flag at startup so the next launch detects a crash.
 *   2. Register `markCleanExit()` on `before-quit` for graceful shutdown.
 *   3. Run `checkCrashRecovery()` to detect an unclean previous exit.
 *
 * Returns `{ autosaveMeta }` — non-null when the previous session crashed and
 * an autosave was found. The caller can surface the "Resume last session" prompt
 * based on this value.
 */
export async function registerSaveManagerLifecycle(
    options: RegisterSaveManagerLifecycleOptions,
): Promise<SaveManagerLifecycleResult> {
    const { app: appHost, saveManager, knownGameIds } = options;

    // 1. Check if the previous session crashed (flag present = clean exit).
    //    Must happen BEFORE clearing the flag; otherwise the evidence is gone.
    const autosaveMeta = await saveManager.checkCrashRecovery(knownGameIds);

    // 2. Clear the flag and capture whether it was present (true = clean exit).
    const wasCleanExit = await saveManager.clearCleanExitFlag();

    // 3. Write the flag on graceful shutdown.
    appHost.on('before-quit', () => {
        void saveManager.markCleanExit();
    });

    return { autosaveMeta, wasCleanExit };
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
 * Construct the production {@link LoggerSink} used by the main process.
 *
 * F02 ships a no-op sink \u2014 the `Logger` interface + injection plumbing is
 * the invariant-67 deliverable; rotated Pino-backed files under
 * `userData/logs/` land in F43 (\u00a74.27) alongside the crash reporter.
 * Swapping the sink is a one-line change here; nothing else in the main
 * process needs to know.\n */
function createProductionLoggerSink(): LoggerSink {
    // Intentional noop for F02. Replace with the Pino sink in F43.
    // `createNoopLogger` wraps this same behaviour; using its internal sink
    // would leak module state, so we declare the no-op inline instead.
    return {
        write: () => {
            // F43: pino.destination + daily rotation lives here.
        },
    };
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
export async function main(): Promise<void> {
    const preloadPath = path.join(__dirname, '..', 'preload', 'api.js');
    const rendererEntry = path.join(__dirname, '..', '..', 'renderer', 'out', 'index.html');
    const env = resolveChimeraEnv(process.env['CHIMERA_ENV']);
    const userData = app.getPath('userData');

    // Construct the root main-process logger once (invariant 67). The sink
    // is currently a noop — production sinks (Pino + userData/logs rotation)
    // land in F43 alongside the crash reporter. Child loggers are injected
    // into each register*Handlers call so every namespace is tagged with its
    // own `module`. Managers landing in F03+ will demand a required
    // `logger` rather than falling back to noop.
    const logger: Logger = createLogger({
        source: { process: 'main', module: 'root' },
        sink: createProductionLoggerSink(),
    });

    // Create the SaveManager. InMemorySaveRepository is a temporary placeholder
    // until F18 wires FileSaveRepository; the crash-recovery flag operations
    // (markCleanExit / clearCleanExitFlag) are handled directly by SaveManager
    // using `userData` and do not touch the repository.
    const saveManager = new SaveManager(
        new InMemorySaveRepository(),
        userData,
        logger.child({ module: 'saves' }),
    );

    // Wire the SaveManager lifecycle: checks crash recovery, clears the flag,
    // and registers the before-quit handler. Returns wasCleanExit for the IPC
    // channel so the renderer can prompt crash-recovery on startup.
    const { wasCleanExit } = await registerSaveManagerLifecycle({
        app,
        saveManager,
        knownGameIds: [],
    });

    // Expose the crash-status to the renderer via a dedicated IPC channel.
    // Captured before any window opens so the renderer never races the handler.
    registerCleanExitIpc({ ipcMain, wasCleanExit });

    // Register the `chimera:system:*` channels (platform info, quit). Runs
    // before the first window opens so the renderer never races the handler
    // registration. Other preload namespaces land in later F02 tasks.
    registerSystemHandlers({
        ipcMain,
        app,
        platform: process.platform,
        electronVersion: process.versions.electron ?? '',
        logger: logger.child({ module: 'system' }),
    });

    // Register the `chimera:game:*` channels as stubs. Actual ActionPipeline
    // dispatch and seat-switch logic land in F03–F15; wiring the handlers
    // here lets the preload bridge already speak the full protocol without
    // racing the engine work.
    registerGameHandlers({ ipcMain, logger: logger.child({ module: 'game' }) });

    // Register the `chimera:lobby:*` channels as stubs. Real lobby logic
    // (host/join/leave/state broadcast) lands in F11; wiring stubs here
    // lets the preload bridge and renderer already speak the full lobby
    // protocol without unhandled-channel errors.
    registerLobbyHandlers({ ipcMain, logger: logger.child({ module: 'lobby' }) });

    // Register the `chimera:saves:*` channels as stubs. Real save
    // persistence (SaveRepository, slot indexing, autosave cadence)
    // lands in F06/F18; wiring stubs here keeps the renderer's typed
    // Promises from rejecting before persistence exists.
    registerSavesHandlers({ ipcMain, logger: logger.child({ module: 'saves' }) });

    // Register the `chimera:settings:*` channels backed by SettingsManager.
    // FileSettingsRepository persists user overrides under `<userData>/settings/`.
    // TacticsSettings schema is registered here so getSettings('tactics')
    // returns full game defaults rather than bare engine defaults.
    const settingsRepo = new FileSettingsRepository(path.join(userData, 'settings'));
    const settingsManager = new SettingsManager(settingsRepo);
    settingsManager.registerSchema(tacticsSettingsSchema);
    registerSettingsHandlers({
        ipcMain,
        logger: logger.child({ module: 'settings' }),
        settingsManager,
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
    void main();
}
