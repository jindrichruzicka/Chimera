// electron/preload/api-types.ts
//
// Type-only module declaring the full `window.__chimera` contract
// (`ChimeraAPI` and every nested namespace interface). Consumed by the
// renderer through `renderer/types/chimera.d.ts`, by every namespace
// factory under `electron/preload/*-api.ts`, and by the main-process
// IPC handlers (`electron/main/ipc-handlers.ts`, `ipc-schemas.ts`).
//
// This module is side-effect-free. The preload runtime entry lives in
// `electron/preload/api.ts`, which imports types from here and performs
// the single `contextBridge.exposeInMainWorld('__chimera', api)` call.
// Invariant 28: this file must NEVER declare a `__chimeraDebug` surface —
// the Debug Inspector preload lives elsewhere.

import type { LogEntry } from '@chimera/shared/logging.js';

// ─── Primitive aliases ────────────────────────────────────────────────────────

/** Opaque player identifier. Canonical branded type: simulation/ (F03). */
export type PlayerId = string;

/** Opaque entity identifier. Canonical branded type: simulation/ (F03). */
export type EntityId = string;

/** Opaque commitment identifier. Canonical branded type: simulation/ (F27). */
export type CommitmentId = string;

/** Current phase of the game state machine. Canonical: simulation/ (F03). */
export type GamePhase = string;

// ─── Simulation domain stubs ──────────────────────────────────────────────────
// All superseded by simulation/snapshot.ts (F03).

/** Observed (potentially masked) state of a player in a projected snapshot. */
export interface ObservedPlayerState {
    readonly id: PlayerId;
}

/** Observed (potentially fog-filtered) state of an entity in a projected snapshot. */
export interface ObservedEntityState {
    readonly id: EntityId;
}

/** A game event visible to a specific viewer. */
export interface GameEvent {
    readonly type: string;
}

/** Cryptographic commitment envelope for a concealed value. */
export interface CommitmentEnvelope {
    readonly hash: string;
}

/**
 * Projected game state for the active viewer.
 * Canonical: simulation/snapshot.ts (F03).
 *
 * Invariant #1: GameSnapshot never crosses any IPC boundary. Only PlayerSnapshot does.
 */
export interface PlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    readonly players: Readonly<Record<PlayerId, ObservedPlayerState>>;
    readonly entities: Readonly<Record<EntityId, ObservedEntityState>>;
    readonly phase: GamePhase;
    readonly events: readonly GameEvent[];
    readonly commitments: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
}

/**
 * Generic IPC action envelope dispatched through GameAPI.sendAction().
 * Canonical: simulation/ (F03).
 */
export interface EngineAction<
    TType extends string = string,
    TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly type: TType;
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

/**
 * Main → renderer rejection of a previously dispatched {@link EngineAction}.
 *
 * Wire-shape mirror of the WebSocket `ServerMessage` REJECT frame (§4.3):
 * `{ type: 'REJECT'; reason: string; tick: number }`. The IPC variant adds
 * an optional `actionType` because the sender may not remember the exact
 * envelope that was rejected (e.g. when the rejection comes from the
 * ActionPipeline several ticks later).
 *
 * Today's sole trigger is IPC-layer envelope validation failure
 * (`IpcRequestValidationError`, introduced in issue #17). The same channel
 * and shape will be reused once F03–F15 wire the full `ActionPipeline` —
 * Stage 3 validation failures and unknown-action-type rejections also push
 * on this channel, so the renderer's listener contract does not churn.
 *
 * `tick` is `-1` when the request was so malformed that the tick could
 * not be recovered from the envelope.
 */
export interface ActionRejection {
    /** Human-readable reason, namespaced by source (e.g. `ipc-validation:<channel>`). */
    readonly reason: string;
    /** Tick the rejected action was aimed at, or `-1` when not recoverable. */
    readonly tick: number;
    /** Action type if it was recoverable from the envelope. */
    readonly actionType?: string;
}

// ─── Lobby domain stubs ───────────────────────────────────────────────────────
// Superseded by networking/ (F09–F11).

/** Parameters for hosting a new lobby session. */
export interface HostLobbyParams {
    readonly gameId: string;
    readonly maxPlayers: number;
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
}

/** Metadata returned when a lobby is successfully hosted or joined. */
export interface LobbyInfo {
    readonly sessionId: string;
    readonly hostId: PlayerId;
    readonly gameId: string;
}

