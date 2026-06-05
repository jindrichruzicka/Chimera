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
import type { LobbyInfo, LobbyPlayerEntry, LobbyState } from '@chimera/shared/messages-schemas.js';
import type { PerspectiveReplayListBridge } from '@chimera/shared/replay-bridge-contract.js';
import type { AssetRef, TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import type { CommitmentId } from '@chimera/simulation/projection/index.js';
import type {
    PlayerId,
    EntityId,
    GamePhase,
    GameResult,
    SceneId,
    SceneTransitionState,
} from '@chimera/simulation/engine/types.js';
import { playerId, entityId, gamePhase } from '@chimera/simulation/engine/types.js';
import type { EngineSettings } from '@chimera/simulation/settings/SettingsSchema.js';

// ─── Primitive aliases ────────────────────────────────────────────────────────

/** Opaque player identifier. Canonical branded type: simulation/ (F03). */
export type { PlayerId };

/** Opaque entity identifier. Canonical branded type: simulation/ (F03). */
export type { EntityId };

/** Opaque commitment identifier. Canonical branded type: simulation/projection (§4.6). */
export type { CommitmentId };

/** Current phase of the game state machine. Canonical: simulation/ (F03). */
export type { GamePhase };

/** Current coarse-grained scene identifier. Canonical: simulation/scene (§4.18). */
export type { SceneId, SceneTransitionState };

/** Resolved game outcome. Canonical: simulation/ (§4.38). */
export type { GameResult };

/**
 * Constructs a branded {@link PlayerId} from a raw string.
 *
 * This is the single authorised cast site for PlayerId in the preload layer.
 * All production code and test helpers must call this instead of
 * writing `raw as PlayerId` directly.
 */
export { playerId };

/**
 * Constructs a branded {@link EntityId} from a raw string.
 *
 * This is the single authorised cast site for EntityId in the preload layer.
 * All production code and test helpers must call this instead of
 * writing `raw as EntityId` directly.
 */
export { entityId };

/**
 * Constructs a branded {@link GamePhase} from a raw string.
 *
 * This is the single authorised cast site for GamePhase in the preload layer.
 * All production code and test helpers must call this instead of
 * writing `raw as GamePhase` directly.
 */
export { gamePhase };

/**
 * Opaque save-slot identifier. Branded to prevent accidental mixing with
 * other string-shaped values (e.g. gameId, playerId, session tokens).
 *
 * Use {@link toSlotId} to construct a value from a raw string.
 */
export type SlotId = string & { readonly __brand: 'SlotId' };

/**
 * Constructs a branded {@link SlotId} from a raw string.
 *
 * This is the single authorised cast site for the SlotId brand.
 * All production code and test helpers must call this instead of
 * writing `raw as SlotId` directly.
 *
 * @remarks No format validation is performed; use {@link SlotIdSchema} to validate
 * the qualified format at the IPC boundary.
 */
export const toSlotId = (raw: string): SlotId => raw as SlotId;

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
    readonly id: CommitmentId;
    readonly commitment: string;
    readonly revealedAt?: number;
}

/** Verified reveal of a previously committed hidden value. */
export interface CommitmentReveal {
    readonly id: CommitmentId;
    readonly value: unknown;
    readonly nonce: string;
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
    readonly sceneId?: SceneId;
    readonly sceneDefaultScreen?: string;
    readonly sceneTransition?: SceneTransitionState | null;
    readonly events: readonly GameEvent[];
    readonly gameResult: GameResult | null;
    readonly commitments: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
    readonly isMyTurn: boolean;
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

/** Configurable controller kind for a hosted lobby player slot. */
export type LobbyAgentKind = 'human' | 'ai';

/** Player-slot controller metadata supplied when hosting a lobby. */
export interface LobbyAgentSlot {
    readonly slotIndex: number;
    readonly kind: LobbyAgentKind;
    readonly omniscient?: boolean;
}

/** Parameters for hosting a new lobby session. */
export interface HostLobbyParams {
    readonly gameId: string;
    readonly maxPlayers: number;
    readonly agentSlots?: readonly LobbyAgentSlot[];
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
}

/** Metadata returned when a lobby is successfully hosted or joined. */
export type { LobbyInfo, LobbyPlayerEntry, LobbyState };

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
    readonly slotId: SlotId;
    readonly gameId: string;
    readonly tick: number;
    readonly savedAt: number;
    readonly label?: string;
}

