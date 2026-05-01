/**
 * simulation/engine/types.ts
 *
 * Core simulation domain types for the Chimera engine.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code.
 * Every type lives under strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess.
 *
 * Architecture references: §4.2, §4.7
 * Task: F03 / T2 (issue #25)
 *
 * Invariants upheld:
 *   #1 — ActionEnvelope is the exclusive inbound IPC payload for game actions.
 *   #2 — All mutating game logic is driven by actions through the pipeline.
 *   #3 — simulation/ is side-effect-free; no Node.js or Electron imports.
 */

import type { DeterministicRng } from './DeterministicRng.js';
import type { ContentDatabase } from '../content/index.js';
export type { ContentDatabase } from '../content/index.js';

// ─── Primitive branded identifiers ───────────────────────────────────────────

/**
 * Opaque player identifier. Using a branded type prevents accidental mixing
 * with other string-shaped values (e.g. session tokens, entity IDs).
 *
 * Canonical source — supersedes the plain `string` stub in `electron/preload/api-types.ts`.
 */
export type PlayerId = string & { readonly __brand: 'PlayerId' };

/**
 * Constructs a branded {@link PlayerId} from a raw string.
 *
 * This is the single authorised cast site for the PlayerId brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as PlayerId` directly.
 */
export const playerId = (raw: string): PlayerId => raw as PlayerId;

/**
 * Opaque entity identifier. Branded to prevent mix-up with PlayerId or
 * other string keys at call sites.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/**
 * Constructs a branded {@link EntityId} from a raw string.
 *
 * This is the single authorised cast site for the EntityId brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as EntityId` directly.
 */
export const entityId = (raw: string): EntityId => raw as EntityId;

/**
 * Current phase of the game state machine.
 * Games define their own phase strings; the engine treats this as an opaque
 * string. Typed as a branded alias to prevent accidental assignment of
 * arbitrary strings without intent.
 */
export type GamePhase = string & { readonly __brand: 'GamePhase' };

/**
 * Constructs a branded {@link GamePhase} from a raw string.
 *
 * This is the single authorised cast site for the GamePhase brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as GamePhase` directly.
 */
export const gamePhase = (raw: string): GamePhase => raw as GamePhase;

// ─── Base state shapes ───────────────────────────────────────────────────────

/**
 * Minimum shape of a player entry inside `BaseGameSnapshot.players`.
 * Game-specific snapshots extend this with additional fields.
 */
export interface BasePlayerState {
    readonly id: PlayerId;
}

/**
 * Minimum shape of an entity entry inside `BaseGameSnapshot.entities`.
 * Game-specific snapshots extend this with additional fields.
 */
export interface BaseEntityState {
    readonly id: EntityId;
}

/**
 * A game event recorded during a tick. All events are stored unfiltered on
 * `GameSnapshot.events`; `StateProjector` filters them per viewer when
 * producing `PlayerSnapshot.events`.
 */
export interface GameEvent {
    readonly type: string;
}

// ─── Authoritative game state ─────────────────────────────────────────────────

/**
 * Full authoritative game state.
 *
 * INVARIANT #1: GameSnapshot NEVER leaves the main process.
 * Only `PlayerSnapshot` (produced by StateProjector) crosses any boundary.
 *
 * All arithmetic fields are integers (invariant #42/#44). Floats are reserved
 * for the renderer (camera, animation). `seed` is the base RNG seed; the
 * per-action RNG is derived from `(seed, tick)` inside ActionPipeline.
 *
 * `turnClock` is optional — only games that opt into timed turns set it.
 */
export interface BaseGameSnapshot {
    readonly tick: number;
    readonly seed: number;
    readonly players: Record<PlayerId, BasePlayerState>;
    readonly entities: Record<EntityId, BaseEntityState>;
    readonly phase: GamePhase;
    readonly events: readonly GameEvent[];
    readonly turnClock?: { readonly activePlayerId: PlayerId; readonly deadlineMs: number };
    /**
     * Monotonic per-game turn counter. Increments by 1 inside
     * `engine:end_turn.reduce` whenever the active player advances; never
     * decrements. Distinct from `tick`, which advances on every action — for
     * games with multi-action turns `tick` runs faster than `turnNumber`.
     *
     * Used by:
     *   - `ActionHistoryEntry.turnNumber` so each history entry is stamped with
     *     the turn during which it was recorded (Invariants #42/#44 — integer).
     *   - `ActionHistory.pruneTo(snapshot.turnNumber - TURN_MEMENTO_RETENTION)`
     *     so the bounded retention window measures turns, not ticks.
     *
     * Always an integer (Invariants #42/#44). Initial state must set this to
     * 0 explicitly; there is no implicit default.
     */
    readonly turnNumber: number;
    /**
     * The player ID of the session host.
     * Required for engine:save and engine:load host-only validation (invariant #25).
     * Optional here because single-player and test fixtures may omit it.
     */
    readonly hostPlayerId?: PlayerId;
}

