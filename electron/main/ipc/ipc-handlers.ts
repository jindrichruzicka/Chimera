// electron/main/ipc-handlers.ts
//
// Registers the main-process IPC handlers exposed through the preload
// namespaces. One `register<Namespace>Handlers` function per namespace keeps
// registration auditable and matches the one-module-per-namespace convention
// on the preload side (§4.1). Channel constants for each namespace come from
// its preload/apis/<namespace>-api.ts module.

import {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANNEL,
    type PlatformInfo,
} from '../../preload/apis/system-api.js';
import { CURRENT_MATCH_REPLAY_PATH } from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';
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
    LOBBY_RETURN_TO_LOBBY_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_SET_MATCH_SETTING_CHANNEL,
    LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
    LOBBY_ADD_AI_CHANNEL,
    LOBBY_REMOVE_AI_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
} from '../../preload/apis/lobby-api.js';
import { CONTENT_GET_COLLECTIONS_CHANNEL } from '../../preload/apis/content-api.js';
import {
    SAVES_CANCEL_RESTORE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_RESTORE_STATUS_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
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
import {
    REPLAY_DELETE_CHANNEL,
    REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
    REPLAY_LIST_CHANNEL,
    REPLAY_NAVIGATE_CHANNEL,
    REPLAY_OPEN_IN_PLAYER_CHANNEL,
    REPLAY_OPEN_PLAYBACK_CHANNEL,
    REPLAY_SNAPSHOT_AT_CHANNEL,
    REPLAY_SNAPSHOT_RANGE_CHANNEL,
    REPLAY_CLOSE_PLAYBACK_CHANNEL,
} from '../../preload/apis/replay-api.js';
import {
    PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL,
    PERSPECTIVE_REPLAY_DELETE_CHANNEL,
    PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
    PERSPECTIVE_REPLAY_LIST_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
} from '../../preload/apis/perspective-replay-api.js';
import {
    CHAT_SEND_CHANNEL,
    CHAT_HISTORY_CHANNEL,
    CHAT_MUTE_CHANNEL,
    CHAT_UNMUTE_CHANNEL,
} from '../../preload/apis/chat-api.js';
import { SPECTATE_SET_TARGET_CHANNEL } from '../../preload/apis/spectator-api.js';
import type {
    ActionRejection,
    ChatMessage,
    ChatScope,
    DeviceInfo,
    EngineAction,
    PerspectiveReplayListItem,
    PerspectiveReplayPlaybackInfo,
    PlayerProfile,
    PlayerId,
    PlayerSnapshot,
    RelayResult,
    ReplayListItem,
    ReplayPlaybackInfo,
    ResolvedSettings,
    RestoreStatusEvent,
    SaveRequest,
    SaveSlotMeta,
    SlotId,
    UserSettings,
} from '../../preload/api-types.js';
import { isInsidePath } from '../path-containment.js';
import { buildAssetRef, type TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import {
    ChatHistoryRequestSchema,
    ChatMuteRequestSchema,
    ChatSendRequestSchema,
    EngineActionSchema,
    EngineProfilePatchSchema,
    EmptyPayloadSchema,
    GameIdSchema,
    GetContentCollectionsParamsSchema,
    HostLobbyParamsSchema,
    IpcRequestValidationError,
    JoinLobbyParamsSchema,
    LobbyReadyStateSchema,
    SetMatchSettingPayloadSchema,
    SetPlayerAttributePayloadSchema,
    SpectateSetTargetPayloadSchema,
    RemoveAiPayloadSchema,
    ReplayExportRequestSchema,
    PerspectiveReplayExportRequestSchema,
    ReplayPathSchema,
    ReplaySaveableFlagSchema,
    ReplaySnapshotRangeSchema,
    ReplayTickSchema,
    RestoreStatusEventSchema,
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
import type { SessionRestoreStatus } from '../runtime/SessionRestoreCoordinator.js';
import type { SettingsManager } from '../settings/SettingsManager.js';
import type { LobbyManager } from '../lobby/LobbyManager.js';
import { LOGS_EMIT_CHANNEL, LOGS_READ_RECENT_CHANNEL } from '../../preload/apis/logs-api.js';
import { RendererLogEntrySchema } from './ipc-schemas.js';
import type { LogEntry } from '@chimera-engine/simulation/foundation/logging.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';

export {
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANNEL,
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
    LOBBY_RETURN_TO_LOBBY_CHANNEL,
    LOBBY_UPDATE_READY_STATE_CHANNEL,
    LOBBY_SET_MATCH_SETTING_CHANNEL,
    LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
    LOBBY_ADD_AI_CHANNEL,
    LOBBY_REMOVE_AI_CHANNEL,
    LOBBY_UPDATE_CHANNEL,
    SAVES_CANCEL_RESTORE_CHANNEL,
    SAVES_DELETE_CHANNEL,
    SAVES_LIST_CHANNEL,
    SAVES_LOAD_CHANNEL,
    SAVES_RESTORE_STATUS_CHANNEL,
    SAVES_SAVE_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
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
    REPLAY_DELETE_CHANNEL,
    REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
    REPLAY_LIST_CHANNEL,
    REPLAY_NAVIGATE_CHANNEL,
    REPLAY_OPEN_IN_PLAYER_CHANNEL,
    REPLAY_OPEN_PLAYBACK_CHANNEL,
    REPLAY_SNAPSHOT_AT_CHANNEL,
    REPLAY_SNAPSHOT_RANGE_CHANNEL,
    REPLAY_CLOSE_PLAYBACK_CHANNEL,
    CHAT_SEND_CHANNEL,
    CHAT_HISTORY_CHANNEL,
    CHAT_MUTE_CHANNEL,
    CHAT_UNMUTE_CHANNEL,
    SPECTATE_SET_TARGET_CHANNEL,
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
     * Injected logger (invariant 67). Optional; defaults to a noop logger so
     * tests and call sites need not supply one.
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
    /**
     * Injected device-info probe (§4.17). When provided, the
     * `chimera:system:device-info` handler delegates to this function.
     * When omitted, the handler returns a minimal fallback snapshot built
     * from the platform and electronVersion fields available here.
     */
    readonly getDeviceInfo?: () => DeviceInfo | undefined;
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
        channels: [
            SYSTEM_PLATFORM_CHANNEL,
            SYSTEM_QUIT_CHANNEL,
            SYSTEM_RELAUNCH_CHANNEL,
            SYSTEM_DEVICE_INFO_CHANNEL,
        ],
    });

    ipcMain.handle(SYSTEM_PLATFORM_CHANNEL, () => {
        const info: PlatformInfo = {
            os: mapPlatform(platform),
            version: electronVersion,
        };
        return info;
    });

    const fallbackDeviceInfo: DeviceInfo = {
        os: mapPlatform(platform),
        osVersion: '',
        arch: 'x64',
        electronVer: electronVersion,
        chromiumVer: '',
        locale: 'en-US',
        formFactor: 'unknown',
        screens: [
            { id: 0, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
        ],
        windowSizeClass: 'large',
        inputs: ['mouse', 'keyboard'],
        primaryInput: 'mouse',
        battery: null,
    };

    ipcMain.handle(SYSTEM_DEVICE_INFO_CHANNEL, () => {
        return options.getDeviceInfo?.() ?? fallbackDeviceInfo;
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
 * Register every `chimera:game:*` main-side channel. The actual ActionPipeline
 * dispatch and snapshot broadcasting are wired at the composition root; these
 * handlers only validate the boundary and delegate to the injected ports.
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
        // Validate the envelope before handing off to the ActionPipeline. Per
        // §4.7 the action-type-specific payload schema lives in the simulation
        // layer; here we only guard the outer envelope so malformed requests
        // never reach the pipeline.
        //
        // `chimera:game:send-action` is an `ipcMain.on` send — throwing
        // out of an `on` callback is silently dropped by Electron, so
        // validation failure is reported back to the sender via the
        // `chimera:game:action-rejected` push channel (wire-shape mirror
        // of the §4.3 WebSocket REJECT frame). The same channel also carries
        // ActionPipeline Stage-3 rejections, so the renderer's listener contract
        // is uniform.
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
            // reporter records it. Silently swallowing would hide a
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
    /** Real LobbyManager that handles host / join / leave. */
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
 * `chimera:lobby:list` (LobbyDiscoveryAPI) is surfaced only when the active
 * MultiplayerProvider implements `BrowsableProvider` (§4.1, §4.14).
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
            LOBBY_RETURN_TO_LOBBY_CHANNEL,
            LOBBY_UPDATE_READY_STATE_CHANNEL,
            LOBBY_SET_MATCH_SETTING_CHANNEL,
            LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
            LOBBY_ADD_AI_CHANNEL,
            LOBBY_REMOVE_AI_CHANNEL,
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

    ipcMain.handle(LOBBY_LEAVE_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_LEAVE_CHANNEL, payload);
        return lobbyManager.closeLobby();
    });

    ipcMain.handle(LOBBY_START_GAME_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_START_GAME_CHANNEL, payload);
        return lobbyManager.startGame();
    });

    // Host-only: abandon the active match back to the lobby phase (reverse of
    // start-game). No payload — host identity is derived main-side; the
    // empty boundary is still validated per §8.3 to reject any stray payload.
    ipcMain.handle(LOBBY_RETURN_TO_LOBBY_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_RETURN_TO_LOBBY_CHANNEL, payload);
        return lobbyManager.returnToLobby();
    });

    ipcMain.handle(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL, payload);
        return lobbyManager.getLocalPlayerId();
    });

    ipcMain.handle(LOBBY_GET_CURRENT_STATE_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_GET_CURRENT_STATE_CHANNEL, payload);
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

    ipcMain.handle(LOBBY_SET_MATCH_SETTING_CHANNEL, (_event, payload) => {
        const validated = parseInvokeRequest(
            SetMatchSettingPayloadSchema,
            LOBBY_SET_MATCH_SETTING_CHANNEL,
            payload,
        );
        return lobbyManager.setMatchSetting(validated.key, validated.value);
    });

    ipcMain.handle(LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL, (_event, payload) => {
        const validated = parseInvokeRequest(
            SetPlayerAttributePayloadSchema,
            LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL,
            payload,
        );
        return lobbyManager.setPlayerAttribute(validated.playerId, validated.key, validated.value);
    });

    // Host-only: append an AI agent slot. No payload — the host assigns the slot
    // index; `LobbyManager` rejects non-host sessions and a full lobby.
    ipcMain.handle(LOBBY_ADD_AI_CHANNEL, (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, LOBBY_ADD_AI_CHANNEL, payload);
        return lobbyManager.addAi();
    });

    ipcMain.handle(LOBBY_REMOVE_AI_CHANNEL, (_event, payload) => {
        const validated = parseInvokeRequest(
            RemoveAiPayloadSchema,
            LOBBY_REMOVE_AI_CHANNEL,
            payload,
        );
        return lobbyManager.removeAi(validated.slotIndex);
    });
}