/**
 * Parameters for writing a save slot.
 *
 * **Intentional Type Semantic Overload (TypeScript §1.3):**
 * `slotId` is typed as `SlotId` (branded) to express intent and enable type-safe
 * slot referencing in load/delete contexts. However, at the IPC schema boundary
 * (`electron/main/ipc/ipc-schemas.ts`), the `SaveRequestSchema` validates `slotId`
 * as `NonEmptyStringSchema` — meaning any non-empty string is accepted at runtime
 * for the save operation (bare slot name hints), while load/delete channels enforce
 * the fully-qualified `SlotId` format via `SlotIdSchema`.
 *
 * **Rationale:** During save, we allow users to optionally supply a human-readable
 * slot name hint (any non-empty string). During load/delete, we require the exact
 * qualified SlotId format. The brand at the type level ensures the renderer and
 * main process stay in sync on semantics; runtime validation is context-specific.
 *
 * No runtime hazard: the main process SaveManager internally uses the fully-qualified
 * SlotId for all repository operations and never trusts the bare hint directly.
 */
export interface SaveRequest {
    readonly gameId: string;
    readonly slotId?: SlotId;
    readonly label?: string;
}

/**
 * Result returned by {@link SavesAPI.checkCrashRecovery}.
 *
 * When `needsRecovery` is `true`, `slotId` identifies the autosave slot from
 * the interrupted session that the renderer may offer to resume.
 * `slotId` is `null` when `needsRecovery` is `false`.
 *
 * Invariant #1: only the opaque `slotId` string crosses the IPC boundary —
 * never the full `SaveFile` or `GameSnapshot`.
 */
export interface CrashRecoveryStatus {
    readonly needsRecovery: boolean;
    readonly slotId: SlotId | null;
}

// ─── Settings domain stubs ────────────────────────────────────────────────────
// Superseded by simulation/ settings module (F07).

/**
 * Engine-wide settings structure.
 * Canonical: simulation/settings/SettingsSchema.ts (F07).
 */
export type { EngineSettings };

/** Engine audio settings sub-shape. Canonical: simulation/settings/SettingsSchema.ts. */
export type AudioSettings = EngineSettings['audio'];

/** Engine display settings sub-shape. Canonical: simulation/settings/SettingsSchema.ts. */
export type DisplaySettings = EngineSettings['display'];

/** Engine gameplay settings sub-shape. Canonical: simulation/settings/SettingsSchema.ts. */
export type GameplaySettings = EngineSettings['gameplay'];

/** Engine controls settings sub-shape. Canonical: simulation/settings/SettingsSchema.ts. */
export type ControlsSettings = EngineSettings['controls'];

/** Fully merged settings tree (engine defaults + game defaults + user overrides). */
export type ResolvedSettings = Record<string, unknown>;

/** User-supplied settings overrides; a partial patch applied on top of defaults. */
export type UserSettings = Record<string, unknown>;

// ─── System domain types ──────────────────────────────────────────────────────

/** Current IPC / WebSocket connection health status as seen by the renderer. */
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// ─── Device info domain types (§4.17) ────────────────────────────────────────
//
// Defined here (not in renderer/device/DeviceInfo.ts) so that the preload
// contract and the Electron main process can reference the shape without
// importing from renderer/ (which would violate the compilation boundary —
// the root tsconfig excludes renderer/). renderer/device/DeviceInfo.ts
// independently redefines these types (no re-export chain) — any change here
// must be mirrored there, and vice-versa.

/**
 * Conservative form-factor heuristic for Electron desktop targets (§4.17).
 * Determined by the main process on start; the renderer re-reads via `getDeviceInfo()`.
 */
export type DeviceFormFactor = 'desktop' | 'laptop' | 'tablet-convertible' | 'unknown';

/**
 * An input device class that the application has detected as active (§4.17).
 *
 * `inputs` on `DeviceInfo` is a set of all currently available modalities.
 * `primaryInput` is the most-recently-used one (last `pointerdown`, `keydown`,
 * or `gamepadconnected` event).
 */
export type InputModality = 'mouse' | 'keyboard' | 'touch' | 'pen' | 'gamepad';

/**
 * Window content-width bucket used for layout decisions (§4.17).
 * Derived from `BrowserWindow` content size; re-derived on every resize.
 */
export type SizeClass = 'compact' | 'regular' | 'large' | 'ultrawide';

