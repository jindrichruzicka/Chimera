/**
 * simulation/projection/StateProjector.ts
 *
 * StateProjector interface and DefaultStateProjector implementation.
 *
 * `StateProjector.project()` is the mandatory gate between `GameSnapshot` and
 * any outbound message (Invariant #8). `DefaultStateProjector` applies a
 * caller-supplied `VisibilityRules` implementation to:
 *   1. Exclude fog-hidden entities entirely (Invariant #1 / fog-of-war).
 *   2. Mask surviving entities via `VisibilityRules.maskEntity`.
 *   3. Mask each player's state via `VisibilityRules.maskPlayerState`.
 *   4. Filter the tick's events via `VisibilityRules.filterEvents`.
 *
 * Architecture references: §4.6, §8
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime dependencies on React, DOM, or networking.
 *   #3  — GameSnapshot never leaves the host's main process; project() produces the safe PlayerSnapshot.
 *   #8  — StateProjector.project() is the mandatory gate for outbound snapshots.
 *   #43 — No Math.random / Date.now; projection is pure.
 */

import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    GameEvent,
    GamePhase,
    PlayerId,
    UndoMeta,
} from '../engine/types.js';

import type { CommitmentEnvelope, CommitmentId } from './CommitmentScheme.js';
import type { ObservedEntityState, ObservedPlayerState, VisibilityRules } from './types.js';

// ─── PlayerSnapshot ───────────────────────────────────────────────────────────

/**
 * Per-viewer safe snapshot produced by `StateProjector.project()`.
 *
 * This is the only state type that crosses any process or network boundary
 * (Invariant #3). It is structurally distinct from `BaseGameSnapshot`:
 * - Fog-hidden entities are absent (never null).
 * - Player states are masked for non-owners.
 * - Events are filtered to the viewer.
 * - The `seed` field is absent — it is host-internal.
 *
 * Architecture: §4.6
 */
export interface PlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    readonly phase: GamePhase;
    readonly players: Readonly<Record<PlayerId, ObservedPlayerState>>;
    readonly entities: Readonly<Record<EntityId, ObservedEntityState>>;
    readonly events: readonly GameEvent[];
    readonly commitments: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    readonly undoMeta: UndoMeta;
}

export interface StateProjectorOptions<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly getUndoMeta?: (viewerId: PlayerId, fullState: Readonly<TState>) => UndoMeta;
    /**
     * Optional provider of the host's current pending commitments.
     *
     * When supplied, `project()` includes the returned map in
     * `PlayerSnapshot.commitments` so every client snapshot contains
     * the envelopes needed for Phase-2 REVEAL verification (§4.6 / §8,
     * BLOCK-1 fix).  Returns a null-prototype copy from
     * `SessionCommitmentRuntime.capturePendingCommitments()`.
     *
     * When absent the commitments field defaults to an empty null-prototype
     * record (backwards-compatible default, same as the F27 stub).
     */
    readonly getPendingCommitments?: () => Readonly<Record<CommitmentId, CommitmentEnvelope>>;
}

// ─── StateProjector interface ─────────────────────────────────────────────────

/**
 * The mandatory gate between `GameSnapshot` and any outbound message.
 *
 * Implementations apply visibility rules to produce a per-viewer
 * `PlayerSnapshot` that contains only the information the viewer is
 * entitled to see. `StateBroadcaster` must never read a `GameSnapshot`
 * directly (Invariant #8).
 *
 * @template TState — Concrete game snapshot type; defaults to `BaseGameSnapshot`.
 */
export interface StateProjector<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    project(fullState: Readonly<TState>, viewerId: PlayerId): PlayerSnapshot;
}

// ─── DefaultStateProjector ────────────────────────────────────────────────────

/**
 * Generic implementation of `StateProjector` driven by an injected
 * `VisibilityRules` instance.
 *
 * Fog-of-war entities are omitted from the null-prototype projection record,
 * so they are absent from `PlayerSnapshot.entities` — never `null` or a
 * placeholder (Invariant #1, Fog-of-War spec §8).
 *
 * @template TState           — Concrete game snapshot type.
 * @template TEntity          — Concrete entity state type.
 * @template TPlayer          — Concrete player state type.
 * @template TObservedEntity  — Masked entity shape returned by `maskEntity`.
 * @template TObservedPlayer  — Masked player shape returned by `maskPlayerState`.
 */
