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
// preload/saves-api.ts), `chimera:settings:*` stubs (see
// preload/settings-api.ts), and `chimera:profile:*` (see
// preload/profile-api.ts — F14-T08). The game/lobby/saves/settings handlers
// are stubs only — actual game/simulation logic lands in F03–F15; real lobby
// logic lands in F11; real save persistence lands in F06/F18; real settings
// merging and persistence land in F07/F19.

import {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    type PlatformInfo,
} from '../../preload/apis/system-api.js';
import {
    GAME_ACTION_REJECTED_CHANNEL,
    GAME_REVEAL_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_PREDICTABLE_TYPES_CHANNEL,
    GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
} from '../../preload/apis/game-api.js';
import {
    LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
    LOBBY_GET_CURRENT_STATE_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_START_GAME_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
} from '../../preload/apis/lobby-api.js';
import {
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    SAVES_CHECK_CRASH_RECOVERY_CHANNEL,
} from '../../preload/apis/saves-api.js';
import {
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
} from '../../preload/apis/settings-api.js';
import {
    PROFILE_DIRECTORY_CHANGED_CHANNEL,
    PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
    PROFILE_GET_LOCAL_CHANNEL,
    PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
    PROFILE_SWITCH_SLOT_CHANNEL,
    PROFILE_UPDATE_LOCAL_CHANNEL,
} from '../../preload/apis/profile-api.js';
import type {
    ActionRejection,
    CrashRecoveryStatus,
    EngineAction,
    PlayerProfile,
    PlayerId,
    ResolvedSettings,
    SaveRequest,
    SaveSlotMeta,
    SlotId,
    UserSettings,
} from '../../preload/api-types.js';
import { buildAssetRef, type TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import {
    EngineActionSchema,
    EngineProfilePatchSchema,
    GameIdSchema,
    HostLobbyParamsSchema,
    IpcRequestValidationError,
    JoinLobbyParamsSchema,
    LobbyReadyStateSchema,
    SaveRequestSchema,
    SlotIdSchema,
    SwitchLocalSlotRequestSchema,
    UserSettingsPatchSchema,
    parseInvokeRequest,
} from './ipc-schemas.js';
import {
    createNoopLogger,
    type Logger,
    type LoggerSink,
    type MemorySink,
} from '../logging/logger.js';
import type { E2eHooks } from '../runtime/e2e-hooks.js';
import type { SettingsManager } from '../settings/SettingsManager.js';
import type { LobbyManager } from '../lobby/LobbyManager.js';
import { LOGS_EMIT_CHANNEL, LOGS_READ_RECENT_CHANNEL } from '../../preload/apis/logs-api.js';
import { RendererLogEntrySchema } from './ipc-schemas.js';
import type { LogEntry } from '@chimera/shared/logging.js';

export {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    GAME_ACTION_REJECTED_CHANNEL,
    GAME_REVEAL_CHANNEL,
    GAME_SEND_ACTION_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_PREDICTABLE_TYPES_CHANNEL,
    GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
    LOBBY_HOST_CHANNEL,
    LOBBY_GET_CURRENT_STATE_CHANNEL,
    LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
    LOBBY_JOIN_CHANNEL,
    LOBBY_LEAVE_CHANNEL,
    LOBBY_START_GAME_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
    SAVES_CHECK_CRASH_RECOVERY_CHANNEL,
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
    LOGS_EMIT_CHANNEL,
    LOGS_READ_RECENT_CHANNEL,
    PROFILE_DIRECTORY_CHANGED_CHANNEL,
    PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
    PROFILE_GET_LOCAL_CHANNEL,
    PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
    PROFILE_SWITCH_SLOT_CHANNEL,
    PROFILE_UPDATE_LOCAL_CHANNEL,
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
    /**
     * When true, the `chimera:system:quit` handler is a no-op — the process
     * must not be terminated during E2E tests (CHIMERA_E2E=1). The renderer
     * calls `window.__e2eHooks.onSystemQuit?.()` via the preload bridge before
     * sending the IPC so Playwright specs can observe the button interaction
     * without killing the test process.
     */
    readonly isE2e?: boolean;
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
    const isE2e = options.isE2e === true;
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
        if (isE2e) return;
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
    /** Dispatches a validated action envelope to the live host session. */
    readonly actionDispatcher?: (action: EngineAction) => void;
    /**
     * Optional `ActionRegistry`-shaped authority for the
     * `chimera:game:predictable-action-types` channel. When provided, the
     * handler returns all type strings whose `ActionDefinition.predictable`
     * is `true`. When absent, the handler returns an empty array (prediction
     * disabled at runtime — safe, graceful degradation).
     *
     * The narrow interface is used instead of importing `ActionRegistry`
     * directly so this handler module remains loosely coupled and the type
     * can be satisfied by a stub in tests without the full simulation graph.
     */
    readonly actionRegistry?: {
        registeredTypes(): readonly string[];
        resolve(type: string): { readonly predictable?: boolean };
    };
    /**
     * Returns the most-recently-sent `PlayerSnapshot` for the main window,
     * or `null` when no snapshot has been pushed yet. Used by the renderer
     * to replay a snapshot that arrived before its listener was registered.
     * When absent the handler returns `null` (safe, graceful degradation).
     *
     * Typed as `unknown` because Electron serialises IPC payloads to JSON;
     * the concrete simulation-layer `PlayerSnapshot` type carries branded
     * primitives that are not compatible with the preload `PlayerSnapshot`
     * at the type level but are identical at runtime.
     */
    readonly getCurrentSnapshot?: () => unknown;
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
 * stubs — actual ActionPipeline dispatch and snapshot
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
 *   - #4: The renderer only writes through `sendAction`.
 *   - #5: Channel constants are imported from `preload/game-api.ts`; there is
 *         no parallel list in this file to drift out of sync.
 */
export function registerGameHandlers(options: RegisterGameHandlersOptions): void {
    const { ipcMain, actionDispatcher, actionRegistry } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:game:* handlers', {
        channels: [GAME_SEND_ACTION_CHANNEL, GAME_PREDICTABLE_TYPES_CHANNEL],
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
        let validatedAction: EngineAction;
        try {
            validatedAction = parseInvokeRequest(
                EngineActionSchema,
                GAME_SEND_ACTION_CHANNEL,
                action,
            );
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

        try {
            actionDispatcher?.(validatedAction);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logger.warn('ipc action dispatch rejected', {
                channel: GAME_SEND_ACTION_CHANNEL,
                reason,
                tick: validatedAction.tick,
                actionType: validatedAction.type,
            });
            event.sender.send(GAME_ACTION_REJECTED_CHANNEL, {
                reason: `action-dispatch:${reason}`,
                tick: validatedAction.tick,
                actionType: validatedAction.type,
            } satisfies ActionRejection);
        }
    });

    ipcMain.handle(GAME_PREDICTABLE_TYPES_CHANNEL, () => {
        if (actionRegistry === undefined) {
            return [];
        }
        return actionRegistry
            .registeredTypes()
            .filter((type) => actionRegistry.resolve(type).predictable === true);
    });

    ipcMain.handle(GAME_GET_CURRENT_SNAPSHOT_CHANNEL, () => {
        return options.getCurrentSnapshot?.() ?? null;
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
    /** Supplies the local profile attestation attached to outbound JOIN requests. */
    readonly profileManager?: ProfileManagerPort;
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
        channels: [
            LOBBY_HOST_CHANNEL,
            LOBBY_GET_CURRENT_STATE_CHANNEL,
            LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
            LOBBY_JOIN_CHANNEL,
            LOBBY_LEAVE_CHANNEL,
            LOBBY_START_GAME_CHANNEL,
            LOBBY_UPDATE_READY_STATE_CHANNEL,
        ],
    });

    ipcMain.handle(LOBBY_HOST_CHANNEL, (_event, params) => {
        const validated = parseInvokeRequest(HostLobbyParamsSchema, LOBBY_HOST_CHANNEL, params);
        return lobbyManager.hostLobby(validated);
    });

    ipcMain.handle(LOBBY_JOIN_CHANNEL, (_event, params) => {
        const validated = parseInvokeRequest(JoinLobbyParamsSchema, LOBBY_JOIN_CHANNEL, params);
        if (options.profileManager === undefined) {
            return lobbyManager.joinLobby(validated);
        }
        return lobbyManager.joinLobby({
            ...validated,
            profile: options.profileManager.currentAttestation(),
        });
    });

    ipcMain.handle(LOBBY_LEAVE_CHANNEL, () => {
        return lobbyManager.closeLobby();
    });

    ipcMain.handle(LOBBY_START_GAME_CHANNEL, () => {
        return lobbyManager.startGame();
    });

    ipcMain.handle(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, () => {
        return lobbyManager.getLocalPlayerId();
    });

    ipcMain.handle(LOBBY_GET_CURRENT_STATE_CHANNEL, () => {
        return lobbyManager.getCurrentState();
    });

    ipcMain.handle(LOBBY_UPDATE_READY_STATE_CHANNEL, (_event, ready) => {
        const validated = parseInvokeRequest(
            LobbyReadyStateSchema,
            LOBBY_UPDATE_READY_STATE_CHANNEL,
            ready,
        );
        return lobbyManager.updatePlayerReadyState(validated);
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

/**
 * Narrow port the saves IPC handlers depend on. Mirrors the renderer-facing
 * `SavesAPI` minus `onSlotUpdate` (which is the renderer's subscription
 * surface, not a main-side method). The port is responsible for converting
 * any internal `SaveSlotMeta` shape (e.g. the simulation/persistence one
 * with `turnNumber`/`playerNames`) into the preload `SaveSlotMeta` shape
 * before returning — the IPC handler does not perform that mapping.
 *
 * Wired in `electron/main/index.ts` from the live `SaveManager`. Tests
 * inject a fake to keep the IPC handler unit tests free of repository,
 * filesystem, and Electron internals.
 */
export interface SavesIpcPort {
    list(gameId: string): Promise<SaveSlotMeta[]>;
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    load(slotId: SlotId): Promise<void>;
    delete(slotId: SlotId): Promise<void>;
    /**
     * Check whether the previous session ended unclean and an autosave is
     * available to recover from. Pure read; never mutates persistence.
     */
    checkCrashRecovery(): Promise<CrashRecoveryStatus>;
}

export interface RegisterSavesHandlersOptions {
    readonly ipcMain: SavesHandlersIpcMain;
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
    /** CHIMERA_E2E-only hook sink for save metadata. Omitted in production. */
    readonly e2eHooks?: Pick<E2eHooks, 'lastSavedSlotId' | 'lastSavedTick'>;
    /**
     * Live saves coordinator. Required — every saves IPC request is
     * delegated to this port. Production wires the real
     * {@link SavesIpcPort} backed by `SaveManager`; tests inject a fake.
     */
    readonly saves: SavesIpcPort;
    /**
     * Push `chimera:saves:slot-update` to all renderer windows after a
     * successful `save` or `delete`. The handler computes the refreshed
     * slot list (via `saves.list`) before invoking this callback. When
     * absent, no broadcast — and no extra list call — is performed.
     */
    readonly broadcastSlotsChanged?: (gameId: string, slots: SaveSlotMeta[]) => void;
}

/**
 * Register every `chimera:saves:*` main-side channel.
 *
 * Requests are delegated to `options.saves` and — after every successful
 * `save` / `delete` — `broadcastSlotsChanged` is invoked with the refreshed
 * slot list so the renderer's `chimera:saves:slot-update` push channel can
 * be fired by the wiring code.
 *
 * `chimera:saves:slot-update` is intentionally absent from this
 * registration: it is a one-way push from main → renderer via
 * `webContents.send`. There is no invoke handler for that channel.
 *
 * Host-only enforcement (§4.1: `SavesAPI` is host-only) is the
 * responsibility of the live coordinator (`SaveManager` + wiring) — the
 * IPC layer validates payload shape only.
 *
 * Invariant 5: channel constants come from `preload/saves-api.ts`; there
 * is no parallel list in this file to drift out of sync.
 *
 * Invariant 23: the IPC handler never bypasses the repository abstraction;
 * persistence flows exclusively through `options.saves` (which delegates
 * to `SaveRepository`).
 *
 * Invariant 25: every IPC input is validated with a Zod schema before any
 * port call — invalid payloads throw before the repository is touched.
 *
 * Invariant 37: this module imports zero concrete repository classes; the
 * `SavesIpcPort` is built and injected by the wiring layer.
 */
export function registerSavesHandlers(options: RegisterSavesHandlersOptions): void {
    const { ipcMain, saves, broadcastSlotsChanged, e2eHooks } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:saves:* handlers', {
        channels: [
            SAVES_LIST_CHANNEL,
            SAVES_SAVE_CHANNEL,
            SAVES_LOAD_CHANNEL,
            SAVES_DELETE_CHANNEL,
            SAVES_CHECK_CRASH_RECOVERY_CHANNEL,
        ],
    });

    ipcMain.handle(SAVES_LIST_CHANNEL, (_event, gameId) => {
        const validated = parseInvokeRequest(GameIdSchema, SAVES_LIST_CHANNEL, gameId);
        return saves.list(validated);
    });

    ipcMain.handle(SAVES_SAVE_CHANNEL, async (_event, request) => {
        const validated = parseInvokeRequest(SaveRequestSchema, SAVES_SAVE_CHANNEL, request);
        const meta = await saves.save(validated);
        if (e2eHooks !== undefined) {
            e2eHooks.lastSavedSlotId = meta.slotId;
            e2eHooks.lastSavedTick = meta.tick;
        }
        if (broadcastSlotsChanged !== undefined) {
            try {
                const refreshed = await saves.list(validated.gameId);
                broadcastSlotsChanged(validated.gameId, refreshed);
            } catch (err) {
                logger.warn('saves:save — post-save list/broadcast failed; save was persisted', {
                    gameId: validated.gameId,
                    error: err,
                });
            }
        }
        return meta;
    });

    ipcMain.handle(SAVES_LOAD_CHANNEL, async (_event, slotId) => {
        const validated = parseInvokeRequest(SlotIdSchema, SAVES_LOAD_CHANNEL, slotId);
        await saves.load(validated);
        // Returning `undefined` satisfies the preload's `Promise<void>`.
        return undefined;
    });

    ipcMain.handle(SAVES_DELETE_CHANNEL, async (_event, slotId) => {
        const validated = parseInvokeRequest(SlotIdSchema, SAVES_DELETE_CHANNEL, slotId);
        await saves.delete(validated);
        if (broadcastSlotsChanged !== undefined) {
            try {
                const gameId = parseGameIdFromSlotId(validated);
                const refreshed = await saves.list(gameId);
                broadcastSlotsChanged(gameId, refreshed);
            } catch (err) {
                logger.warn('saves:delete — post-delete list/broadcast failed; slot was deleted', {
                    slotId: validated,
                    error: err,
                });
            }
        }
        return undefined;
    });

    ipcMain.handle(SAVES_CHECK_CRASH_RECOVERY_CHANNEL, () => saves.checkCrashRecovery());
}

/**
 * Extract the `gameId` from a qualified slot identifier of the documented
 * form `'<gameId>/<slotName>'`.  `SlotIdSchema` enforces the format at the
 * IPC boundary, so a missing `'/'` is an invariant violation — we throw
 * rather than degrade silently.
 */
function parseGameIdFromSlotId(slotId: string): string {
    const idx = slotId.indexOf('/');
    if (idx <= 0) {
        throw new Error(
            `Invariant violation: slotId without '/' reached parseGameIdFromSlotId: ${slotId}`,
        );
    }
    return slotId.slice(0, idx);
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
    /**
     * Logger instance for structured main-process logging.
     * **Required** (unlike sibling options) because the logs IPC handlers
     * must forward renderer emissions through a real logger to ensure
     * proper server-side attribution and timestamp integrity (§9.1, Invariant #1).
     * Cannot be optional without breaking the invariant guarantee.
     */
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

// ── Profile handlers (§4.24 — F14-T08) ───────────────────────────────────────

/**
 * Shape of a main-side `ipcMain.handle` handler for the profile namespace.
 * Mirrors the other namespaces — permissive types keep tests free of
 * Electron imports.
 */
export type ProfileInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the profile-
 * namespace channels. The profile namespace uses `handle` exclusively —
 * every query/mutation is an invoke-style round-trip so the renderer can
 * surface failures.
 *
 * `chimera:profile:directory-changed` is a one-way push from main →
 * renderer via `webContents.send` and is intentionally absent from this
 * interface.
 */
export interface ProfileHandlersIpcMain {
    handle(channel: string, handler: ProfileInvokeHandler): unknown;
}

/**
 * Narrow `ProfileManager` surface the profile IPC handlers need.
 * Declared here so the real `ProfileManager` class satisfies it structurally
 * and tests can supply lightweight stubs.
 */
export interface ProfileManagerPort {
    /** Returns the committed profile or the current pending candidate. */
    currentAttestation(): PlayerProfile;
    /** Builds a candidate update (no disk write). Returns the candidate. */
    updateLocal(patch: Partial<Omit<PlayerProfile, 'localProfileId'>>): PlayerProfile;
    /** Lists all local profile slots on this machine (pass-and-play §4.24). */
    listLocalSlots(): Promise<
        readonly { readonly localProfileId: string; readonly displayName: string }[]
    >;
    /** Switches the active local profile to the given slot (pass-and-play §4.24). */
    switchLocalSlot(localProfileId: string): Promise<PlayerProfile>;
}

/**
 * Narrow `PlayerDirectory` surface the profile IPC handlers need.
 * Declared here for symmetry with `ProfileManagerPort`.
 */
export interface PlayerDirectoryPort {
    /** Returns a frozen snapshot of the current directory. */
    snapshot(): Readonly<Record<PlayerId, PlayerProfile>>;
}

export interface RegisterProfileHandlersOptions {
    readonly ipcMain: ProfileHandlersIpcMain;
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
    /**
     * Live ProfileManager instance (wired in F14).
     * When absent, `chimera:profile:get-local` returns a sentinel stub and
     * `chimera:profile:update-local` is a no-op.
     */
    readonly profileManager?: ProfileManagerPort;
    /**
     * Live PlayerDirectory instance (wired in F14, host-only).
     * When absent, `chimera:profile:get-lobby-directory` returns an empty
     * record.
     */
    readonly playerDirectory?: PlayerDirectoryPort;
}

/**
 * Sentinel stub profile returned by `chimera:profile:get-local` when no
 * `ProfileManager` has been wired yet (F14). The shape satisfies
 * `PlayerProfile` so the preload's `Promise<PlayerProfile>` contract is
 * honest, but no real profile data is present.
 */
const STUB_PLAYER_PROFILE: PlayerProfile = Object.freeze({
    localProfileId: '',
    displayName: '',
    avatar: { kind: 'builtin' as const, ref: buildAssetRef<TextureAsset>('avatar', 'default') },
    locale: '',
});

/**
 * Register every `chimera:profile:*` main-side channel.
 *
 * `chimera:profile:directory-changed` is intentionally absent: it is a
 * one-way push from main → renderer via `webContents.send` whenever the
 * lobby directory changes. There is no invoke handler for that channel.
 *
 * Invariant #5: channel constants come from `preload/profile-api.ts`; there
 * is no parallel list in this file to drift out of sync.
 *
 * Invariant #59: profile data never enters `GameSnapshot`, `PlayerSnapshot`,
 * or `SaveFile` — these handlers touch only `ProfileManager` and
 * `PlayerDirectory`, neither of which writes to the simulation layer.
 */
export function registerProfileHandlers(options: RegisterProfileHandlersOptions): void {
    const { ipcMain } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:profile:* handlers', {
        channels: [
            PROFILE_GET_LOCAL_CHANNEL,
            PROFILE_UPDATE_LOCAL_CHANNEL,
            PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
            PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
            PROFILE_SWITCH_SLOT_CHANNEL,
        ],
    });

    ipcMain.handle(PROFILE_GET_LOCAL_CHANNEL, () => {
        if (options.profileManager !== undefined) {
            return options.profileManager.currentAttestation();
        }
        return STUB_PLAYER_PROFILE;
    });

    ipcMain.handle(PROFILE_UPDATE_LOCAL_CHANNEL, (_event, patch) => {
        parseInvokeRequest(EngineProfilePatchSchema, PROFILE_UPDATE_LOCAL_CHANNEL, patch);
        if (options.profileManager !== undefined) {
            options.profileManager.updateLocal(
                // Safe: EngineProfilePatchSchema validated the runtime shape above.
                patch as Partial<Omit<PlayerProfile, 'localProfileId'>>,
            );
        }
        return undefined;
    });

    ipcMain.handle(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, () => {
        if (options.playerDirectory !== undefined) {
            return options.playerDirectory.snapshot();
        }
        // No directory wired yet — return an empty record for the renderer's
        // getLobbyDirectory() contract.
        return {};
    });

    ipcMain.handle(PROFILE_LIST_LOCAL_SLOTS_CHANNEL, () => {
        if (options.profileManager !== undefined) {
            return options.profileManager.listLocalSlots();
        }
        // No manager wired yet — return an empty array so the renderer's
        // Promise<readonly LocalProfileSlot[]> contract is honest.
        return [];
    });

    ipcMain.handle(PROFILE_SWITCH_SLOT_CHANNEL, (_event, payload) => {
        const { localProfileId } = parseInvokeRequest(
            SwitchLocalSlotRequestSchema,
            PROFILE_SWITCH_SLOT_CHANNEL,
            payload,
        );
        if (options.profileManager !== undefined) {
            return options.profileManager.switchLocalSlot(localProfileId);
        }
        // No manager wired yet — no-op; renderer's Promise<void> contract is honest.
        return undefined;
    });
}