/**
 * Snapshot of device facts available to game screens and `GameShell` for
 * layout and affordance decisions (§4.17).
 *
 * Fields produced by the main process (`device-probe.ts`) are available
 * immediately. Renderer-owned fields (`inputs`, `primaryInput`, `battery`)
 * carry conservative defaults until `DeviceInfoProvider` merges live DOM
 * signals into the snapshot.
 *
 * Invariant: this interface must NOT be used to cross any IPC boundary
 * directly — the renderer receives it via `SystemAPI.getDeviceInfo()` and
 * `SystemAPI.onDeviceInfoChange()`.
 */
export interface DeviceInfo {
    // ── Platform (from Electron main process via device-probe.ts) ────────────
    /** Operating system identifier. */
    readonly os: 'macos' | 'windows' | 'linux';
    /** OS version string, e.g. `'14.5.0'` (macOS) or `'10.0.22631'` (Windows). */
    readonly osVersion: string;
    /** CPU architecture. */
    readonly arch: 'x64' | 'arm64';
    /** Electron version string, e.g. `'33.2.0'`. */
    readonly electronVer: string;
    /** Chromium version string embedded in Electron, e.g. `'130.0.0.0'`. */
    readonly chromiumVer: string;
    /** BCP 47 locale tag, e.g. `'en-US'` or `'de-DE'`. */
    readonly locale: string;

    // ── Form factor ───────────────────────────────────────────────────────────
    /** Conservative form-factor heuristic — see `DeviceFormFactor`. */
    readonly formFactor: DeviceFormFactor;

    // ── Display (from Electron main process via screen.getAllDisplays()) ──────
    /** All connected screens. At least one entry is always present. */
    readonly screens: readonly {
        readonly id: number;
        readonly width: number;
        readonly height: number;
        readonly pixelRatio: number;
        readonly refreshHz: number;
        readonly primary: boolean;
    }[];
    /**
     * Size class of the current `BrowserWindow` content area.
     * Re-derived on every resize event.
     */
    readonly windowSizeClass: SizeClass;

    // ── Input (detected in renderer; main-side defaults until provider merges)
    /** All input modalities currently detected as available. */
    readonly inputs: readonly InputModality[];
    /**
     * Most recently active input modality.
     * Updated on `pointerdown`, `keydown`, and `gamepadconnected` events.
     */
    readonly primaryInput: InputModality;

    // ── Battery (detected in renderer; null until provider merges) ────────────
    /**
     * Battery state from `navigator.getBattery()` where supported.
     * `null` on desktop systems without a battery sensor.
     */
    readonly battery: { readonly charging: boolean; readonly level: number } | null;
}

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/** Returned by every subscription method; call to remove the listener. */
export type Unsubscribe = () => void;

// ─── Deferred namespace stubs ─────────────────────────────────────────────────
// Empty interfaces exist so that ChimeraAPI declares the full §4.1 shape.
// Each will be replaced with a concrete interface in the milestone listed.

// ─── Profile domain types ─────────────────────────────────────────────────────
// Canonical definitions live in simulation/profile/ProfileSchema.ts (F14).
// Redeclared here so the renderer's type-only dependency on this module
// (via renderer/types/chimera.d.ts) does NOT depend on simulation/profile/.
// Type-only imports from simulation/content are allowed by the architecture
// because renderer code may consume AssetRef primitives without pulling in
// simulation runtime logic.

/** Builtin avatar — references an engine asset; zero transport cost. */
export interface BuiltinAvatarSource {
    readonly kind: 'builtin';
    readonly ref: AssetRef<TextureAsset>;
}

/** Custom inline avatar — base64-encoded PNG or JPEG, max 64 KB decoded. */
export interface CustomAvatarSource {
    readonly kind: 'custom';
    readonly mimeType: 'image/png' | 'image/jpeg';
    readonly base64: string;
}

/**
 * Discriminated union for the two avatar strategies.
 * Canonical: simulation/profile/ProfileSchema.ts (F14).
 */
export type AvatarSource = BuiltinAvatarSource | CustomAvatarSource;

/**
 * Base profile carried by every player. Cosmetic only — never enters
 * GameSnapshot, PlayerSnapshot, or SaveFile (Invariant #59).
 * Canonical: simulation/profile/ProfileSchema.ts (F14).
 */
export interface EngineProfile {
    readonly localProfileId: string;
    readonly displayName: string;
    readonly avatar: AvatarSource;
    readonly locale: string;
}

/**
 * Convenience alias for the unextended engine profile.
 * Canonical: simulation/profile/ProfileSchema.ts (F14).
 */
