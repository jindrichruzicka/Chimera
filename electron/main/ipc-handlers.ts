// electron/main/ipc-handlers.ts
//
// Registers the main-process IPC handlers exposed through the preload
// namespaces. One `register<Namespace>Handlers` function per namespace keeps
// registration auditable and matches the one-module-per-namespace convention
// on the preload side (§4.1).
//
// Currently wired: `chimera:system:*` (see preload/system-api.ts),
// `chimera:game:*` stubs (see preload/game-api.ts), `chimera:lobby:*` stubs
// (see preload/lobby-api.ts), `chimera:saves:*` stubs (see
// preload/saves-api.ts), and `chimera:settings:*` stubs (see
// preload/settings-api.ts). The game/lobby/saves/settings handlers are stubs
// only — actual game/simulation logic lands in F03–F15; real lobby logic
// lands in F11; real save persistence lands in F06/F18; real settings
// merging and persistence land in F07/F19.

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
import {
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
} from '../preload/lobby-api.js';
import {
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
} from '../preload/saves-api.js';
import {
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
} from '../preload/settings-api.js';
import type { LobbyInfo, ResolvedSettings, SaveSlotMeta } from '../preload/api.js';
import {
    EngineActionSchema,
    GameIdSchema,
    HostLobbyParamsSchema,
    JoinLobbyParamsSchema,
    PlayerIdSchema,
    SaveRequestSchema,
    SlotIdSchema,
    UserSettingsPatchSchema,
    parseInvokeRequest,
} from './ipc-schemas.js';

export {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_SWITCH_SEAT_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
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

    ipcMain.on(GAME_SEND_ACTION_CHANNEL, (_event, action) => {
        // Validate the envelope before handing off to the (future)
        // ActionPipeline. Per §4.7 the action-type-specific payload
        // schema lives in the simulation layer; here we only guard the
        // outer envelope so malformed requests never reach the pipeline.
        parseInvokeRequest(EngineActionSchema, GAME_SEND_ACTION_CHANNEL, action);
        // Stub. ActionPipeline integration lands in F03–F15.
    });

    ipcMain.handle(GAME_SWITCH_SEAT_CHANNEL, (_event, playerId) => {
        parseInvokeRequest(PlayerIdSchema, GAME_SWITCH_SEAT_CHANNEL, playerId);
        // Stub. Real seat-switch logic lands alongside the session/local
        // multi-seat work. Returning `undefined` satisfies the
        // `Promise<void>` contract declared by `GameAPI.switchActiveSeat`.
        return undefined;
    });
}

/**
 * Shape of a main-side `ipcMain.on` listener for the lobby namespace.
 * Mirrors {@link GameHandlerListener} — permissive types keep tests free of
 * Electron imports.
 */
export type LobbyHandlerListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Shape of a main-side `ipcMain.handle` handler for the lobby namespace.
 * Mirrors {@link GameInvokeHandler}.
 */
export type LobbyInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the lobby-namespace
 * channels.
 */
export interface LobbyHandlersIpcMain {
    handle(channel: string, handler: LobbyInvokeHandler): unknown;
    on(channel: string, handler: LobbyHandlerListener): unknown;
}

export interface RegisterLobbyHandlersOptions {
    readonly ipcMain: LobbyHandlersIpcMain;
}

/**
 * Placeholder `LobbyInfo` returned by the host/join stubs. Real values come
 * from the `MultiplayerProvider` in F11. The shape must match
 * `LobbyInfo` from `preload/api.ts` so the preload's typed cast is honest.
 */
const STUB_LOBBY_INFO: LobbyInfo = {
    sessionId: '',
    hostId: '',
    gameId: '',
};