// ─── content namespace (§4.8) ──────────────────────────────────────────────────

/**
 * Narrow port supplying a game's content collections to the handler. Backed in
 * `index.ts` by the loaded `ContentDatabase` map, flattened to plain data via
 * `toGameContent`. Returns `null` for a game with no content. The port is
 * game-agnostic — it never interprets the collections.
 */
export interface ContentProviderPort {
    getCollections(gameId: string): GameContent | null;
}

export interface RegisterContentHandlersOptions {
    readonly ipcMain: LobbyHandlersIpcMain;
    readonly contentProvider: ContentProviderPort;
    /** Injected logger (invariant 67). */
    readonly logger?: Logger;
}

/**
 * Register the generic `chimera:content:get-collections` channel. The request
 * carries only a `gameId`; the response is the game's plain content collections
 * (or `null`). Validated at the boundary with a structural schema that knows
 * nothing about any game's data shapes (Invariant #2).
 */
export function registerContentHandlers(options: RegisterContentHandlersOptions): void {
    const { ipcMain, contentProvider } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:content:* handlers', {
        channels: [CONTENT_GET_COLLECTIONS_CHANNEL],
    });

    ipcMain.handle(CONTENT_GET_COLLECTIONS_CHANNEL, (_event, payload) => {
        const { gameId } = parseInvokeRequest(
            GetContentCollectionsParamsSchema,
            CONTENT_GET_COLLECTIONS_CHANNEL,
            payload,
        );
        return contentProvider.getCollections(gameId);
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
    /**
     * Abort a pending menu-load session restore. Required — the
     * channel is always registered. Production binds
     * `SessionRestoreCoordinator.cancel()` (a no-op outside an in-flight
     * restore); tests inject a stub.
     */
    readonly cancelRestore: () => Promise<void>;
}

/**
 * Project a coordinator {@link SessionRestoreStatus} onto the slim
 * {@link RestoreStatusEvent} pushed over `chimera:saves:restore-status`.
 * `idle` and `hosting` are internal transitions the renderer
 * never sees — they map to `null` (no push). Every non-null event is parsed
 * through {@link RestoreStatusEventSchema} so only a validated projection can
 * cross IPC (Invariant #1); `gameId` is injected by the composition root
 * (the load path already rejects saves for a foreign game before the
 * coordinator runs). `pendingSeats` carries raw seat PlayerIds only
 * (Invariant #59).
 */
export function toRestoreStatusEvent(
    status: SessionRestoreStatus,
    gameId: string,
): RestoreStatusEvent | null {
    switch (status.state) {
        case 'idle':
        case 'hosting':
            return null;
        case 'waiting-for-players':
            return RestoreStatusEventSchema.parse({
                state: 'waiting',
                gameId,
                matchId: status.matchId,
                lobbyCode: status.lobbyCode,
                pendingSeats: status.missingSeats,
            });
        case 'complete':
            return RestoreStatusEventSchema.parse({
                state: 'ready',
                gameId,
                matchId: status.matchId,
                pendingSeats: [],
            });
        case 'aborted':
            return RestoreStatusEventSchema.parse({
                state: 'cancelled',
                gameId,
                matchId: status.matchId,
                pendingSeats: [],
            });
        case 'failed':
            return RestoreStatusEventSchema.parse({
                state: 'failed',
                gameId,
                matchId: status.matchId,
                pendingSeats: [],
            });
    }
}

/**
 * Register every `chimera:saves:*` main-side channel.
 *
 * Requests are delegated to `options.saves` and — after every successful
 * `save` / `delete` — `broadcastSlotsChanged` is invoked with the refreshed
 * slot list so the renderer's `chimera:saves:slot-update` push channel can
 * be fired by the wiring code.
 *
 * `chimera:saves:slot-update` and `chimera:saves:restore-status` are
 * intentionally absent from this registration: they are one-way pushes from
 * main → renderer via `webContents.send`. There is no invoke handler for
 * those channels.
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
    const { ipcMain, saves, broadcastSlotsChanged, cancelRestore, e2eHooks } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:saves:* handlers', {
        channels: [
            SAVES_LIST_CHANNEL,
            SAVES_SAVE_CHANNEL,
            SAVES_LOAD_CHANNEL,
            SAVES_DELETE_CHANNEL,
            SAVES_CANCEL_RESTORE_CHANNEL,
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

    ipcMain.handle(SAVES_CANCEL_RESTORE_CHANNEL, async (_event, payload) => {
        parseInvokeRequest(EmptyPayloadSchema, SAVES_CANCEL_RESTORE_CHANNEL, payload);
        await cancelRestore();
        return undefined;
    });
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

// ─── Replay namespace (§4.28) ─────────────────────────────────────────────────

/**
 * Shape of a main-side `ipcMain.handle` handler for the replay namespace.
 * Mirrors the other namespaces — permissive types keep tests free of
 * Electron imports.
 */
export type ReplayInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Narrow slice of `Electron.IpcMain` required to register the replay-namespace
 * channels. The replay namespace never uses `on`: `chimera:replay:navigate` is
 * a one-way push from main → renderer via `webContents.send`, not an invoke
 * handler.
 */
export interface ReplayHandlersIpcMain {
    handle(channel: string, handler: ReplayInvokeHandler): unknown;
}

/**
 * Narrow port the replay IPC handlers depend on. A subset of
 * {@link import('../replay/replay-manager.js').ReplayManager} — only the
 * read/delete projection methods the renderer surface needs. The manager owns
 * recording state; `exportCurrentMatch` is injected separately because it must
 * be gated on an active hosted session, which only the wiring layer knows.
 *
 * Invariant #3 / #71: `listItems` returns projected {@link ReplayListItem}s
 * (no `GameSnapshot`, no action log); the full file is loaded only by the
 * player route, never returned over these channels.
 */
export interface ReplayIpcPort {
    listItems(gameId: string): Promise<ReplayListItem[]>;
    delete(path: string): Promise<void>;
}

/**
 * Narrow port driving replay *playback* (§4.28). Wired to
 * `ReplayPlaybackManager` in `index.ts`.
 *
 * Invariant #3: `snapshotAt` returns a projected {@link PlayerSnapshot}; the
 * authoritative `BaseGameSnapshot` it is projected from never leaves main.
 */
export interface ReplayPlaybackPort {
    open(path: string): Promise<ReplayPlaybackInfo>;
    /**
     * Open playback for the in-memory recording of the just-finished match (the
     * post-game preview, before any save). Backs the {@link CURRENT_MATCH_REPLAY_PATH}
     * sentinel — no filesystem read, so no path is validated.
     */
    openCurrent(): Promise<ReplayPlaybackInfo>;
    snapshotAt(tick: number): PlayerSnapshot;
    snapshotRange(from: number, to: number): PlayerSnapshot[];
    close(): void;
}

export interface RegisterReplayHandlersOptions {
    readonly ipcMain: ReplayHandlersIpcMain;
    /** Injected logger (invariant 67). See `RegisterSystemHandlersOptions`. */
    readonly logger?: Logger;
    /** Live replay read/delete port — production wires the `ReplayManager`. */
    readonly replay: ReplayIpcPort;
    /** Live replay playback port — production wires the `ReplayPlaybackManager`. */
    readonly playback: ReplayPlaybackPort;
    /**
     * Absolute path of the replay directory. `chimera:replay:open-in-player`
     * resolves the requested path and asserts it stays inside this root before
     * navigating (defence-in-depth for OWASP A01 — `delete` is additionally
     * guarded by the repository).
     */
    readonly replayDir: string;
    /**
     * Finalise the in-progress recording to disk and resolve with the saved
     * file path. Injected by the wiring layer because it must reject when no
     * match is being hosted — a condition only the live session graph knows.
     * `name` is the validated user-entered replay name (or `undefined`).
     */
    readonly exportCurrentMatch: (name?: string) => Promise<string>;
    /**
     * Push the validated replay path to the renderer (via
     * `chimera:replay:navigate`) so it can switch to the replay player route.
     * `saveable` rides along on the push so the player shows its save icon for a
     * just-finished match.
     */
    readonly navigateToPlayer: (path: string, saveable: boolean) => void;
    /**
     * Notify the renderer that a replay was exported successfully (via
     * `chimera:replay:exported`, the saved path as payload) so a renderer
     * listener can raise the "Replay saved" toast (§4.30). Fired only after
     * `exportCurrentMatch` resolves with a non-`'view'` intent — never on
     * rejection, and never for the **Replay** (view) action, which exports only
     * to obtain a stable path for `openInPlayer`.
     */
    readonly notifyExported: (path: string) => void;
}

/**
 * Register every `chimera:replay:*` main-side channel (§4.28).
 *
 * `chimera:replay:navigate` and `chimera:replay:exported` are intentionally
 * absent from the handle list: both are one-way pushes from main → renderer via
 * `webContents.send`, fired by `navigateToPlayer` and `notifyExported`.
 *
 * Invariant 5: channel constants come from `preload/apis/replay-api.ts`; there
 * is no parallel list in this file to drift out of sync.
 *
 * Invariant 3 / 71: no `GameSnapshot` and no recorded action log crosses these
 * channels — `list` returns projected `ReplayListItem`s and
 * `export-current-match` returns a saved-file path string.
 *
 * Invariant 25: every IPC input is validated with a Zod schema before any port
 * call — invalid payloads throw before the manager is touched.
 *
 * Invariant 67: the logger is injected; this function never constructs one.
 */
export function registerReplayHandlers(options: RegisterReplayHandlersOptions): void {
    const {
        ipcMain,
        replay,
        playback,
        replayDir,
        exportCurrentMatch,
        navigateToPlayer,
        notifyExported,
    } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:replay:* handlers', {
        channels: [
            REPLAY_LIST_CHANNEL,
            REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
            REPLAY_OPEN_IN_PLAYER_CHANNEL,
            REPLAY_DELETE_CHANNEL,
            REPLAY_OPEN_PLAYBACK_CHANNEL,
            REPLAY_SNAPSHOT_AT_CHANNEL,
            REPLAY_SNAPSHOT_RANGE_CHANNEL,
            REPLAY_CLOSE_PLAYBACK_CHANNEL,
        ],
    });

    ipcMain.handle(REPLAY_LIST_CHANNEL, (_event, gameId) => {
        const validated = parseInvokeRequest(GameIdSchema, REPLAY_LIST_CHANNEL, gameId);
        return replay.listItems(validated);
    });

    ipcMain.handle(REPLAY_EXPORT_CURRENT_MATCH_CHANNEL, async (_event, request) => {
        // Fail-safe: a malformed/absent payload coerces to `{ intent: 'save' }`
        // (toast shown, unnamed), never throwing — see `ReplayExportRequestSchema`.
        const { intent, name } = parseInvokeRequest(
            ReplayExportRequestSchema,
            REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
            request,
        );
        const path = await exportCurrentMatch(name);
        // Push the saved path so a renderer listener can raise the "Replay saved"
        // toast (§4.30) — but only for the save intent, and only on success (a
        // rejected export throws before here). The "Replay" (view) action exports
        // solely to obtain a stable on-disk path for `openInPlayer`; raising a
        // "saved" toast then would be misleading (Invariant #74).
        if (intent !== 'view') {
            notifyExported(path);
        }
        return path;
    });

    ipcMain.handle(REPLAY_OPEN_IN_PLAYER_CHANNEL, (_event, replayPath, saveable) => {
        const validatedSaveable = parseInvokeRequest(
            ReplaySaveableFlagSchema,
            REPLAY_OPEN_IN_PLAYER_CHANNEL,
            saveable,
        );
        // Current-match preview: the sentinel is not a filesystem path (it opens
        // the in-memory recording), so it is matched by exact equality BEFORE any
        // path-schema parse or containment check and forwarded verbatim. It can
        // never reach `isInsidePath` nor the repository, so it cannot escape the
        // replay directory (OWASP A01 unaffected). See CURRENT_MATCH_REPLAY_PATH.
        if (replayPath === CURRENT_MATCH_REPLAY_PATH) {
            navigateToPlayer(CURRENT_MATCH_REPLAY_PATH, validatedSaveable);
            return undefined;
        }
        const validated = parseInvokeRequest(
            ReplayPathSchema,
            REPLAY_OPEN_IN_PLAYER_CHANNEL,
            replayPath,
        );
        if (!isInsidePath(replayDir, validated)) {
            throw new Error(
                `replay:open-in-player: path ${JSON.stringify(validated)} escapes the replay directory`,
            );
        }
        navigateToPlayer(validated, validatedSaveable);
        return undefined;
    });

    ipcMain.handle(REPLAY_DELETE_CHANNEL, (_event, replayPath) => {
        const validated = parseInvokeRequest(ReplayPathSchema, REPLAY_DELETE_CHANNEL, replayPath);
        // Containment is also enforced downstream by the repository's
        // `assertInsideBase` (both share the `isInsidePath` predicate), but the
        // IPC layer rejects traversal symmetrically with `open-in-player` so the
        // boundary contract does not depend on the injected port's
        // implementation (defence-in-depth, OWASP A01). Throws synchronously
        // before any port call; the delete round-trip then resolves to
        // `undefined` to satisfy the preload's `Promise<void>`.
        if (!isInsidePath(replayDir, validated)) {
            throw new Error(
                `replay:delete: path ${JSON.stringify(validated)} escapes the replay directory`,
            );
        }
        return replay.delete(validated).then(() => undefined);
    });

    ipcMain.handle(REPLAY_OPEN_PLAYBACK_CHANNEL, (_event, replayPath) => {
        // Current-match preview: the sentinel opens the in-memory recording, never
        // a stored file, so it is matched by exact equality BEFORE any path parse
        // or containment check and routed to `openCurrent`. It never reaches
        // `isInsidePath` nor the repository (OWASP A01 unaffected).
        if (replayPath === CURRENT_MATCH_REPLAY_PATH) {
            return playback.openCurrent();
        }
        const validated = parseInvokeRequest(
            ReplayPathSchema,
            REPLAY_OPEN_PLAYBACK_CHANNEL,
            replayPath,
        );
        // Symmetric traversal defence with open-in-player/delete (OWASP A01):
        // the playback session loads the file, so the boundary must reject any
        // path outside the replay directory before the manager is touched.
        if (!isInsidePath(replayDir, validated)) {
            throw new Error(
                `replay:open-playback: path ${JSON.stringify(validated)} escapes the replay directory`,
            );
        }
        return playback.open(validated);
    });

    ipcMain.handle(REPLAY_SNAPSHOT_AT_CHANNEL, (_event, tick) => {
        const validated = parseInvokeRequest(ReplayTickSchema, REPLAY_SNAPSHOT_AT_CHANNEL, tick);
        // Invariant #3: the manager projects to a PlayerSnapshot before return;
        // no GameSnapshot crosses this channel.
        return playback.snapshotAt(validated);
    });

    ipcMain.handle(REPLAY_SNAPSHOT_RANGE_CHANNEL, (_event, range) => {
        const { from, to } = parseInvokeRequest(
            ReplaySnapshotRangeSchema,
            REPLAY_SNAPSHOT_RANGE_CHANNEL,
            range,
        );
        // Invariant #3: every element is a projected PlayerSnapshot. The schema
        // caps the span (MAX_SNAPSHOT_RANGE) so the projection loop is bounded.
        return playback.snapshotRange(from, to);
    });

    ipcMain.handle(REPLAY_CLOSE_PLAYBACK_CHANNEL, () => {
        playback.close();
        return undefined;
    });
}

