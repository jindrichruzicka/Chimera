// simulation/bridge/api-types.ts
//
// The host↔renderer bridge contract (`window.__chimera` / `ChimeraAPI` and every
// nested namespace interface). It lives in the foundational `@chimera-engine/simulation`
// leaf — the ONE place both the renderer (which consumes the bridge) and
// `electron/preload` (Invariant #5: depends on `@chimera-engine/simulation` contracts only)
// may import it without a cross-layer back-edge. Side-effect-free type contracts
// derived from simulation types, alongside the other `foundation/*-contract` types.
// `@chimera-engine/electron/preload/api-types` re-exports it (electron implements the
// contract), preserving that public surface; this removes the old renderer→electron
// type back-edge (F62/F65).
//
// Consumed by the renderer directly, and re-exported to every namespace factory
// under `electron/preload/*-api.ts` and the main-process IPC handlers
// (`electron/main/ipc-handlers.ts`, `ipc-schemas.ts`) via the electron shim.
//
// This module is side-effect-free. The preload runtime entry lives in
// `electron/preload/api.ts`, which imports types from here and performs
// the single `contextBridge.exposeInMainWorld('__chimera', api)` call.
// Invariant 28: this file must NEVER declare a `__chimeraDebug` surface —
// the Debug Inspector preload lives elsewhere.

import type { LogEntry } from '../foundation/logging.js';
import type { ChatMessage, ChatScope, RelayResult } from '../foundation/chat.js';
import type { LobbyInfo, LobbyPlayerEntry, LobbyState } from '../foundation/messages-schemas.js';
import type { GameContent, GameContentItem } from '../foundation/game-content-contract.js';
import type {
    PerspectiveReplayExportBridge,
    PerspectiveReplayListBridge,
    ReplayExportBridge,
    ReplayExportIntent,
} from '../foundation/replay-bridge-contract.js';
import type { AssetRef, TextureAsset } from '../content/AssetRef.js';
import type { CommitmentId } from '../projection/index.js';
import type {
    PlayerId,
    EntityId,
    GamePhase,
    GameResult,
    SceneId,
    SceneTransitionState,
} from '../engine/types.js';
import { playerId, entityId, gamePhase } from '../engine/types.js';
import type { EngineSettings } from '../settings/SettingsSchema.js';

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

/** Chat contract types. Canonical: shared/chat.ts (§4.29 — Chat System). */
export type { ChatMessage, ChatScope, RelayResult };

/**
 * Replay-export intent. Canonical: shared/replay-bridge-contract.ts (§4.28).
 * Re-exported so renderer/preload consumers reach it through the api-types
 * surface alongside {@link ReplayAPI}.
 */
export type { ReplayExportIntent };

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
// The projected-snapshot contract (`PlayerSnapshot` + its `ObservedPlayerState` /
// `ObservedEntityState` / `GameEvent` helpers) and the commit/reveal
// envelope/reveal shapes now live in the zero-dependency foundation leaf
// `../foundation` (issue #758). They are re-exported here so the preload
// contract surface — and every renderer/main consumer that imports them from
// this module — stays unchanged.

import type {
    PlayerSnapshot,
    ObservedPlayerState,
    ObservedEntityState,
    GameEvent,
} from '../foundation/snapshot-contract.js';
export type { PlayerSnapshot, ObservedPlayerState, ObservedEntityState, GameEvent };

import type { CommitmentEnvelope, CommitmentReveal } from '../foundation/commitment-contract.js';
export type { CommitmentEnvelope, CommitmentReveal };

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
    /**
     * Optional lobby password (F56). When set, joining clients must present a
     * matching password; when absent/blank the lobby is open. Server-side only —
     * never broadcast or logged.
     */
    readonly password?: string;
}