/**
 * Register every `chimera:lobby:*` main-side channel. These are deliberate
 * stubs — actual lobby hosting, joining, and broadcasting the `LobbyState`
 * update stream land in F11.
 *
 * `chimera:lobby:update` is intentionally absent: it is a one-way push from
 * main → renderer via `webContents.send`. There is no main-side listener
 * or invoke handler for that channel.
 *
 * `chimera:lobby:list` (LobbyDiscoveryAPI) is deferred to F09/F10 and is
 * surfaced only when the active MultiplayerProvider implements
 * `BrowsableProvider` (§4.1, §4.14).
 *
 * Invariant 5: channel constants come from `preload/lobby-api.ts`; there is
 * no parallel list in this file to drift out of sync.
 */
export function registerLobbyHandlers(options: RegisterLobbyHandlersOptions): void {
    const { ipcMain } = options;

    ipcMain.handle(LOBBY_HOST_CHANNEL, (_event, params) => {
        parseInvokeRequest(HostLobbyParamsSchema, LOBBY_HOST_CHANNEL, params);
        // Stub. Real host logic (MultiplayerProvider + session wiring) lands
        // in F11. Returning a placeholder `LobbyInfo` keeps the preload's
        // `Promise<LobbyInfo>` contract honest before the engine wiring
        // exists — callers that rely on the real value simply do not exist
        // yet on the renderer side.
        return STUB_LOBBY_INFO;
    });

    ipcMain.handle(LOBBY_JOIN_CHANNEL, (_event, params) => {
        parseInvokeRequest(JoinLobbyParamsSchema, LOBBY_JOIN_CHANNEL, params);
        // Stub. Real join logic lands in F11.
        return STUB_LOBBY_INFO;
    });

    ipcMain.on(LOBBY_LEAVE_CHANNEL, () => {
        // Stub. Real leave logic (tear down session, notify peers) lands in
        // F11. Silently accepting the message keeps the renderer's write
        // path functional (no unhandled-channel errors).
    });
}

/**
 * Shape of a main-side `ipcMain.handle` handler for the saves namespace.
 * Mirrors the other namespaces — permissive types keep tests free of
 * Electron imports.
 */
export type SavesInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the saves-namespace
 * channels. The saves namespace never uses `on` — every request is an
 * invoke-style round-trip so the renderer can surface failures.
 */
export interface SavesHandlersIpcMain {
    handle(channel: string, handler: SavesInvokeHandler): unknown;
}

export interface RegisterSavesHandlersOptions {
    readonly ipcMain: SavesHandlersIpcMain;
}

/**
 * Placeholder `SaveSlotMeta` returned by the save stub. Real values are
 * produced by the `SaveRepository` in F06/F18. The shape must match
 * `SaveSlotMeta` from `preload/api.ts` so the preload's typed cast is
 * honest.
 */
const STUB_SAVE_SLOT: SaveSlotMeta = {
    slotId: '',
    gameId: '',
    tick: 0,
    savedAt: 0,
};

/**
 * Register every `chimera:saves:*` main-side channel. These are deliberate
 * stubs — actual persistence (filesystem, metadata indexing, autosave
 * cadence) lands in F06/F18.
 *
 * `chimera:saves:slot-update` is intentionally absent: it is a one-way
 * push from main → renderer via `webContents.send` after every save /
 * delete / autosave. There is no invoke handler for that channel.
 *
 * Host-only enforcement (§4.1: `SavesAPI` is host-only) is the
 * responsibility of the real handlers in F06/F18 — the stubs merely keep
 * the renderer's typed Promises from rejecting before persistence
 * exists.
 *
 * Invariant 5: channel constants come from `preload/saves-api.ts`; there
 * is no parallel list in this file to drift out of sync.
 */