// ─── Perspective replay namespace (§4.28, ADR F44b) ───────────────────────────

/**
 * Narrow port the perspective-replay IPC handlers depend on. A subset of
 * {@link import('../replay/PerspectiveReplayManager.js').PerspectiveReplayManager}
 * — only the read/delete methods the renderer surface needs. The manager owns
 * recording state; `exportCurrent` is injected separately because finalising
 * the in-progress recording must be gated on an active recording, which only
 * the wiring layer knows.
 *
 * Invariant #98: `list` returns opaque file paths (a perspective replay's
 * metadata is read only when it is opened); the recorded frames never cross
 * these read channels.
 */
export interface PerspectiveReplayIpcPort {
    list(gameId: string): Promise<PerspectiveReplayListItem[]>;
    delete(path: string): Promise<void>;
}

/**
 * Narrow port driving perspective-replay *playback* (§4.28). Wired to
 * `PerspectiveReplayPlaybackManager` in `index.ts`.
 *
 * Invariant #3 / #98: `snapshotAt` / `snapshotRange` serve stored, already
 * fog-filtered {@link PlayerSnapshot}s for the single locked viewer; no
 * `GameSnapshot` is ever produced or returned.
 */
export interface PerspectiveReplayPlaybackPort {
    open(path: string): Promise<PerspectiveReplayPlaybackInfo>;
    /**
     * Open playback for the in-memory perspective recording of the just-finished
     * match (post-game preview, before any save). Backs the
     * {@link CURRENT_MATCH_REPLAY_PATH} sentinel — no filesystem read.
     */
    openCurrent(): Promise<PerspectiveReplayPlaybackInfo>;
    snapshotAt(tick: number): PlayerSnapshot;
    snapshotRange(from: number, to: number): PlayerSnapshot[];
    close(): void;
}