export class DefaultStateProjector<
    TState extends BaseGameSnapshot = BaseGameSnapshot,
    TEntity extends BaseEntityState = BaseEntityState,
    TPlayer extends BasePlayerState = BasePlayerState,
    TObservedEntity extends Readonly<{ readonly id: TEntity['id'] }> = ObservedEntityState<
        TEntity,
        never
    >,
    TObservedPlayer extends Readonly<{ readonly id: TPlayer['id'] }> = ObservedPlayerState<
        TPlayer,
        never
    >,
> implements StateProjector<TState> {
    readonly #rules: VisibilityRules<TState, TEntity, TPlayer, TObservedEntity, TObservedPlayer>;
    readonly #options: StateProjectorOptions<TState>;

    constructor(
        rules: VisibilityRules<TState, TEntity, TPlayer, TObservedEntity, TObservedPlayer>,
        options: StateProjectorOptions<TState> = {},
    ) {
        this.#rules = rules;
        this.#options = options;
    }

    /**
     * Project the authoritative `fullState` to the viewer's safe snapshot.
     *
     * - Fog-hidden entities are ABSENT (not null) — `isEntityVisible` is the gate.
     * - Surviving entities are passed through `maskEntity`.
     * - All players are included but passed through `maskPlayerState`.
     * - Events are filtered by `filterEvents`.
     */
    project(fullState: Readonly<TState>, viewerId: PlayerId): PlayerSnapshot {
        // ── 1. Filter + mask entities (fog of war) ───────────────────────────
        // The `as` casts here are the single authorised widening site: TState
        // constrains entities/players to base types for generic compatibility,
        // but callers constructing DefaultStateProjector<TState, TEntity, TPlayer>
        // guarantee the concrete types align. Using a named helper below
        // avoids inline `unknown` casts.
        const entities = this.#projectEntities(fullState, viewerId);

        // ── 2. Mask player states ────────────────────────────────────────────
        const players = this.#projectPlayers(fullState, viewerId);

        // ── 3. Filter events ────────────────────────────────────────────────
        const events = this.#rules.filterEvents(fullState.events, viewerId, fullState);
        const undoMeta = this.#options.getUndoMeta?.(viewerId, fullState) ?? {
            canUndo: false,
            canRedo: false,
        };

        const commitments =
            this.#options.getPendingCommitments?.() ??
            (Object.create(null) as Readonly<Record<CommitmentId, CommitmentEnvelope>>);

        return {
            tick: fullState.tick,
            viewerId,
            phase: fullState.phase,
            players,
            entities,
            events,
            commitments,
            undoMeta,
        };
    }

    #projectEntities(
        fullState: Readonly<TState>,
        viewerId: PlayerId,
    ): Readonly<Record<EntityId, ObservedEntityState>> {
        const result = Object.create(null) as Record<string, TObservedEntity>;
        for (const [id, raw] of Object.entries(fullState.entities)) {
            // Authorised widening: TState.entities values are TEntity instances.
            const entity = raw as TEntity;
            if (this.#rules.isEntityVisible(entity, viewerId, fullState)) {
                result[id] = this.#rules.maskEntity(entity, viewerId, fullState);
            }
            // Fog-hidden entities: not added → absent from result (never null).
        }
        return result;
    }

    #projectPlayers(
        fullState: Readonly<TState>,
        viewerId: PlayerId,
    ): Readonly<Record<PlayerId, ObservedPlayerState>> {
        const result = Object.create(null) as Record<string, TObservedPlayer>;
        for (const [id, raw] of Object.entries(fullState.players)) {
            // Authorised widening: TState.players values are TPlayer instances.
            const player = raw as TPlayer;
            result[id] = this.#rules.maskPlayerState(player, viewerId, fullState);
        }
        return result;
    }
}
