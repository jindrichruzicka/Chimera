/**
 * shared/snapshot-contract.ts
 *
 * Foundation contract types for the two projected-snapshot shapes that cross
 * boundaries (Invariant #1 — only a projected snapshot ever leaves the host;
 * `GameSnapshot` never does).
 *
 * Both shapes live in `@chimera-engine/simulation/foundation` — the zero-dependency foundation leaf —
 * so the foundation can describe the wire protocol (`shared/messages.ts`) and
 * the game-screen contract (`shared/game-screen-contract.ts`) without importing
 * *up* into `networking` or `electron`. Two distinct shapes are kept on purpose
 * (they are NOT unified — that would be a real logic change, see issue #758):
 *
 *  - {@link PlayerSnapshot}     — the rich, renderer/screen-facing projection.
 *    `electron/preload/api-types.ts` re-exports it; game screens read it through
 *    `GameScreenProps.snapshot`.
 *  - {@link WirePlayerSnapshot} — the loose, opaque wire projection that crosses
 *    the network. `networking/provider/MultiplayerProvider.ts` re-exports it as
 *    `PlayerSnapshot`; `shared/messages.ts` carries it on the `SNAPSHOT` frame.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code. Relocated
 * under issue #758.
 */

import type {
    EntityId,
    GamePhase,
    GameResult,
    PlayerId,
    SceneId,
    SceneTransitionState,
} from './engine-contract.js';
import type { CommitmentEnvelope, CommitmentId } from './commitment-contract.js';
import type { GameSetupConfig } from './game-lobby-contract.js';

// ─── Rich (renderer/screen-facing) projection ─────────────────────────────────

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
    /**
     * Public agreed lobby setup (host-authored match settings + owner-authored
     * per-player attributes), passed through projection verbatim. Optional and
     * backward-compatible.
     */
    readonly setup?: GameSetupConfig;
    /**
     * Host-minted stable match identity, passed through projection verbatim
     * like `setup` (Invariant #101, F68/#820). Optional and backward-compatible.
     */
    readonly matchId?: string;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
    readonly isMyTurn: boolean;
}

// ─── Loose (wire) projection ──────────────────────────────────────────────────

/**
 * Projected player snapshot that crosses network and IPC boundaries.
 *
 * The authoritative definition lives in simulation/snapshot.ts (future task).
 * For now the canonical shape is declared here, as the networking layer is the
 * primary consumer that sends/receives it over the wire; it re-exports this type
 * as `PlayerSnapshot`. The renderer-facing {@link PlayerSnapshot} above mirrors
 * this shape with richer field types.
 *
 * INVARIANT #1: This is the ONLY snapshot type allowed to cross boundaries.
 * GameSnapshot (the full authoritative state) must never appear here.
 */
export interface WirePlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    /** Opaque per-player state visible to this viewer. */
    readonly players: Readonly<
        Record<string, Readonly<{ id: PlayerId }> & Readonly<Record<string, unknown>>>
    >;
    /** Opaque per-entity state visible to this viewer. */
    readonly entities: Readonly<
        Record<string, Readonly<{ id: string }> & Readonly<Record<string, unknown>>>
    >;
    readonly phase: string;
    readonly sceneId?: SceneId;
    readonly sceneTransition?: SceneTransitionState | null;
    readonly events: readonly Readonly<{ type: string }>[];
    readonly gameResult: GameResult | null;
    /**
     * Per-player commitment state (proposals and envelopes).
     * Optional for backward-compat: older clients may not include this field
     * when sending snapshots. The wire schema (messages-schemas.ts) declares
     * this as `.optional()` to handle old versions gracefully; newer clients
     * guard with `if (snapshot.commitments !== undefined)` before accessing.
     */
    readonly commitments?: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    /**
     * Public agreed lobby setup (host-authored match settings + owner-authored
     * per-player attributes), passed through projection verbatim so every client
     * agrees on the match configuration. Optional for backward-compat: absent on
     * games with no lobby setup and on older clients (Invariant #1 — only public
     * config crosses).
     */
    readonly setup?: GameSetupConfig;
    /**
     * Host-minted stable match identity, passed through projection verbatim
     * like `setup` (Invariant #101, F68/#820). Optional and backward-compatible.
     */
    readonly matchId?: string;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
    readonly isMyTurn: boolean;
}
