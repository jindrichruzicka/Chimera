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
    GameResult,
    GameSetupConfig,
    PlayerId,
    SceneId,
    SceneTransitionState,
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
 * - `isMyTurn` is a derived boolean indicating if the viewer may act this turn.
 *   By default `turnClock?.activePlayerId === viewerId` (or `true` if no turnClock);
 *   a simultaneous-turn game may override this via `StateProjectorOptions.resolveIsMyTurn`.
 *
 * Architecture: §4.6
 */
export interface PlayerSnapshot {
    readonly tick: number;
    readonly viewerId: PlayerId;
    readonly phase: GamePhase;
    readonly sceneId?: SceneId;
    readonly sceneDefaultScreen?: string;
    readonly sceneTransition?: SceneTransitionState | null;
    readonly players: Readonly<Record<PlayerId, ObservedPlayerState>>;
    readonly entities: Readonly<Record<EntityId, ObservedEntityState>>;
    readonly events: readonly GameEvent[];
    readonly gameResult: GameResult | null;
    readonly commitments: Readonly<Record<CommitmentId, CommitmentEnvelope>>;
    readonly undoMeta: UndoMeta;
    readonly isMyTurn: boolean;
    /**
     * Public host-authored lobby setup, passed through projection verbatim so
     * every client agrees on the match configuration. Holds only public host
     * config — no owner-only fields cross (Invariant #1). Optional: absent on
     * games with no lobby setup and on snapshots predating #705.
     */
    readonly setup?: GameSetupConfig;
    /**
     * Host-minted stable match identity, passed through projection verbatim
     * like `setup` so every viewer sees the identical id (Invariant #101,
     * F68/#820). Optional: absent before the first `engine:start_game` and on
     * snapshots predating #820.
     */
    readonly matchId?: string;
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
    /**
     * Optional override for the `isMyTurn` derivation.
     *
     * The default derivation marks the single `turnClock.activePlayerId` as
     * active (or every viewer when there is no turnClock). Simultaneous-turn
     * modes — e.g. tactics commitment-scheme battle mode, where every seated,
     * not-yet-committed player acts in parallel — supply this to make more than
     * one viewer active at once. The override owns the decision entirely; it
     * runs host-side with the full state, so it may read host-local fields the
     * projection does not cross (e.g. `committedTurns`). It must stay pure and
     * deterministic (Invariant #43). The hosting game contributes it; the
     * projector itself names no game (Invariant #2).
     *
     * When absent, `isMyTurn` falls back to the turn-clock derivation unchanged.
     */
    readonly resolveIsMyTurn?: (fullState: Readonly<TState>, viewerId: PlayerId) => boolean;
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
     * - `isMyTurn` is derived as `turnClock?.activePlayerId === viewerId` (true if no turnClock).
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

        // ── 4. Compute isMyTurn ──────────────────────────────────────────────
        // Default: the single active seat (or everyone when there is no
        // turnClock). A simultaneous-turn game overrides this via
        // `resolveIsMyTurn` so multiple seats can be active at once (#730, F54).
        const isMyTurn =
            this.#options.resolveIsMyTurn?.(fullState, viewerId) ??
            (fullState.turnClock === undefined || fullState.turnClock.activePlayerId === viewerId);

        return {
            tick: fullState.tick,
            viewerId,
            phase: fullState.phase,
            ...(fullState.sceneId === undefined ? {} : { sceneId: fullState.sceneId }),
            ...(fullState.sceneDefaultScreen === undefined
                ? {}
                : { sceneDefaultScreen: fullState.sceneDefaultScreen }),
            ...(fullState.sceneTransition === undefined
                ? {}
                : { sceneTransition: fullState.sceneTransition }),
            ...(fullState.setup === undefined ? {} : { setup: fullState.setup }),
            ...(fullState.matchId === undefined ? {} : { matchId: fullState.matchId }),
            players,
            entities,
            events,
            gameResult: fullState.gameResult,
            commitments,
            undoMeta,
            isMyTurn,
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