/** One player's entry in the live lobby roster. */
export interface LobbyPlayerEntry {
    readonly playerId: PlayerId;
    readonly displayName: string;
    readonly ready: boolean;
}

/** Full lobby state pushed to all clients via onUpdate(). */
export interface LobbyState {
    readonly info: LobbyInfo;
    readonly players: readonly LobbyPlayerEntry[];
}

/** A browsable lobby entry returned by LobbyDiscoveryAPI.list(). */
export interface LobbyListEntry {
    readonly address: string;
    readonly gameId: string;
    readonly playerCount: number;
    readonly maxPlayers: number;
}

// ─── Save domain stubs ────────────────────────────────────────────────────────
// Superseded by simulation/ saves module (F06).

/** Metadata for a single save slot. */
export interface SaveSlotMeta {
    readonly slotId: string;
    readonly gameId: string;
    readonly tick: number;
    readonly savedAt: number;
    readonly label?: string;
}

/** Parameters for writing a save slot. */
export interface SaveRequest {
    readonly gameId: string;
    readonly slotId?: string;
    readonly label?: string;
}

// ─── Settings domain stubs ────────────────────────────────────────────────────
// Superseded by simulation/ settings module (F07).

/** Fully merged settings tree (engine defaults + game defaults + user overrides). */
export type ResolvedSettings = Record<string, unknown>;

/** User-supplied settings overrides; a partial patch applied on top of defaults. */
export type UserSettings = Record<string, unknown>;

// ─── System domain types ──────────────────────────────────────────────────────

/** Current IPC / WebSocket connection health status as seen by the renderer. */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/** Returned by every subscription method; call to remove the listener. */
export type Unsubscribe = () => void;

// ─── Deferred namespace stubs ─────────────────────────────────────────────────
// Empty interfaces exist so that ChimeraAPI declares the full §4.1 shape.
// Each will be replaced with a concrete interface in the milestone listed.

/** Stub. Expanded in F14 — Player Profiles and Directory (§4.24). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProfileAPI {}

/** Stub. Expanded in F44 — Replay System (§4.28). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ReplayAPI {}

/** Stub. Expanded in F45 — Chat System (§4.29). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChatAPI {}

/** Stub. Expanded in F43 — Crash Reporter / Logging (§4.27). */
export interface LogsAPI {
    /** Fire-and-forget: renderer emits a structured log entry to the main process. */
    emit(entry: LogEntry): void;
    /** Fetch the last `maxEntries` log entries from the main-process ring buffer. */
    readRecent(maxEntries: number): Promise<LogEntry[]>;
}

// ─── Extension registry ───────────────────────────────────────────────────────

/**
 * Open extension namespace registry — augment this interface from external
 * packages to add typed namespaces to `window.__chimera.extensions`.
 *
 * **How to extend (TypeScript declaration merging):**
 * ```ts
 * // In your game package's type declarations:
 * declare module '@chimera/core/electron/preload/api-types.js' {
 *     interface ChimeraExtensions {
 *         tactics: TacticsExtensionAPI;
 *     }
 * }
 * ```
 *
 * **Runtime registration** is separate — pair the declaration above with a
 * call to `registerExtension()` from `extensions-api.ts` in your preload
 * entry, before `contextBridge.exposeInMainWorld` is invoked.
 *
 * Invariant: `ChimeraExtensions` is intentionally empty in `@chimera/core`
 * 1.0.0. All extension namespaces are contributed by consuming packages.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChimeraExtensions {}

// ─── ChimeraAPI — root surface ────────────────────────────────────────────────

/**
 * The ONLY surface the renderer touches. Exposed at `window.__chimera` via
 * `contextBridge.exposeInMainWorld` in `electron/preload/api.ts`.
 *
 * Matches §4.1 exactly.
 *
 * - Invariant #4: The renderer reads state; it never writes state directly.
 *                 All writes go through `sendAction`.
 * - Invariant #5: All IPC methods are declared in `ipc-handlers.ts` and
 *                 exposed only through this file.
 */
