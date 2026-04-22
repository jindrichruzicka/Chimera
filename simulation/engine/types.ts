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
 * Opaque entity identifier. Branded to prevent mix-up with PlayerId or
 * other string keys at call sites.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/**
 * Current phase of the game state machine.
 * Games define their own phase strings; the engine treats this as an opaque
 * string. Typed as a branded alias to prevent accidental assignment of
 * arbitrary strings without intent.
 */
export type GamePhase = string & { readonly __brand: 'GamePhase' };

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
     * The player ID of the session host.
     * Required for engine:save and engine:load host-only validation (invariant #25).
     * Optional here because single-player and test fixtures may omit it.
     */
    readonly hostPlayerId?: PlayerId;
}

// ─── PipelineContext ─────────────────────────────────────────────────────────

/**
 * Stub of the orchestrator-level pipeline context (§4.7).
 *
 * The full `PipelineContext` extends `UndoContext`, `HistoryContext`,
 * `BroadcastContext`, and `DebugContext` — those fields land with F15/F16.
 * This stub carries only the fields available now so that `ActionPipeline`
 * can forward `db` into `ReduceContext` per-call (invariant #46).
 *
 * Game code NEVER receives `PipelineContext` directly — it receives the
 * narrower `ReduceContext` from which game-agnostic fields are stripped.
 */
export interface PipelineContext {
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
    TPayload extends Record<string, unknown> = Record<string, unknown>,
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
export type TypedAction<T extends string, P extends Record<string, unknown>> = EngineAction<T, P>;

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
 * change requiring a dedicated Appendix B invariant. Do NOT plumb manager
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
    readonly dispatch?: (
        state: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ) => BaseGameSnapshot;
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
    TPayload extends Record<string, unknown>,
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