export interface RegisterPerspectiveReplayHandlersOptions {
    readonly ipcMain: ReplayHandlersIpcMain;
    /** Injected logger (invariant 67). See {@link RegisterReplayHandlersOptions}. */
    readonly logger?: Logger;
    /** Live perspective read/delete port — production wires the `PerspectiveReplayManager`. */
    readonly replay: PerspectiveReplayIpcPort;
    /** Live perspective playback port — production wires the `PerspectiveReplayPlaybackManager`. */
    readonly playback: PerspectiveReplayPlaybackPort;
    /**
     * Absolute path of the perspective-replay directory.
     * `chimera:replay:perspective:open-in-player`, `:delete`, and
     * `:open-playback` resolve the requested path and assert it stays inside
     * this root before acting (defence-in-depth for OWASP A01).
     */
    readonly perspectiveReplayDir: string;
    /**
     * Finalise the in-progress perspective recording to disk and resolve with
     * the saved file path. Injected by the wiring layer because it must reject
     * when no perspective recording is active — a condition only the live
     * session graph knows. `name` is the validated user-entered replay name (or
     * `undefined`).
     */
    readonly exportCurrent: (name?: string) => Promise<string>;
    /**
     * Push the validated replay path to the renderer (via the shared
     * `chimera:replay:navigate`) so it can switch to the replay player route.
     * Reuses the deterministic surface's push channel. `saveable` rides along so
     * the player shows its save icon for a just-finished match.
     */
    readonly navigateToPlayer: (path: string, saveable: boolean) => void;
}