export type PlayerProfile = EngineProfile;

/**
 * A lightweight entry returned by {@link ProfileAPI.listLocalSlots}.
 * Used by profile management UI to list locally persisted identities.
 */
export interface LocalProfileSlot {
    readonly localProfileId: string;
    readonly displayName: string;
}

/** F14 — Player Profiles and Directory (§4.24). */
export interface ProfileAPI {
    /** Returns this machine's local player profile. */
    getLocalProfile(): Promise<PlayerProfile>;
    /**
     * Update this machine's local profile.
     * Mid-lobby updates use the attest-first flow (§4.24).
     * The patch may not include `localProfileId` — the primary key is
     * immutable. Use `switchLocalSlot()` to change the active local profile.
     */
    updateLocal(patch: Partial<EngineProfile>): Promise<void>;
    /** Returns all profiles known in the current lobby (keyed by PlayerId). */
    getLobbyDirectory(): Promise<Readonly<Record<PlayerId, PlayerProfile>>>;
    /**
     * Subscribe to lobby directory changes (profiles joining/leaving/updating).
     * Returns an unsubscribe function.
     */
    onDirectoryChanged(
        listener: (directory: Readonly<Record<PlayerId, PlayerProfile>>) => void,
    ): Unsubscribe;
    /**
     * List all local profile slots on this machine.
     * Used by profile management UI to present locally persisted identities.
     */
    listLocalSlots(): Promise<readonly LocalProfileSlot[]>;
    /**
     * Switch the active local profile to the given slot.
     * Fires `chimera:profile:switch-slot` which calls
     * `ProfileManager.switchLocalSlot()` on the main side (§4.24).
     */
    switchLocalSlot(localProfileId: string): Promise<void>;
}

/**
 * One stored replay, as projected for the renderer's replay browser (§4.28).
 *
 * Built host-side from the replay file's header + metadata by
 * `ReplayManager.listItems`. Carries no gameplay state — never a
 * `GameSnapshot` and never the recorded action log (invariant #3 / #71); the
 * full file is loaded only when a replay is opened in the player.
 */
export interface ReplayListItem {
    /** Absolute path of the `.chimera-replay` file (opaque handle to the renderer). */
    path: string;
    gameId: string;
    gameVersion: string;
    engineVersion: string;
    /** ISO-8601 UTC timestamp captured at recording start. */
    recordedAt: string;
    /** Highest recorded tick — the replay's length. */
    durationTicks: number;
    /** Participating player ids, in recording order. */
    playerIds: string[];
}

/**
 * Static playback metadata returned by {@link ReplayAPI.openPlayback} (§4.28).
 *
 * Carries no gameplay state — the renderer's replay player uses it to size the
 * tick scrubber, choose a viewer perspective, and load the matching game
 * renderer. The authoritative per-tick state is fetched separately, and only
 * ever as a projected {@link PlayerSnapshot} (invariant #3).
 */
export interface ReplayPlaybackInfo {
    /** Game identifier of the recorded match (drives renderer-game loading). */
    gameId: string;
    /** Highest tick in the replay — the scrubber's upper bound. */
    totalTicks: number;
    /** Participating player ids, in the game's player order. */
    playerIds: string[];
    /** Viewer perspective the projected snapshots are produced for. */
    viewerId: string;
}

/**
 * Static playback metadata returned by {@link PerspectiveReplayAPI.openPlayback}
 * (§4.28, ADR F44b). The privacy-preserving counterpart to
 * {@link ReplayPlaybackInfo}: a perspective replay captures one seat's already
 * fog-filtered view, so it carries the single **locked** `viewerId` and — unlike
 * the deterministic info — **no `playerIds` list**, because there is no other
 * seat to switch to (invariant #98).
 */
export interface PerspectiveReplayPlaybackInfo {
    /** Game identifier of the recorded match (drives renderer-game loading). */
    gameId: string;
    /** Highest recorded tick — the scrubber's upper bound. */
    totalTicks: number;
    /** The single locked viewer whose projection this replay captures. */
    viewerId: string;
}

/**
 * Renderer surface for the replay system (§4.28). Host-only in practice — the
 * main-process handlers own recording state and the replay directory; the
 * renderer only lists, exports, opens, deletes, and drives playback.
 */