/** Parameters for joining an existing lobby session. */
export interface JoinLobbyParams {
    readonly address: string;
    /** Optional lobby password (F56) presented to the host's password gate. */
    readonly password?: string;
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

/**
 * Transition of an opponent's connection presence, pushed host→renderer so the
 * renderer can raise the §4.30 "Player disconnected"/"Player reconnected" toasts
 * (#687). `disconnected` is a transient drop (not an intentional leave);
 * `reconnected` is the same player rejoining after such a drop.
 */
export type PlayerConnectionStatus = 'disconnected' | 'reconnected';

/** Payload of the `chimera:lobby:player-connection` push (§4.30 / #687). */
export interface PlayerConnectionEvent {
    readonly playerId: PlayerId;
    readonly status: PlayerConnectionStatus;
}

/**
 * Payload of the `chimera:lobby:player-left` push (§4.30). Fires only when an
 * opponent *deliberately* leaves during an active match (the in-battle
 * counterpart to {@link PlayerConnectionEvent}, which never fires for an
 * intentional leave). Drives the host's "{displayName} left game." toast.
 * `displayName` is lobby-scoped cosmetic data (Invariant #59) — never derived
 * from `GameSnapshot`/`PlayerSnapshot`/`SaveFile`, so it is toast-safe under
 * Invariant #74.
 */
export interface PlayerLeftMatchEvent {
    readonly playerId: PlayerId;
    readonly displayName: string;
}

/**
 * Structured profile-admission rejection, pushed host→renderer so the renderer
 * can raise the §4.30 "Profile rejected: {reason}" toast (#688). `reason` is the
 * raw gate code — `'profile:<AdmissionRejection>'` or `'rate_limit'` — never a
 * parsed `Error.message` (Invariants #61/#62). The renderer maps it to friendly
 * copy.
 */
export interface ProfileRejection {
    readonly reason: string;
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
 * Replay kind carried on the shared `chimera:replay:navigate` push (§4.28). The
 * deterministic and perspective `open-in-player` handlers reuse one push channel,
 * so the payload names which player surface the renderer route should select.
 */
export type ReplayNavigateKind = 'deterministic' | 'perspective';

/**
 * Payload of the shared `chimera:replay:navigate` push (§4.28). `path` is the
 * validated replay file path; `kind` tells {@link ReplayAPI.onNavigate} whether
 * to open the deterministic or the perspective player (the latter via
 * `?kind=perspective`). A perspective open must carry `'perspective'`, otherwise
 * the route would load a perspective file through the deterministic surface.
 *
 * `saveable` marks the just-finished match (opened from the post-game summary's
 * **Replay** action) so the player surfaces its compact save icon; the
 * navigation bridge forwards it as a `&saveable=1` query flag. Library-opened
 * replays carry `false` — they are already on disk and the current-match export
 * is session-gated to the live match (see {@link ReplayAPI.openInPlayer}).
 */
export interface ReplayNavigatePayload {
    readonly path: string;
    readonly kind: ReplayNavigateKind;
    readonly saveable: boolean;
}

/**
 * Renderer surface for the replay system (§4.28). Host-only in practice — the
 * main-process handlers own recording state and the replay directory; the
 * renderer only lists, exports, opens, deletes, and drives playback.
 *
 * Extends {@link ReplayExportBridge} (the shared `exportCurrentMatch` /
 * `openInPlayer` slice) so the methods a game's post-game summary reads off
 * `globalThis` stay pinned to one contract — a divergent signature is a compile
 * error here, not a silent drift.
 */
export interface ReplayAPI extends ReplayExportBridge {
    /** List stored replays for `gameId`, newest-first. */
    list(gameId: string): Promise<ReplayListItem[]>;
    /**
     * Finalise the in-progress recording to disk and resolve with the saved
     * file path. Stops recording (the natural end-of-match finalise then
     * no-ops). Rejects when no match is being hosted.
     *
     * `intent` (default `'save'`) gates the "Replay saved" toast: `'save'`
     * raises it, `'view'` (export-for-path-only) suppresses it. See
     * {@link ReplayExportIntent}.
     */
    exportCurrentMatch(intent?: ReplayExportIntent): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the replay directory, then pushes `chimera:replay:navigate`; the
     * renderer route reacts via {@link ReplayAPI.onNavigate}. `saveable` (default
     * `false`) marks the just-finished match so the player shows its save icon.
     */
    openInPlayer(path: string, saveable?: boolean): Promise<void>;
    /** Permanently delete the replay at `path`. Rejected for paths outside the replay directory. */
    delete(path: string): Promise<void>;
    /**
     * Subscribe to replay-player navigation requests pushed by main. The payload
     * carries the replay file `path` and its {@link ReplayNavigateKind} so the
     * route opens the matching player surface (deterministic or perspective).
     * Returns an {@link Unsubscribe}.
     */
    onNavigate(listener: (payload: ReplayNavigatePayload) => void): Unsubscribe;
    /**
     * Subscribe to successful replay-export notifications pushed by main after
     * `export-current-match` resolves (the payload is the saved replay path).
     * Lets a renderer listener raise the "Replay saved" toast (§4.30) when the
     * in-match game screen — which triggers the export but may not reach the
     * renderer toast store (Invariant #96) — saves a replay. Returns an
     * {@link Unsubscribe}.
     */
    onExported(listener: (path: string) => void): Unsubscribe;
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
 * Extends {@link PerspectiveReplayListBridge} (the shared `list` slice) and
 * {@link PerspectiveReplayExportBridge} (the `exportCurrent` / `openInPlayer`
 * slice a game's post-game summary reads off `globalThis` for a joined client) so
 * both shapes stay pinned to the one shared contract — a divergence is a compile
 * error here, not a silent drift.
 */
export interface PerspectiveReplayAPI
    extends PerspectiveReplayListBridge, PerspectiveReplayExportBridge {
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
     * `saveable` (default `false`) marks the just-finished match so the player
     * shows its save icon.
     */
    openInPlayer(path: string, saveable?: boolean): Promise<void>;
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

/**
 * F45 — Chat System (§4.29). The renderer's window into the bounded,
 * host-relayed chat layer. All messages route through the host's `ChatRelay`;
 * `send` resolves the relay's {@link RelayResult}, `onMessage` delivers relayed
 * messages, `history` returns a bounded server-ordered list, and `mute`/`unmute`
 * manage the local mute filter (main-side; muted senders are not delivered).
 */
export interface ChatAPI {
    /**
     * Submit a chat message to the host relay. Resolves the relay's outcome —
     * `{ ok: true }` on acceptance, or `{ ok: false, reason }` when the relay
     * rejects it (empty / too long / invalid scope / rate limited).
     */
    send(body: string, scope: ChatScope): Promise<RelayResult>;
    /**
     * Subscribe to relayed chat messages delivered to the local player. Returns
     * an {@link Unsubscribe} that removes exactly this listener.
     */
    onMessage(cb: (message: ChatMessage) => void): Unsubscribe;
    /**
     * Fetch up to `maxEntries` of the most recent messages, in server order.
     * Omitting `maxEntries` returns the full bounded buffer. Muted senders are
     * excluded.
     */
    history(maxEntries?: number): Promise<readonly ChatMessage[]>;
    /** Mute a player: their messages are no longer delivered or shown in history. */
    mute(playerId: PlayerId): void;
    /** Unmute a player: restores delivery and history visibility. */
    unmute(playerId: PlayerId): void;
}

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
 * declare module '@chimera-engine/core/electron/preload/api-types.js' {
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
 * Invariant: `ChimeraExtensions` is intentionally empty in `@chimera-engine/core`
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
    content: ContentAPI;
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
     * Empty in `@chimera-engine/core` 1.0.0. External packages populate this at
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

// ─── content namespace ────────────────────────────────────────────────────────

/**
 * Generic, game-agnostic content delivery (§4.8). Re-exported from the shared
 * contract so renderer code can `import type { GameContent } from
 * '@chimera-engine/electron/preload/api-types.js'` alongside the other API types.
 */
export type { GameContent, GameContentItem };

/**
 * Read a game's content collections, loaded and validated in main (§4.8). The
 * payload is plain data keyed by collection type; the engine and renderer never
 * interpret the item fields — only the authoring game does.
 */
export interface ContentAPI {
    /**
     * Return `gameId`'s content collections, or `null` when the game declares
     * none. Safe to call at any time; the content is static per game.
     */
    getCollections(gameId: string): Promise<GameContent | null>;
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
    /**
     * Host-only: abandon the active match and return the session to the lobby
     * phase — the reverse of {@link startGame}. The main process rejects this
     * from a joined (non-host) session (#736). Clients observe the lobby-phase
     * reset via the existing projected snapshot stream, not this channel.
     */
    returnToLobby(): Promise<void>;
    /** Returns the current lobby state, or null when no lobby session is active. */
    getCurrentState(): Promise<LobbyState | null>;
    getLocalPlayerId(): Promise<PlayerId | null>;
    updatePlayerReadyState(ready: boolean): Promise<void>;
    /**
     * Host-only: set a host-authored match setting (e.g. board colour). The main
     * process rejects this from a joined (non-host) session, then rebroadcasts
     * the full {@link LobbyState} to every client (#706).
     */
    setMatchSetting(key: string, value: string): Promise<void>;
    /**
     * Owner-authored: set an attribute on the local player's OWN seat at
     * `playerId` (e.g. unit colour); `playerId` must be the local player. The main
     * process rejects a write to any other seat and, for a joined client, forwards
     * the own-seat intent to the authoritative host, which applies it and
     * rebroadcasts the full {@link LobbyState} (#706, F53).
     */
    setPlayerAttribute(playerId: PlayerId, key: string, value: string): Promise<void>;
    /**
     * Host-only: append an AI agent slot to the lobby roster. The host assigns
     * the slot index. The main process rejects the call from a joined (non-host)
     * session and when the lobby is full, then rebroadcasts the full
     * {@link LobbyState} to every client (#724).
     */
    addAi(): Promise<void>;
    /**
     * Host-only: remove the AI agent slot at `slotIndex` from the lobby roster.
     * The main process rejects the call from a joined (non-host) session, then
     * rebroadcasts the full {@link LobbyState} to every client (#724).
     */
    removeAi(slotIndex: number): Promise<void>;
    onUpdate(cb: (lobby: LobbyState) => void): Unsubscribe;
    /**
     * Fires when an opponent's connection presence transitions (transient drop or
     * reconnect). Drives the §4.30 "Player disconnected"/"Player reconnected"
     * toasts (#687). Never fires for an intentional leave or a first-time join.
     */
    onPlayerConnectionChanged(cb: (event: PlayerConnectionEvent) => void): Unsubscribe;
    /**
     * Fires when an opponent *deliberately* leaves while a match is in progress
     * (the in-battle counterpart to {@link onPlayerConnectionChanged}, which is
     * silent for intentional leaves). Drives the host's §4.30 "{displayName} left
     * game." toast. Never fires for a transient drop or a lobby-phase leave.
     */
    onOpponentLeftMatch(cb: (event: PlayerLeftMatchEvent) => void): Unsubscribe;
    /**
     * Fires when this client's profile is rejected — at JOIN or for a mid-session
     * PROFILE_UPDATE. Drives the §4.30 "Profile rejected: {reason}" toast (#688).
     */
    onProfileRejected(cb: (rejection: ProfileRejection) => void): Unsubscribe;
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
    /**
     * Toggle the Debug Inspector window (§4.12). Data-free fire-and-forget
     * `send` on `chimera:debug:toggle-inspector` — an `ipcMain.on` channel
     * registered only by `debug-bridge.ts` when `IS_DEBUG_MODE` is true, so
     * in production the send is a harmless no-op and the promise still
     * resolves. Must never become an `invoke`: that would reject with
     * "No handler registered" even in debug mode, where the listener is
     * `on`, not `handle`. Invariant 28: this is the game renderer's ONLY
     * debug-related surface, and it carries no data in either direction.
     */
    toggleDebugInspector(): Promise<void>;
}