export interface ChimeraAPI {
    game: GameAPI;
    lobby: LobbyAPI;
    saves: SavesAPI;
    settings: SettingsAPI;
    profile: ProfileAPI;
    replay: ReplayAPI;
    chat: ChatAPI;
    logs: LogsAPI;
    system: SystemAPI;
    /** Present only when the active MultiplayerProvider supports discovery. */
    lobbyDiscovery?: LobbyDiscoveryAPI;
    /**
     * Typed namespace map for all registered extensions.
     *
     * Empty in `@chimera/core` 1.0.0. External packages populate this at
     * preload time via `registerExtension()` from `extensions-api.ts` and
     * extend the type via TypeScript declaration merging on `ChimeraExtensions`.
     *
     * Keys are optional because `buildExtensionsApi()` returns a
     * `Readonly<Partial<ChimeraExtensions>>` — a consuming package that augments
     * `ChimeraExtensions` must also call `registerExtension()` to populate the
     * runtime value, otherwise the field will be `undefined` at runtime.
     * Always narrow the field before use:
     *   `if (window.__chimera.extensions.tactics) { ... }`
     *
     * Invariant: the object is frozen before it is passed to
     * `contextBridge.exposeInMainWorld`.
     */
    readonly extensions: Readonly<Partial<ChimeraExtensions>>;
}

// ─── game namespace ───────────────────────────────────────────────────────────

/** Action dispatch + snapshot stream (§4.1). */
export interface GameAPI {
    /** Dispatch a validated EngineAction built via ActionRegistry.build(). */
    sendAction(action: EngineAction): void;
    /** Stream of projected PlayerSnapshot for the active viewer. */
    onSnapshot(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /**
     * Stream of {@link ActionRejection}s for actions dispatched from this
     * renderer that main refused to apply. Mirror of the §4.3 WebSocket
     * REJECT frame. The push is the ONLY way the renderer learns that a
     * `sendAction()` write was discarded — `sendAction` itself is
     * fire-and-forget (returns `void`).
     */
    onActionRejected(cb: (rejection: ActionRejection) => void): Unsubscribe;
    /** Local multi-seat (pass-and-play): switch the active viewer for the current renderer. */
    switchActiveSeat(playerId: PlayerId): Promise<void>;
}

// ─── lobby namespace ──────────────────────────────────────────────────────────

/** Host, join, leave, discover (§4.1). */
export interface LobbyAPI {
    host(params: HostLobbyParams): Promise<LobbyInfo>;
    join(params: JoinLobbyParams): Promise<LobbyInfo>;
    leave(): Promise<void>;
    getLocalPlayerId(): Promise<PlayerId | null>;
    updatePlayerReadyState(ready: boolean): Promise<void>;
    onUpdate(cb: (lobby: LobbyState) => void): Unsubscribe;
}

// ─── lobbyDiscovery namespace ─────────────────────────────────────────────────

/**
 * Present on `window.__chimera.lobbyDiscovery` only when the active
 * MultiplayerProvider satisfies `BrowsableProvider` (§4.14, §4.1).
 */
export interface LobbyDiscoveryAPI {
    list(): Promise<LobbyListEntry[]>;
}

// ─── saves namespace (host only) ─────────────────────────────────────────────

/** List, save, load, delete save slots — host only (§4.1). */
export interface SavesAPI {
    list(gameId: string): Promise<SaveSlotMeta[]>;
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    load(slotId: string): Promise<void>;
    delete(slotId: string): Promise<void>;
    /** Fires after save / delete / autosave. */
    onSlotUpdate(cb: (slots: SaveSlotMeta[]) => void): Unsubscribe;
}

// ─── settings namespace ───────────────────────────────────────────────────────

/** Per-game and engine-wide settings (§4.1). */
export interface SettingsAPI {
    /** Fully merged ResolvedSettings (engine defaults + game defaults + user overrides). */
    get(gameId: string): Promise<ResolvedSettings>;
    update(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings>;
    reset(gameId: string): Promise<ResolvedSettings>;
    onChange(cb: (gameId: string, settings: ResolvedSettings) => void): Unsubscribe;
}

// ─── system namespace ─────────────────────────────────────────────────────────

/** Connection status, platform info, quit (§4.1). */
export interface SystemAPI {
    onConnectionStatus(cb: (status: ConnectionStatus) => void): Unsubscribe;
    platform(): Promise<{ os: 'macos' | 'windows' | 'linux'; version: string }>;
    quit(): void;
    /** Relaunches the Electron application (app.relaunch() + app.exit(0)). */
    relaunch(): void;
}