export interface ReplayAPI {
    /** List stored replays for `gameId`, newest-first. */
    list(gameId: string): Promise<ReplayListItem[]>;
    /**
     * Finalise the in-progress recording to disk and resolve with the saved
     * file path. Stops recording (the natural end-of-match finalise then
     * no-ops). Rejects when no match is being hosted.
     */
    exportCurrentMatch(): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the replay directory, then pushes `chimera:replay:navigate`; the
     * renderer route reacts via {@link ReplayAPI.onNavigate}.
     */
    openInPlayer(path: string): Promise<void>;
    /** Permanently delete the replay at `path`. Rejected for paths outside the replay directory. */
    delete(path: string): Promise<void>;
    /**
     * Subscribe to replay-player navigation requests pushed by main (the
     * payload is the replay file path). Returns an {@link Unsubscribe}.
     */
    onNavigate(listener: (path: string) => void): Unsubscribe;
    /**
     * Load the replay at `path` into the main-process playback session and
     * resolve with its {@link ReplayPlaybackInfo}. Main validates the path is
     * inside the replay directory. Replaces any previously open playback.
     */
    openPlayback(path: string): Promise<ReplayPlaybackInfo>;
    /**
     * Fetch the projected {@link PlayerSnapshot} at `tick` from the open
     * playback session. Main drives the `ReplayPlayer` and projects the
     * authoritative state before it crosses IPC — only a `PlayerSnapshot` is
     * returned, never a `GameSnapshot` (invariant #3). Rejects when no playback
     * is open.
     */
    snapshotAt(tick: number): Promise<PlayerSnapshot>;
    /**
     * Fetch the projected {@link PlayerSnapshot}s for the inclusive tick range
     * `[from, to]` in a single round-trip, so the replay player can prefetch a
     * buffer of ticks instead of one IPC call per tick. Each element is a
     * projected `PlayerSnapshot`, never a `GameSnapshot` (invariant #3). Main
     * caps the span (`MAX_SNAPSHOT_RANGE`) and rejects `to < from`. Rejects when
     * no playback is open.
     */
    snapshotRange(from: number, to: number): Promise<PlayerSnapshot[]>;
    /** Close the open playback session, releasing its `ReplayPlayer`. */
    closePlayback(): Promise<void>;
    /**
     * The *perspective* replay surface (§4.28, ADR F44b) — privacy-preserving
     * replays that store one seat's already-projected `PlayerSnapshot` frames.
     * Exposed alongside (never replacing) the deterministic methods above; it
     * reuses the shared `onNavigate` push, so it carries no navigate of its own.
     */
    perspective: PerspectiveReplayAPI;
}

/**
 * Renderer surface for the *perspective* replay system (§4.28, ADR F44b),
 * reachable as `window.__chimera.replay.perspective`. Mirrors the deterministic
 * {@link ReplayAPI} read/playback methods for replays that capture a single
 * locked viewer's projected frames; `openInPlayer` reuses the deterministic
 * `chimera:replay:navigate` push (so the renderer subscribes via
 * {@link ReplayAPI.onNavigate} for both surfaces).
 *
 * Extends {@link PerspectiveReplayListBridge} (the shared `list` slice) so the
 * `list` shape stays pinned to the one contract that game shell modules read off
 * `globalThis` — a divergence is a compile error here, not a silent drift.
 */