// ─── Role-specific sub-context interfaces (§4.7, ISP) ────────────────────────

/**
 * Narrow context for pipeline stages that need undo/redo awareness.
 *
 * Stage 3 (intercept) reads `undoManager` to call `undo()` / `redo()` and
 * to check eligibility via `canUndo` / `canRedo`. The post-Stage-7
 * turn-lifecycle hook reads `clearUndoHistory` (after `engine:end_turn`) and
 * `saveTurnMemento` (for the new active player when `state.turnClock` is
 * configured). Game code receives only `ReduceContext.undoManager` which
 * exposes the narrower query-only surface (`canUndo` / `canRedo`).
 *
 * Invariant #12: each pipeline stage receives only the context it needs.
 */
export interface UndoContext {
    readonly undoManager?: {
        canUndo(playerId: PlayerId): boolean;
        canRedo(playerId: PlayerId): boolean;
        undo(playerId: PlayerId, steps?: number): BaseGameSnapshot;
        redo(playerId: PlayerId, steps?: number): BaseGameSnapshot;
        /**
         * Clears the per-player undo state. Called by the pipeline after a
         * successful `engine:end_turn` reduce to enforce the
         * `crossTurnUndo: false` policy default.
         */
        clearUndoHistory(playerId: PlayerId): void;
        /**
         * Captures a turn-start memento for the supplied state and player.
         * Called by the pipeline after `engine:end_turn` advances
         * `state.turnClock.activePlayerId` so the new active player has a
         * reconstruction baseline. Skipped when `state.turnClock` is absent.
         */
        saveTurnMemento(state: BaseGameSnapshot, playerId: PlayerId): void;
    };
}

/**
 * Narrow context for pipeline stages that append to action history.
 *
 * Stage 6 (record) uses this to append `ActionHistoryEntry`-shaped objects
 * so the history subsystem can reconstruct the action sequence for undo/redo.
 * The post-Stage-7 turn-lifecycle hook uses `pruneTo` (after `engine:end_turn`)
 * to evict entries older than the retention window so the bounded ring of
 * `TURN_MEMENTO_RETENTION` turns is enforced in production without requiring
 * a host wrapper.
 *
 * Invariant #12: each pipeline stage receives only the context it needs.
 */
export interface HistoryContext {
    readonly history?: {
        append(entry: {
            readonly tickApplied: number;
            readonly turnNumber: number;
            readonly action: ActionEnvelope;
        }): void;
        /**
         * Removes all entries whose `turnNumber` is strictly less than
         * `cutoff`. The pipeline supplies
         * `snapshot.tick - TURN_MEMENTO_RETENTION` as the cutoff after a
         * successful `engine:end_turn` reduce.
         */
        pruneTo(cutoff: number): void;
    };
}

/**
 * Opaque branded type for the per-viewer snapshot delivered by Stage 7 of
 * `ActionPipeline.process()` via `BroadcastContext.broadcast`.
 *
 * `GameSnapshot` (or any subtype) must NEVER be assigned to this type without
 * an explicit projection step (Invariant #1). The only authorised cast site in
 * `simulation/` is inside `ActionPipeline` Stage 7, guarded by a TODO(F26)
 * comment. External callers (e.g. `StateBroadcaster`) should import
 * `ViewerSnapshot` and use `toViewerSnapshot` at the wiring point.
 *
 * Zero runtime overhead — the brand field exists only in the type system.
 */
export type ViewerSnapshot = Readonly<Record<string, unknown>> & {
    readonly __chimera_viewer_snapshot: true;
};

/**
 * Converts a projected per-viewer record to the opaque `ViewerSnapshot` brand.
 *
 * This is the **only** authorised cast site for `ViewerSnapshot` within
 * `simulation/`. Callers must ensure the supplied `projected` value is a
 * properly projected viewer-safe record — not a raw `GameSnapshot`. Until
 * `StateProjector` lands in F26, the caller in `ActionPipeline` Stage 7
 * documents the gap with a `TODO(F26)` comment.
 */
export const toViewerSnapshot = (projected: Readonly<Record<string, unknown>>): ViewerSnapshot =>
    projected as ViewerSnapshot;

/**
 * Per-viewer undo/redo eligibility injected into every broadcast snapshot.
 *
 * Architecture: §4.5, §7 — canUndo / canRedo propagation (issue #361).
 * Derived at Stage 7 broadcast time from `UndoManager.canUndo(viewerId)` /
 * `canRedo(viewerId)`. Defaults to `false` for both fields when `undoManager`
 * is absent from `PipelineContext`.
 *
 * Invariant #7: `undoMeta` is derived at broadcast time — it is NOT stored
 * on `GameSnapshot`.
 */
