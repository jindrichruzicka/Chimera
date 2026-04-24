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
    SYSTEM_RELAUNCH_CHANNEL,
    type PlatformInfo,
} from '../preload/system-api.js';
import {
    GAME_ACTION_REJECTED_CHANNEL,
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
import type {
    ActionRejection,
    ResolvedSettings,
    SaveSlotMeta,
    UserSettings,
} from '../preload/api-types.js';
import {
    EngineActionSchema,
    GameIdSchema,
    HostLobbyParamsSchema,
    IpcRequestValidationError,
    JoinLobbyParamsSchema,
    PlayerIdSchema,
    SaveRequestSchema,
    SlotIdSchema,
    UserSettingsPatchSchema,
    parseInvokeRequest,
} from './ipc-schemas.js';
import { createNoopLogger, type Logger, type LoggerSink, type MemorySink } from './logger.js';
import type { SettingsManager } from './SettingsManager.js';
import type { LobbyManager } from './lobby-manager.js';
import { LOGS_EMIT_CHANNEL, LOGS_READ_RECENT_CHANNEL } from '../preload/logs-api.js';
import { RendererLogEntrySchema } from './ipc-schemas.js';
import type { LogEntry } from '@chimera/shared/logging.js';

export {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    GAME_ACTION_REJECTED_CHANNEL,
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
    LOGS_EMIT_CHANNEL,
    LOGS_READ_RECENT_CHANNEL,
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
    /** Schedules a relaunch on next exit. Call `exit(0)` immediately after. */
    relaunch(): void;
    /** Exits the Electron process immediately with the given code. */
    exit(code: number): void;
}

export interface RegisterSystemHandlersOptions {
    readonly ipcMain: SystemHandlersIpcMain;
    readonly app: SystemHandlersAppHost;
    readonly platform: NodeJS.Platform;
    readonly electronVersion: string;
    /**
     * Injected logger (invariant 67). Optional at F02 because the handlers
     * are stubs; real managers landing in F03+ will require it. Defaults to
     * a noop logger so today's tests and call sites need not supply one.
     */
    readonly logger?: Logger;
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
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:system:* handlers', {
        channels: [SYSTEM_PLATFORM_CHANNEL, SYSTEM_QUIT_CHANNEL, SYSTEM_RELAUNCH_CHANNEL],
    });

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

    ipcMain.on(SYSTEM_RELAUNCH_CHANNEL, () => {
        app.relaunch();
        app.exit(0);
    });
}

/**
 * Shape of a main-side `ipcMain.on` listener for the game namespace. The real
 * Electron signature is `(event: IpcMainEvent, ...args: unknown[]) => void`.
 * The narrow type below exposes exactly the `sender.send` surface needed to
 * push a REJECT back to the renderer that sent the message — any widening
 * would be an architectural change and must be justified.
 */
export interface GameHandlerEvent {
    readonly sender: { send(channel: string, ...args: unknown[]): void };
}

export type GameHandlerListener = (event: GameHandlerEvent, ...args: unknown[]) => void;

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
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
}

/**
 * Best-effort reconstruction of an {@link ActionRejection} from a payload
 * that failed {@link parseInvokeRequest}. The payload is `unknown` (that's
 * exactly why it was rejected), so `tick` and `actionType` are recovered
 * only when the respective field is present and the right primitive type.
 * Missing or wrong-typed fields fall back to `-1` / omitted — matching the
 * §4.3 REJECT frame's "unknown tick" convention.
 */