/**
 * Register every `chimera:replay:perspective:*` main-side channel (§4.28, ADR
 * F44b). Mirrors {@link registerReplayHandlers} for the privacy-preserving
 * perspective surface; the navigate push is the deterministic channel reused, so
 * it is intentionally absent here.
 *
 * Invariant 5: channel constants come from `preload/apis/perspective-replay-api.ts`.
 * Invariant 3 / 98: no `GameSnapshot` crosses these channels — `list` returns
 * file paths, `export-current` a saved-file path, and every snapshot is a stored
 * `PlayerSnapshot` for the single locked viewer.
 * Invariant 25: every input is Zod-validated (reusing the deterministic tick /
 * range / path schemas) before any port call.
 * Invariant 67: the logger is injected; this function never constructs one.
 */
export function registerPerspectiveReplayHandlers(
    options: RegisterPerspectiveReplayHandlersOptions,
): void {
    const { ipcMain, replay, playback, perspectiveReplayDir, exportCurrent, navigateToPlayer } =
        options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:replay:perspective:* handlers', {
        channels: [
            PERSPECTIVE_REPLAY_LIST_CHANNEL,
            PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
            PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
            PERSPECTIVE_REPLAY_DELETE_CHANNEL,
            PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
            PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
            PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
            PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL,
        ],
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_LIST_CHANNEL, (_event, gameId) => {
        const validated = parseInvokeRequest(GameIdSchema, PERSPECTIVE_REPLAY_LIST_CHANNEL, gameId);
        return replay.list(validated);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL, (_event, request) => {
        // Fail-safe: a malformed/absent payload coerces to an unnamed export,
        // never throwing — see `PerspectiveReplayExportRequestSchema`.
        const { name } = parseInvokeRequest(
            PerspectiveReplayExportRequestSchema,
            PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
            request,
        );
        return exportCurrent(name);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL, (_event, replayPath, saveable) => {
        const validatedSaveable = parseInvokeRequest(
            ReplaySaveableFlagSchema,
            PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
            saveable,
        );
        // Current-match preview sentinel (see the deterministic open-in-player):
        // not a filesystem path, matched before any parse/containment check, so it
        // never reaches `isInsidePath` (OWASP A01 unaffected).
        if (replayPath === CURRENT_MATCH_REPLAY_PATH) {
            navigateToPlayer(CURRENT_MATCH_REPLAY_PATH, validatedSaveable);
            return undefined;
        }
        const validated = parseInvokeRequest(
            ReplayPathSchema,
            PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
            replayPath,
        );
        if (!isInsidePath(perspectiveReplayDir, validated)) {
            throw new Error(
                `replay:perspective:open-in-player: path ${JSON.stringify(validated)} escapes the perspective replay directory`,
            );
        }
        navigateToPlayer(validated, validatedSaveable);
        return undefined;
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_DELETE_CHANNEL, (_event, replayPath) => {
        const validated = parseInvokeRequest(
            ReplayPathSchema,
            PERSPECTIVE_REPLAY_DELETE_CHANNEL,
            replayPath,
        );
        // Symmetric traversal defence with open-in-player/open-playback (OWASP
        // A01); the repository also guards containment, but the IPC boundary
        // rejects independently of the injected port. Throws synchronously before
        // any port call; the delete round-trip then resolves to `undefined`.
        if (!isInsidePath(perspectiveReplayDir, validated)) {
            throw new Error(
                `replay:perspective:delete: path ${JSON.stringify(validated)} escapes the perspective replay directory`,
            );
        }
        return replay.delete(validated).then(() => undefined);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL, (_event, replayPath) => {
        // Current-match preview sentinel: opens the in-memory perspective recording,
        // never a stored file — matched before any parse/containment check (OWASP
        // A01 unaffected).
        if (replayPath === CURRENT_MATCH_REPLAY_PATH) {
            return playback.openCurrent();
        }
        const validated = parseInvokeRequest(
            ReplayPathSchema,
            PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
            replayPath,
        );
        if (!isInsidePath(perspectiveReplayDir, validated)) {
            throw new Error(
                `replay:perspective:open-playback: path ${JSON.stringify(validated)} escapes the perspective replay directory`,
            );
        }
        return playback.open(validated);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL, (_event, tick) => {
        const validated = parseInvokeRequest(
            ReplayTickSchema,
            PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
            tick,
        );
        // Invariant #3 / #98: a stored PlayerSnapshot for the locked viewer; no
        // GameSnapshot crosses this channel.
        return playback.snapshotAt(validated);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL, (_event, range) => {
        const { from, to } = parseInvokeRequest(
            ReplaySnapshotRangeSchema,
            PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
            range,
        );
        // Reuses the deterministic span cap (MAX_SNAPSHOT_RANGE) so a hostile
        // renderer cannot request an unbounded buffer. The result is sparse
        // (only recorded frames in range — invariant #98).
        return playback.snapshotRange(from, to);
    });

    ipcMain.handle(PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL, () => {
        playback.close();
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
    /** Live SettingsManager instance. When absent, falls back to stub behaviour. */
    readonly settingsManager?: SettingsManager;
}

/**
 * Placeholder `ResolvedSettings` returned by the get/update/reset stubs when no
 * `SettingsManager` is wired. An empty object satisfies the
 * `ResolvedSettings = Record<string, unknown>` contract without asserting any
 * engine-wide or game-specific default values.
 */
const STUB_RESOLVED_SETTINGS: ResolvedSettings = Object.freeze({});

/**
 * Register every `chimera:settings:*` main-side channel. With no
 * `SettingsManager` wired these fall back to stubs; the live manager supplies
 * schema validation, three-layer merging, and persisted user overrides.
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
            // Validate patch against per-game schema at IPC boundary.
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

// ── Profile handlers (§4.24) ─────────────────────────────────────────────────

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
     * Live ProfileManager instance.
     * When absent, `chimera:profile:get-local` returns a sentinel stub and
     * `chimera:profile:update-local` is a no-op.
     */
    readonly profileManager?: ProfileManagerPort;
    /**
     * Live PlayerDirectory instance (host-only).
     * When absent, `chimera:profile:get-lobby-directory` returns an empty
     * record.
     */
    readonly playerDirectory?: PlayerDirectoryPort;
}

/**
 * Sentinel stub profile returned by `chimera:profile:get-local` when no
 * `ProfileManager` has been wired yet. The shape satisfies
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

// ─── Chat (§4.29) ──────────────────────────────────────────────────────────────

/** Shape of a main-side `ipcMain.handle` handler for the chat namespace. */
export type ChatInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/** Shape of a main-side `ipcMain.on` listener for the chat namespace. */
export type ChatSendListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow slice of `Electron.IpcMain` required to register the chat-namespace
 * channels. `send` / `history` are invoke-style round-trips (the renderer needs
 * the relay outcome / the buffered list); `mute` / `unmute` are fire-and-forget
 * `on` sends because the {@link ChatAPI} methods return `void`.
 */
export interface ChatHandlersIpcMain {
    handle(channel: string, handler: ChatInvokeHandler): unknown;
    on(channel: string, handler: ChatSendListener): unknown;
}

export interface RegisterChatHandlersOptions {
    readonly ipcMain: ChatHandlersIpcMain;
    /**
     * Submit a locally-originated chat message to the host relay and return its
     * outcome. Wired to `LobbyManager.sendLocalChat` at the DIP point so the
     * mandatory `ChatRelay` gate runs (Invariant #73) and remote recipients are
     * reached over the transport.
     */
    readonly sendChat: (body: string, scope: ChatScope) => RelayResult;
    /** Return up to `maxEntries` of the most recent (non-muted) messages. */
    readonly history: (maxEntries?: number) => readonly ChatMessage[];
    /** Mute a player locally (suppresses delivery + history; reversible). */
    readonly mute: (playerId: PlayerId) => void;
    /** Unmute a player locally. */
    readonly unmute: (playerId: PlayerId) => void;
    /** Injected logger (Invariant #67). */
    readonly logger?: Logger;
}

/**
 * Register every `chimera:chat:*` main-side channel (§4.29 — Chat System).
 *
 * `chimera:chat:message` is intentionally absent: it is a one-way push from
 * main → renderer via `webContents.send`, driven by `ChatHub` at the wiring
 * point whenever the local player is a recipient. There is no invoke handler.
 *
 * Invariant #5: channel constants come from `preload/apis/chat-api.ts`; there is
 * no parallel list in this file to drift out of sync.
 *
 * Invariant #72/#73: these handlers never touch the simulation; `send` routes
 * through the mandatory `ChatRelay` gate via the injected `sendChat` port — there
 * is no bypass.
 */
export function registerChatHandlers(options: RegisterChatHandlersOptions): void {
    const { ipcMain, sendChat, history, mute, unmute } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:chat:* handlers', {
        channels: [CHAT_SEND_CHANNEL, CHAT_HISTORY_CHANNEL, CHAT_MUTE_CHANNEL, CHAT_UNMUTE_CHANNEL],
    });

    ipcMain.handle(CHAT_SEND_CHANNEL, (_event, payload) => {
        const { body, scope } = parseInvokeRequest(
            ChatSendRequestSchema,
            CHAT_SEND_CHANNEL,
            payload,
        );
        return sendChat(body, scope);
    });

    ipcMain.handle(CHAT_HISTORY_CHANNEL, (_event, payload) => {
        const { maxEntries } = parseInvokeRequest(
            ChatHistoryRequestSchema,
            CHAT_HISTORY_CHANNEL,
            payload,
        );
        return history(maxEntries);
    });

    // `mute` / `unmute` are fire-and-forget `on` sends — the ChatAPI methods
    // return void. A throw inside an `on` callback is silently dropped by
    // Electron, so a malformed payload is logged and ignored (no state change)
    // rather than surfacing on a rejection channel.
    const onMutePlayerChannel =
        (channel: string, apply: (playerId: PlayerId) => void): ChatSendListener =>
        (_event, payload) => {
            try {
                const { playerId } = parseInvokeRequest(ChatMuteRequestSchema, channel, payload);
                apply(playerId);
            } catch (err) {
                if (err instanceof IpcRequestValidationError) {
                    logger.warn('ipc chat payload rejected', { channel, issues: err.issues });
                    return;
                }
                throw err;
            }
        };

    ipcMain.on(CHAT_MUTE_CHANNEL, onMutePlayerChannel(CHAT_MUTE_CHANNEL, mute));
    ipcMain.on(CHAT_UNMUTE_CHANNEL, onMutePlayerChannel(CHAT_UNMUTE_CHANNEL, unmute));
}

/** Shape of a main-side `ipcMain.on` listener for the spectate namespace. */
export type SpectatorSendListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow slice of `Electron.IpcMain` required to register the spectate
 * namespace. Only `on` is needed — `chimera:spectate:set-target` is a
 * fire-and-forget send (the {@link SpectatorAPI} method returns `void`).
 */
export interface SpectatorHandlersIpcMain {
    on(channel: string, handler: SpectatorSendListener): unknown;
}

export interface RegisterSpectatorHandlersOptions {
    readonly ipcMain: SpectatorHandlersIpcMain;
    /**
     * Forward a spectator's own follow-target switch to the authoritative host.
     * Wired to `LobbyManager.setSpectatorTarget` at the DIP point: a joined
     * (non-host) session forwards over the transport, where the host validates
     * the target is seated and re-points the viewer (Invariant #115).
     */
    readonly setSpectatorTarget: (targetPlayerId: PlayerId) => void;
    /** Injected logger (Invariant #67). */
    readonly logger?: Logger;
}

/**
 * Register the `chimera:spectate:set-target` main-side channel (§4.1 / §4.3 —
 * Spectator Mode).
 *
 * Fire-and-forget `on` send: a throw inside an `on` callback is silently
 * dropped by Electron, so a malformed payload is logged and ignored (no state
 * change) rather than surfacing on a rejection channel — mirroring the chat
 * mute/unmute handlers.
 *
 * Invariant #5: the channel constant comes from `preload/apis/spectator-api.ts`;
 * there is no parallel list in this file to drift out of sync. The message
 * never touches the simulation (Invariant #115): it re-points a viewer's
 * perspective, never dispatches an `EngineAction`.
 */
export function registerSpectatorHandlers(options: RegisterSpectatorHandlersOptions): void {
    const { ipcMain, setSpectatorTarget } = options;
    const logger = options.logger ?? createNoopLogger();
    logger.info('registering chimera:spectate:* handlers', {
        channels: [SPECTATE_SET_TARGET_CHANNEL],
    });

    ipcMain.on(SPECTATE_SET_TARGET_CHANNEL, (_event, payload) => {
        try {
            const { targetPlayerId } = parseInvokeRequest(
                SpectateSetTargetPayloadSchema,
                SPECTATE_SET_TARGET_CHANNEL,
                payload,
            );
            setSpectatorTarget(targetPlayerId);
        } catch (err) {
            if (err instanceof IpcRequestValidationError) {
                logger.warn('ipc spectate payload rejected', {
                    channel: SPECTATE_SET_TARGET_CHANNEL,
                    issues: err.issues,
                });
                return;
            }
            throw err;
        }
    });
}