export interface UndoMeta {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

/**
 * Narrow context for pipeline stages that broadcast state to players.
 *
 * Typed as opaque `ViewerSnapshot` until `PlayerSnapshot` is formalised in
 * F26. Stage 7 (broadcast) uses this to push per-player views without
 * depending on the renderer's snapshot shape.
 *
 * INVARIANT #1: `GameSnapshot` must NEVER be passed directly as a
 * `ViewerSnapshot`. The wiring point is responsible for applying a
 * `StateProjector` before calling broadcast. Use `toViewerSnapshot` only at
 * the authorised cast site inside `ActionPipeline` Stage 7, with a
 * `TODO(F26)` marker.
 *
 * Invariant #12: each pipeline stage receives only the context it needs.
 */
export interface BroadcastContext {
    /** Opaque until PlayerSnapshot is formalised in F26. */
    readonly broadcast?: (snapshot: ViewerSnapshot, to: PlayerId) => void;
}

/**
 * Narrow context for pipeline stages that emit debug observations.
 *
 * Allows the runtime debug layer (§4.26) to inspect every tick/snapshot pair
 * without the pipeline having a hard dependency on the debug subsystem.
 *
 * Invariant #12: each pipeline stage receives only the context it needs.
 */
export interface DebugContext {
    readonly debugObserver?: (tick: number, snapshot: Readonly<BaseGameSnapshot>) => void;
}

// ─── PipelineContext ─────────────────────────────────────────────────────────

/**
 * Orchestrator-level pipeline context (§4.7).
 *
 * Extends all four role-specific sub-contexts (`UndoContext`, `HistoryContext`,
 * `BroadcastContext`, `DebugContext`) satisfying the Interface Segregation
 * contract: each pipeline stage receives the narrowest context it needs.
 *
 * Game code NEVER receives `PipelineContext` directly — it receives the
 * narrower `ReduceContext` from which game-agnostic fields are stripped.
 *
 * Invariant #12: `ActionPipeline` steps — each stage receives only the narrow
 * context it needs.
 * Invariant #2: `applyAction`/`definition.reduce` are pure — game code always
 * receives `ReduceContext`, never `PipelineContext`.
 */
export interface PipelineContext
    extends UndoContext, HistoryContext, BroadcastContext, DebugContext {
    /** Optional content database; absent for games that declare no content. */
    readonly db?: ContentDatabase;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Generic action envelope. The ONLY shape the engine transport layer
 * operates on. Games create typed sub-forms via `TypedAction<T, P>`.
 *
 * `TType`    — namespaced type string, e.g. `'engine:end_turn'`, `'mygame:move_unit'`
 * `TPayload` — strongly-typed payload; unknown/unvalidated on the wire until
 *              `ActionDefinition.parsePayload()` runs inside ActionPipeline Stage 2.
 *
 * INVARIANT: `tick` must match `GameSnapshot.tick` at pipeline entry; Stage 1
 * (resolve) rejects stale envelopes before any game logic runs.
 */
export interface EngineAction<
    TType extends string = string,
    TPayload extends object = Record<string, unknown>,
> {
    readonly type: TType;
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

/**
 * Convenience type alias for game developers building typed action factories.
 *
 * Usage:
 *   type MoveUnitAction = TypedAction<'mygame:move_unit', MoveUnitPayload>;
 */
export type TypedAction<T extends string, P extends object> = EngineAction<T, P>;

/**
 * The exclusive inbound representation at the transport boundary — opaque form
 * of `EngineAction` with default loose type parameters. ActionPipeline receives
 * only `ActionEnvelope`s; stage 2 (parse) produces the typed payload for game code.
 *
 * INVARIANT #1: No raw `{ type, payload }` objects may enter the pipeline —
 * callers must build an `ActionEnvelope` (including `playerId` and `tick`).
 */
export type ActionEnvelope = EngineAction<string, Record<string, unknown>>;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Return value of `ActionDefinition.validate()`.
 *
 * `ok: true` — action is legal.
 * `ok: false` — action is illegal; `reason` is a stable snake_case code (never
 *               a human-readable string) so it can be used as an i18n key.
 */
export interface ValidationResult {
    readonly ok: boolean;
    readonly reason?: string;
}

// ─── ReduceContext ────────────────────────────────────────────────────────────

/**
 * Narrow context handed to `ActionDefinition.validate()` and
 * `ActionDefinition.reduce()`.
 *
 * This interface is INTENTIONALLY minimal. Adding fields is an architectural
 * change requiring a dedicated invariant in docs/executive-architecture/architecture-invariants.md. Do NOT plumb manager
 * references, loggers, wall-clock time, or network state through here.
 *
 * `rng` — seeded `DeterministicRng` instance derived from `(snapshot.seed, snapshot.tick)`
 *          by `ActionPipeline.#buildReduceContext`. Game code MUST use `ctx.rng.*` for all
 *          randomness; `Math.random()` is blocked by the `chimera/no-restricted-globals`
 *          ESLint rule (F04).
 *
 * `db`  — optional content database placeholder until F05 wires `ContentDatabase`.
 *          Games that declare no content never receive a `db`.
 *
 * `undoManager` — optional undo eligibility query surface, populated by
 *          `ActionPipeline` from `PipelineContext.undoManager` when provided (F16).
 *          Absent until F16 lands. `engine:undo` / `engine:redo` validate() check
 *          it to surface pre-emptive rejection consistent with the
 *          `ActionUnauthorizedError` path used by `engine:end_turn` and `engine:save`.
 *
 * `dispatch` — optional re-entrant dispatch function. ONLY `engine:tick` may call
 *              this (§4.20, F21) to fire timer-triggered sub-actions from inside a
 *              reducer. Game reducers MUST NOT call it. The pipeline bounds nesting
 *              depth to `MAX_NESTED_DISPATCH = 16`; exceeding it throws
 *              `RecursiveDispatchError`. Absent until `ActionPipeline` provides it
 *              at Stage 5 (F03/T5).
 */
export interface ReduceContext {
    readonly rng: DeterministicRng;
    readonly db?: ContentDatabase;
    /** Populated from PipelineContext.undoManager by ActionPipeline (F16). */
    readonly undoManager?: {
        canUndo(playerId: PlayerId): boolean;
        canRedo(playerId: PlayerId): boolean;
    };
    readonly dispatch?: (
        state: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ) => BaseGameSnapshot;
    /**
     * Re-entrant dispatch nesting depth. Zero for the top-level
     * `ActionPipeline.process()` call; incremented by one for each nested
     * `ctx.dispatch()` invocation. Bounded by `MAX_NESTED_DISPATCH` (§4.7,
     * §4.20). Only `engine:tick` may call `ctx.dispatch()`.
     *
     * NOTE: This value reflects the depth at the entry of the current `process()`
     * invocation. Within a reducer frame, after a nested `dispatch()` returns,
     * this field may appear stale mid-execution (the depth guard itself is always
     * enforced correctly inside `#dispatchFn`). Game code should read
     * `ctx.dispatchDepth` only at the start of the reducer, not after calling
     * `ctx.dispatch()` from within the same frame.
     */
    readonly dispatchDepth: number;
}

// ─── ActionDefinition ─────────────────────────────────────────────────────────

/**
 * Strategy per action type. Games supply these to `ActionRegistry.register()`.
 *
 * The engine declares the calling contract; game code provides the
 * implementations. Engine core has ZERO switch statements on action type strings.
 *
 * `TPayload` — the validated payload type produced by `parsePayload`.
 * `TState`   — the game snapshot type this definition operates on;
 *              defaults to `BaseGameSnapshot`.
 */
export interface ActionDefinition<
    TPayload extends object,
    TState extends BaseGameSnapshot = BaseGameSnapshot,
> {
    readonly type: string;

    /**
     * Stage 2 — structural validation (schema check).
     * Called with the raw unknown wire payload before any game logic.
     * MUST throw `ActionSchemaError` on failure; never return a partial result.
     */
    parsePayload(raw: Readonly<Record<string, unknown>>): TPayload;

    /**
     * Stage 4 — semantic validation.
     * Is this action legal given the current snapshot and the acting player?
     * MUST be pure: no side effects, no mutation, no network calls.
     */
    validate(
        payload: TPayload,
        state: Readonly<TState>,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): ValidationResult;

    /**
     * Stage 5 — pure state transition.
     * Same input always produces the same output given the same context.
     * MUST NOT mutate `state`. Return a new object (spread or structural copy).
     */
    reduce(
        state: Readonly<TState>,
        payload: TPayload,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): TState;

    /**
     * Whether clients may tentatively apply this action before host confirmation.
     * Default: `false`. Only set `true` for own-player-only, non-randomised,
     * non-contested actions (§4.2, §6).
     */
    readonly predictable?: boolean;
}

// ─── Role marker interfaces ───────────────────────────────────────────────────

/**
 * Marker for objects that execute in the simulation host role (main process,
 * authoritative state). Tagged with a literal `role` discriminant so host/client
 * code paths are distinguishable at both the type level and runtime.
 */
export interface SimulationHostRole {
    readonly role: 'host';
}

/**
 * Marker for objects that execute in the simulation client role (renderer or
 * remote peer). Tagged with a literal `role` discriminant. Clients work only
 * on `PlayerSnapshot`; they never hold `BaseGameSnapshot`.
 */
export interface SimulationClientRole {
    readonly role: 'client';
}
