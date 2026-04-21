// electron/main/ipc-handlers.ts
//
// Registers the main-process IPC handlers exposed through the preload
// namespaces. One `register<Namespace>Handlers` function per namespace keeps
// registration auditable and matches the one-module-per-namespace convention
// on the preload side (§4.1).
//
// Currently wired: `chimera:system:*` (see preload/system-api.ts) and
// `chimera:game:*` stubs (see preload/game-api.ts). The game handlers are
// stubs only — actual game/simulation logic is wired in F03–F15.

import {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    type PlatformInfo,
} from '../preload/system-api.js';
import {
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_SWITCH_SEAT_CHANNEL,
} from '../preload/game-api.js';

export {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_SWITCH_SEAT_CHANNEL,
};

/**
 * Narrow slice of `Electron.IpcMain` required to register the system-namespace
 * channels. Declared locally so tests can drive the registration with a plain
 * in-memory stub (see architecture §10.0 — no real IPC in unit tests).
 */
export interface SystemHandlersIpcMain {
    handle(channel: string, handler: () => unknown): unknown;
    on(channel: string, handler: () => void): unknown;
}

/**
 * Narrow slice of `Electron.App` required by the system-namespace handlers.
 * Only `quit()` is called; widening this interface is an architectural
 * change that requires a new invariant note.
 */
export interface SystemHandlersAppHost {
    quit(): void;
}

export interface RegisterSystemHandlersOptions {
    readonly ipcMain: SystemHandlersIpcMain;
    readonly app: SystemHandlersAppHost;
    readonly platform: NodeJS.Platform;
    readonly electronVersion: string;
}

/**
 * Translate Node's `process.platform` strings to the tri-state surface the
 * renderer contracts for ({@link PlatformInfo.os}).
 *
 * Unknown platforms (freebsd, aix, openbsd, sunos, …) fall back to `'linux'`
 * rather than throwing. A throw here would brick boot on an unusual dev
 * machine for a value the renderer barely uses; falling back is safer.
 */
export function mapPlatform(platform: NodeJS.Platform): PlatformInfo['os'] {
    switch (platform) {
        case 'darwin':
            return 'macos';
        case 'win32':
            return 'windows';
        default:
            return 'linux';
    }
}

/**
 * Register every `chimera:system:*` channel on the main side. Intended to be
 * called exactly once from `main()` during app bootstrap, before the first
 * window opens, so the renderer never races the handler registration.
 *
 * Invariant 5: the channel constants come from `preload/system-api.ts`; there
 * is no parallel list in this file to drift out of sync.
 */
export function registerSystemHandlers(options: RegisterSystemHandlersOptions): void {
    const { ipcMain, app, platform, electronVersion } = options;

    ipcMain.handle(SYSTEM_PLATFORM_CHANNEL, () => {
        const info: PlatformInfo = {
            os: mapPlatform(platform),
            version: electronVersion,
        };
        return info;
    });

    ipcMain.on(SYSTEM_QUIT_CHANNEL, () => {
        app.quit();
    });
}

/**
 * Shape of a main-side `ipcMain.on` listener for the game namespace. The real
 * Electron signature is `(event: IpcMainEvent, ...args: unknown[]) => void`;
 * a permissive union here keeps tests free of Electron types.
 */
export type GameHandlerListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Shape of a main-side `ipcMain.handle` handler for the game namespace. The
 * real Electron signature is
 * `(event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>`.
 */
export type GameInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the game-namespace
 * channels. Declared locally so tests can drive the registration with a plain
 * in-memory stub (architecture §10.0 — no real IPC in unit tests).
 */
export interface GameHandlersIpcMain {
    handle(channel: string, handler: GameInvokeHandler): unknown;
    on(channel: string, handler: GameHandlerListener): unknown;
}

export interface RegisterGameHandlersOptions {
    readonly ipcMain: GameHandlersIpcMain;
}

/**
 * Register every `chimera:game:*` main-side channel. These are deliberate
 * stubs — actual ActionPipeline dispatch, seat switching, and snapshot
 * broadcasting are wired in F03–F15. Registering them here lets the preload
 * bridge and renderer already speak their half of the protocol without
 * racing the later wiring.
 *
 * `chimera:game:snapshot` is intentionally absent: it is a one-way push from
 * main → renderer via `webContents.send`. There is no main-side listener or
 * invoke handler for that channel.
 *
 * Invariants touched:
 *   - #3: `GameSnapshot` never crosses any IPC boundary — the stubs do not
 *         accept or emit a `GameSnapshot`; the eventual snapshot channel
 *         carries `PlayerSnapshot` only.
 *   - #4: The renderer only writes through `sendAction` (and seat switching,
 *         which is state-adjacent but not a game action write).
 *   - #5: Channel constants are imported from `preload/game-api.ts`; there is
 *         no parallel list in this file to drift out of sync.
 */
export function registerGameHandlers(options: RegisterGameHandlersOptions): void {
    const { ipcMain } = options;

    ipcMain.on(GAME_SEND_ACTION_CHANNEL, () => {
        // Stub. ActionPipeline integration lands in F03–F15. Silently
        // accepting the payload keeps the renderer's write path functional
        // (no unhandled-channel errors) before the engine wiring exists.
    });

    ipcMain.handle(GAME_SWITCH_SEAT_CHANNEL, () => {
        // Stub. Real seat-switch logic lands alongside the session/local
        // multi-seat work. Returning `undefined` satisfies the
        // `Promise<void>` contract declared by `GameAPI.switchActiveSeat`.
        return undefined;
    });
}