export interface PerspectiveReplayAPI extends PerspectiveReplayListBridge {
    /**
     * List stored perspective-replay file paths for `gameId`, newest-first.
     * Unlike {@link ReplayAPI.list}, this returns opaque path handles — a
     * perspective replay's metadata is read only when it is opened.
     *
     * Narrows the shared {@link PerspectiveReplayListBridge.list} return to a
     * mutable `string[]` for the renderer's replay browser; assignable to the
     * shared `readonly string[]` view consumed by game shell modules.
     */
    list(gameId: string): Promise<string[]>;
    /**
     * Finalise the in-progress perspective recording to disk and resolve with
     * the saved file path. Rejects when no perspective recording is active.
     */
    exportCurrent(): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the perspective-replay directory, then pushes the shared
     * `chimera:replay:navigate`; the renderer reacts via {@link ReplayAPI.onNavigate}.
     */
    openInPlayer(path: string): Promise<void>;
    /** Permanently delete the perspective replay at `path`. Rejected for paths outside the perspective-replay directory. */
    delete(path: string): Promise<void>;
    /**
     * Load the perspective replay at `path` into the main-process playback
     * session and resolve with its {@link PerspectiveReplayPlaybackInfo}. Main
     * validates the path is inside the perspective-replay directory. Replaces
     * any previously open perspective playback.
     */
    openPlayback(path: string): Promise<PerspectiveReplayPlaybackInfo>;
    /**
     * Fetch the stored {@link PlayerSnapshot} at `tick` (floor lookup) from the
     * open perspective playback session. Frames are served verbatim — already
     * projected for the locked viewer, never re-simulated (invariant #98); only
     * a `PlayerSnapshot` crosses IPC (invariant #3). Rejects when no playback is open.
     */
    snapshotAt(tick: number): Promise<PlayerSnapshot>;
    /**
     * Fetch the stored {@link PlayerSnapshot}s within the inclusive tick range
     * `[from, to]` in a single round-trip. The result is **sparse** — only the
     * frames actually recorded in the window — because perspective playback
     * never re-projects (invariant #98). Main caps the span (`MAX_SNAPSHOT_RANGE`)
     * and rejects `to < from`. Rejects when no playback is open.
     */
    snapshotRange(from: number, to: number): Promise<PlayerSnapshot[]>;
    /** Close the open perspective playback session. */
    closePlayback(): Promise<void>;
}

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
    /** Stream of authoritative tick-only clock updates for the active viewer. */
    onTick(cb: (tick: number) => void): Unsubscribe;
    /**
     * Stream of {@link ActionRejection}s for actions dispatched from this
     * renderer that main refused to apply. Mirror of the §4.3 WebSocket
     * REJECT frame. The push is the ONLY way the renderer learns that a
     * `sendAction()` write was discarded — `sendAction` itself is
     * fire-and-forget (returns `void`).
     */
    onActionRejected(cb: (rejection: ActionRejection) => void): Unsubscribe;
    /** Stream of verified commitment reveals from the main-process trust gate. */
    onReveal(cb: (reveal: CommitmentReveal) => void): Unsubscribe;
    /**
     * Returns the set of action type strings whose `ActionDefinition.predictable`
     * field is `true` in the main-process `ActionRegistry`.
     *
     * Called once at renderer bootstrap so the prediction bridge can decide
     * which `sendAction()` calls enqueue an optimistic prediction. The result
     * is cached by `bootstrapGameStore` — there is no per-action round-trip.
     *
     * Returns an empty array when no `ActionRegistry` is available (e.g. before
     * a game session is active, or on builds that omit the prediction module).
     */
    getPredictableActionTypes(): Promise<readonly string[]>;
    /**
     * Returns the most-recently-sent {@link PlayerSnapshot} for this window,
     * or `null` when no snapshot has been pushed yet.
     *
     * Used by the renderer to replay a snapshot that arrived before the
     * `onSnapshot` listener was registered (e.g. direct-game E2E start,
     * renderer reload mid-session). Safe to call at any time — returns `null`
     * during the lobby phase.
     */
    getCurrentSnapshot(): Promise<PlayerSnapshot | null>;
}

// ─── lobby namespace ──────────────────────────────────────────────────────────

/** Host, join, leave, discover (§4.1). */
export interface LobbyAPI {
    host(params: HostLobbyParams): Promise<LobbyInfo>;
    join(params: JoinLobbyParams): Promise<LobbyInfo>;
    leave(): Promise<void>;
    /** Requests that the current host start the game for the active lobby. */
    startGame(): Promise<void>;
    /** Returns the current lobby state, or null when no lobby session is active. */
    getCurrentState(): Promise<LobbyState | null>;
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
    load(slotId: SlotId): Promise<void>;
    delete(slotId: SlotId): Promise<void>;
    /** Fires after save / delete / autosave. */
    onSlotUpdate(cb: (slots: SaveSlotMeta[]) => void): Unsubscribe;
    /**
     * Check whether a previous session terminated unexpectedly.
     *
     * Called once on renderer startup. When `needsRecovery` is `true` the
     * renderer should surface a {@link CrashRecoveryBanner} offering to
     * resume the interrupted session via `load(slotId)`.
     *
     * Invariant #1: only the opaque `slotId` string is returned — never the
     * full `SaveFile` or `GameSnapshot`.
     */
    checkCrashRecovery(): Promise<CrashRecoveryStatus>;
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
    /** Returns current device facts (§4.17). */
    getDeviceInfo(): Promise<DeviceInfo>;
    /**
     * Fires whenever device facts change — primarily on window resize.
     * Returns an unsubscribe function (§4.17).
     */
    onDeviceInfoChange(cb: (info: DeviceInfo) => void): Unsubscribe;
}