export function registerSavesHandlers(options: RegisterSavesHandlersOptions): void {
    const { ipcMain } = options;

    ipcMain.handle(SAVES_LIST_CHANNEL, (_event, gameId) => {
        parseInvokeRequest(GameIdSchema, SAVES_LIST_CHANNEL, gameId);
        // Stub. Real listing (scan save directory + read metadata) lands
        // in F06/F18. An empty array honours the preload's
        // `Promise<SaveSlotMeta[]>` contract without claiming slots that
        // do not exist.
        return [] as SaveSlotMeta[];
    });

    ipcMain.handle(SAVES_SAVE_CHANNEL, (_event, request) => {
        parseInvokeRequest(SaveRequestSchema, SAVES_SAVE_CHANNEL, request);
        // Stub. Real persistence lands in F06/F18. Returning a placeholder
        // keeps the preload's `Promise<SaveSlotMeta>` contract honest.
        return STUB_SAVE_SLOT;
    });

    ipcMain.handle(SAVES_LOAD_CHANNEL, (_event, slotId) => {
        parseInvokeRequest(SlotIdSchema, SAVES_LOAD_CHANNEL, slotId);
        // Stub. Real load (read slot, seed simulation, broadcast snapshot)
        // lands in F06/F18. Returning `undefined` satisfies the preload's
        // `Promise<void>` contract.
        return undefined;
    });

    ipcMain.handle(SAVES_DELETE_CHANNEL, (_event, slotId) => {
        parseInvokeRequest(SlotIdSchema, SAVES_DELETE_CHANNEL, slotId);
        // Stub. Real delete (remove slot file, emit slot-update) lands in
        // F06/F18. Returning `undefined` satisfies the preload's
        // `Promise<void>` contract.
        return undefined;
    });
}

/**
 * Shape of a main-side `ipcMain.handle` handler for the settings namespace.
 * Mirrors the other namespaces — permissive types keep tests free of
 * Electron imports.
 */
export type SettingsInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the settings-
 * namespace channels. The settings namespace never uses `on` — every
 * read/mutation is an invoke-style round-trip so the renderer receives the
 * freshly-resolved settings tree.
 */
export interface SettingsHandlersIpcMain {
    handle(channel: string, handler: SettingsInvokeHandler): unknown;
}

export interface RegisterSettingsHandlersOptions {
    readonly ipcMain: SettingsHandlersIpcMain;
}

/**
 * Placeholder `ResolvedSettings` returned by the get/update/reset stubs.
 * Real values come from the `SettingsManager` in F07/F19. An empty object
 * satisfies the `ResolvedSettings = Record<string, unknown>` contract
 * without asserting any engine-wide or game-specific default values.
 */
const STUB_RESOLVED_SETTINGS: ResolvedSettings = Object.freeze({});

/**
 * Register every `chimera:settings:*` main-side channel. These are
 * deliberate stubs — actual schema validation, three-layer merging, and
 * persisted user overrides land in F07/F19.
 *
 * `chimera:settings:change` is intentionally absent: it is a one-way push
 * from main → renderer via `webContents.send` whenever settings change
 * (external update, reset, or migration). There is no invoke handler for
 * that channel.
 *
 * Invariant 5: channel constants come from `preload/settings-api.ts`;
 * there is no parallel list in this file to drift out of sync.
 */
export function registerSettingsHandlers(options: RegisterSettingsHandlersOptions): void {
    const { ipcMain } = options;

    ipcMain.handle(SETTINGS_GET_CHANNEL, (_event, gameId) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_GET_CHANNEL, gameId);
        // Stub. Real merge (engine defaults + game defaults + user
        // overrides) lands in F07/F19. An empty object honours the
        // preload's `Promise<ResolvedSettings>` contract without claiming
        // any particular default value.
        return STUB_RESOLVED_SETTINGS;
    });

    ipcMain.handle(SETTINGS_UPDATE_CHANNEL, (_event, gameId, patch) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_UPDATE_CHANNEL, gameId);
        parseInvokeRequest(UserSettingsPatchSchema, SETTINGS_UPDATE_CHANNEL, patch);
        // Stub. Real persistence lands in F07/F19. Returning a placeholder
        // keeps the preload's `Promise<ResolvedSettings>` contract honest.
        return STUB_RESOLVED_SETTINGS;
    });

    ipcMain.handle(SETTINGS_RESET_CHANNEL, (_event, gameId) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_RESET_CHANNEL, gameId);
        // Stub. Real reset (clear user overrides, re-merge) lands in
        // F07/F19.
        return STUB_RESOLVED_SETTINGS;
    });
}