function buildIpcValidationRejection(
    err: IpcRequestValidationError,
    action: unknown,
): ActionRejection {
    const envelope =
        typeof action === 'object' && action !== null ? (action as Record<string, unknown>) : {};
    const rawTick = envelope['tick'];
    const rawType = envelope['type'];
    const tick = typeof rawTick === 'number' && Number.isInteger(rawTick) ? rawTick : -1;
    const actionType = typeof rawType === 'string' && rawType.length > 0 ? rawType : undefined;

    const base = `ipc-validation:${err.channel}`;
    const reason =
        err.issues.length > 0
            ? `${base}:${err.issues
                  .map((issue) => (issue.path.length > 0 ? issue.path.join('.') : '<root>'))
                  .join(',')}`
            : base;

    // Build the object via a conditional spread so `actionType` is absent
    // (not `undefined`) when unknown — matches `exactOptionalPropertyTypes`.
    return { reason, tick, ...(actionType !== undefined ? { actionType } : {}) };
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
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:game:* handlers', {
        channels: [GAME_SEND_ACTION_CHANNEL, GAME_SWITCH_SEAT_CHANNEL],
    });

    ipcMain.on(GAME_SEND_ACTION_CHANNEL, (event, action) => {
        // Validate the envelope before handing off to the (future)
        // ActionPipeline. Per §4.7 the action-type-specific payload
        // schema lives in the simulation layer; here we only guard the
        // outer envelope so malformed requests never reach the pipeline.
        //
        // `chimera:game:send-action` is an `ipcMain.on` send — throwing
        // out of an `on` callback is silently dropped by Electron, so
        // validation failure is reported back to the sender via the
        // `chimera:game:action-rejected` push channel (wire-shape mirror
        // of the §4.3 WebSocket REJECT frame). The same channel will
        // carry ActionPipeline Stage-3 rejections once F03–F15 wire the
        // real pipeline — the renderer's listener contract does not
        // churn.
        try {
            parseInvokeRequest(EngineActionSchema, GAME_SEND_ACTION_CHANNEL, action);
        } catch (err) {
            if (err instanceof IpcRequestValidationError) {
                const rejection: ActionRejection = buildIpcValidationRejection(err, action);
                logger.warn('ipc envelope rejected', {
                    channel: GAME_SEND_ACTION_CHANNEL,
                    reason: rejection.reason,
                    tick: rejection.tick,
                    ...(rejection.actionType !== undefined
                        ? { actionType: rejection.actionType }
                        : {}),
                });
                event.sender.send(GAME_ACTION_REJECTED_CHANNEL, rejection);
                return;
            }
            // Unknown error class — re-throw so the main-process crash
            // reporter (F43) records it. Silently swallowing would hide a
            // genuine bug behind the REJECT channel.
            throw err;
        }
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
 * Shape of a main-side `ipcMain.handle` handler for the lobby namespace.
 * Mirrors {@link GameInvokeHandler}.
 */
export type LobbyInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the lobby-namespace
 * channels. The lobby namespace uses `handle` exclusively — every request is
 * an invoke-style round-trip so the renderer can surface failures.
 */
export interface LobbyHandlersIpcMain {
    handle(channel: string, handler: LobbyInvokeHandler): unknown;
}

export interface RegisterLobbyHandlersOptions {
    readonly ipcMain: LobbyHandlersIpcMain;
    /** Real LobbyManager that handles host / join / leave (F11). */
    readonly lobbyManager: LobbyManager;
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
}

/**
 * Register every `chimera:lobby:*` main-side channel, delegating to the
 * injected `LobbyManager`.
 *
 * `chimera:lobby:update` is intentionally absent: it is a one-way push from
 * main → renderer via `webContents.send`. There is no main-side listener
 * or invoke handler for that channel.
 *
 * `chimera:lobby:list` (LobbyDiscoveryAPI) is deferred to F12 and is
 * surfaced only when the active MultiplayerProvider implements
 * `BrowsableProvider` (§4.1, §4.14).
 *
 * Invariant 5: channel constants come from `preload/lobby-api.ts`; there is
 * no parallel list in this file to drift out of sync.
 */
export function registerLobbyHandlers(options: RegisterLobbyHandlersOptions): void {
    const { ipcMain, lobbyManager } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:lobby:* handlers', {
        channels: [LOBBY_HOST_CHANNEL, LOBBY_JOIN_CHANNEL, LOBBY_LEAVE_CHANNEL],
    });

    ipcMain.handle(LOBBY_HOST_CHANNEL, (_event, params) => {
        const validated = parseInvokeRequest(HostLobbyParamsSchema, LOBBY_HOST_CHANNEL, params);
        return lobbyManager.hostLobby(validated);
    });

    ipcMain.handle(LOBBY_JOIN_CHANNEL, (_event, params) => {
        const validated = parseInvokeRequest(JoinLobbyParamsSchema, LOBBY_JOIN_CHANNEL, params);
        return lobbyManager.joinLobby(validated);
    });

    ipcMain.handle(LOBBY_LEAVE_CHANNEL, () => {
        return lobbyManager.closeLobby();
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
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
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
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:saves:* handlers', {
        channels: [
            SAVES_LIST_CHANNEL,
            SAVES_SAVE_CHANNEL,
            SAVES_LOAD_CHANNEL,
            SAVES_DELETE_CHANNEL,
        ],
    });

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
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
    /** Live SettingsManager instance (wired in F07). When absent, falls back to stub behaviour. */
    readonly settingsManager?: SettingsManager;
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
    const logger = options.logger ?? createNoopLogger();
    const mgr = options.settingsManager;
    logger.info('registering chimera:settings:* handlers', {
        channels: [SETTINGS_GET_CHANNEL, SETTINGS_UPDATE_CHANNEL, SETTINGS_RESET_CHANNEL],
    });

    ipcMain.handle(SETTINGS_GET_CHANNEL, (_event, gameId) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_GET_CHANNEL, gameId);
        if (mgr !== undefined) {
            return mgr.getSettings(gameId as string);
        }
        return STUB_RESOLVED_SETTINGS;
    });

    ipcMain.handle(SETTINGS_UPDATE_CHANNEL, (_event, gameId, patch) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_UPDATE_CHANNEL, gameId);
        parseInvokeRequest(UserSettingsPatchSchema, SETTINGS_UPDATE_CHANNEL, patch);
        if (mgr !== undefined) {
            // BLOCK-4: validate patch against per-game schema at IPC boundary
            const validatedPatch = mgr.validatePatchForGame(
                gameId as string,
                patch as UserSettings,
            );
            return mgr.updateSettings(gameId as string, validatedPatch);
        }
        return STUB_RESOLVED_SETTINGS;
    });

    ipcMain.handle(SETTINGS_RESET_CHANNEL, (_event, gameId) => {
        parseInvokeRequest(GameIdSchema, SETTINGS_RESET_CHANNEL, gameId);
        if (mgr !== undefined) {
            return mgr.resetSettings(gameId as string);
        }
        return STUB_RESOLVED_SETTINGS;
    });
}

// ── Logs handlers (§4.27, §4.32) ─────────────────────────────────────────────

/**
 * Narrow slice of `Electron.IpcMain` required to register the
 * `chimera:logs:*` channels. Using a locally-declared interface ensures
 * tests can drive the registration without a real Electron module.
 */
export interface LogsHandlersIpcMain {
    handle(channel: string, handler: (...args: unknown[]) => unknown): unknown;
    on(channel: string, handler: (...args: unknown[]) => void): unknown;
}

export interface RegisterLogsHandlersOptions {
    readonly ipcMain: LogsHandlersIpcMain;
    readonly logger: Logger;
    /**
     * In-memory ring buffer whose entries are returned by `readRecent`.
     * Pass `createMemorySink()` from `logger.ts`.
     */
    readonly memorySink: MemorySink;
    /**
     * Sink that receives the fully-trusted, server-attributed {@link LogEntry}
     * for each renderer emission. In production this is the combined sink
     * (Pino file + memory ring buffer). In tests, pass a `createMemorySink()`
     * to assert the corrected source and timestamp.
     *
     * Using a direct sink write (rather than the Logger API) ensures the
     * entry's `source.process` and `timestamp` are set server-side and are
     * never derived from the renderer-supplied payload (§9.1, Invariant #1).
     */
    readonly sink: LoggerSink;
}

/**
 * Register `chimera:logs:emit` and `chimera:logs:readRecent` handlers.
 *
 * - `chimera:logs:emit` — validates the renderer-supplied {@link LogEntry}
 *   with Zod (Invariant 1) before forwarding to the main-process logger.
 *   Malformed entries are silently dropped (no throw — `ipcMain.on`
 *   callback errors are unobservable to the renderer).
 * - `chimera:logs:readRecent` — returns the last `maxEntries` entries from
 *   the in-memory ring buffer so the user can export recent logs.
 */
export function registerLogsHandlers(options: RegisterLogsHandlersOptions): void {
    const { ipcMain, memorySink } = options;

    ipcMain.on(LOGS_EMIT_CHANNEL, (_event, arg) => {
        const result = RendererLogEntrySchema.safeParse(arg);
        if (!result.success) {
            // Silently drop — malformed renderer payload should never reach
            // the sink (Invariant #1). Logging the error here would risk
            // recursion since this handler IS the log emission path.
            return;
        }
        const parsed = result.data;
        // Override source and timestamp server-side. The renderer is never
        // trusted to self-identify its process or supply its own wall-clock
        // time — any renderer-supplied `source.process` was already stripped
        // by RendererLogEntrySchema; we add 'renderer' explicitly here
        // (§9.1 IPC Attack Surface, Invariant #1).
        const trustedEntry: LogEntry = {
            level: parsed.level,
            message: parsed.message,
            timestamp: Date.now(),
            source: { process: 'renderer' as const, module: parsed.source.module },
            ...(parsed.context !== undefined ? { context: parsed.context } : {}),
            ...(parsed.error !== undefined
                ? {
                      error: {
                          name: parsed.error.name,
                          message: parsed.error.message,
                          ...(parsed.error.stack !== undefined
                              ? { stack: parsed.error.stack }
                              : {}),
                      },
                  }
                : {}),
        };
        options.sink.write(trustedEntry);

        // For error/fatal entries, additionally forward a reconstructed Error
        // object through the logger so the main-process log receives proper
        // Error object formatting (name, message, stack) via the Logger API.
        // The sink.write above preserves renderer source attribution; this
        // call adds structured error visibility in the logger's output.
        if (parsed.level === 'error' || parsed.level === 'fatal') {
            const err =
                parsed.error !== undefined
                    ? Object.assign(new Error(parsed.error.message), {
                          name: parsed.error.name,
                          stack: parsed.error.stack,
                      })
                    : undefined;
            options.logger[parsed.level](parsed.message, err, parsed.context ?? {});
        }
    });

    /** Hard cap on entries per readRecent response (DoS guard, Invariant #1). */
    const MAX_READ_RECENT_ENTRIES = 1000;

    ipcMain.handle(LOGS_READ_RECENT_CHANNEL, (_event, maxEntries) => {
        const isValidCount =
            typeof maxEntries === 'number' &&
            Number.isInteger(maxEntries) &&
            Number.isFinite(maxEntries) &&
            maxEntries > 0;
        const requested = isValidCount ? maxEntries : 100;
        // Cap independently at MAX_READ_RECENT_ENTRIES and at buffer capacity
        // to prevent oversized IPC payloads regardless of ring buffer size.
        const count = Math.min(requested, MAX_READ_RECENT_ENTRIES, memorySink.capacity);
        const all = memorySink.entries;
        return all.slice(Math.max(0, all.length - count));
    });
}
