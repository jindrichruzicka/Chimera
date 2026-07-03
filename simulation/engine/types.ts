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
import type { TimerRegistry } from './GameTimer.js';
export type { TimerRegistry } from './GameTimer.js';
import type { Logger } from '../foundation/logging.js';
import type { GameSetupConfig } from '../foundation/game-lobby-contract.js';
export type { GameSetupConfig } from '../foundation/game-lobby-contract.js';

// The brand/contract TYPES below now live in the zero-dependency foundation leaf
// `../foundation/engine-contract.js` (issue #758) so the foundation can
// describe its wire/screen contracts without importing up into simulation. They
// are imported for local use (the brand factories cast to them) and re-exported
// so `@chimera-engine/simulation/engine/types.js` stays the unchanged public import path.
import type {
    PlayerId,
    EntityId,
    GamePhase,
    SceneId,
    SceneTransitionPhase,
    SceneTransitionState,
    EngineAction,
    TypedAction,
    ActionEnvelope,
    GameResult,
} from '../foundation/engine-contract.js';
export type {
    PlayerId,
    EntityId,
    GamePhase,
    SceneId,
    SceneTransitionPhase,
    SceneTransitionState,
    EngineAction,
    TypedAction,
    ActionEnvelope,
    GameResult,
};

// ─── Primitive branded identifiers ───────────────────────────────────────────
//
// The branded id types and the scene-transition contract are declared in the
// foundation leaf (re-exported above). The runtime brand factories stay here —
// they are the single authorised cast sites for each brand in simulation/.

/**
 * Constructs a branded {@link PlayerId} from a raw string.
 *
 * This is the single authorised cast site for the PlayerId brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as PlayerId` directly.
 */
export const playerId = (raw: string): PlayerId => raw as PlayerId;

/**
 * Constructs a branded {@link EntityId} from a raw string.
 *
 * This is the single authorised cast site for the EntityId brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as EntityId` directly.
 */
export const entityId = (raw: string): EntityId => raw as EntityId;

/**
 * Constructs a branded {@link GamePhase} from a raw string.
 *
 * This is the single authorised cast site for the GamePhase brand in
 * simulation/. Test helpers and production code must call this instead of
 * writing `raw as GamePhase` directly.
 */
export const gamePhase = (raw: string): GamePhase => raw as GamePhase;

/** Constructs a branded {@link SceneId} from a raw string. */
export const sceneId = (raw: string): SceneId => raw as SceneId;

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

// ─── Game result ────────────────────────────────────────────────────────────
//
// `GameResult` is declared in the foundation leaf `../foundation/engine-contract.js`
// (re-exported above, issue #758). `GameResolution` — the engine-internal
// discriminated union built on it — stays here.

/**
 * Discriminated union that represents the resolution state of a game.
 *
 * - `in_progress` — no winner has been determined yet.
 * - `resolved`    — the game has ended; `result` carries the winner list.
 *
 * Downstream consumers (PlayerSnapshot, GameShell) use this union to
 * distinguish an ongoing game from a decided one without a nullable sentinel.
 *
 * Architecture reference: §4.38
 */
export type GameResolution =
    | { readonly status: 'in_progress' }
    | { readonly status: 'resolved'; readonly result: GameResult };

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
    /**
     * Tick-driven timer registry (§4.20, Invariant #54).
     * All active timers are advanced exactly once per `engine:tick` via
     * `TimerManager.advance()`. Serialised with saves and replayed deterministically.
     * Never undefined; defaults to `{}` when loading saves created before timers
     * were introduced (see SaveMigrator v1→v2).
     */
    readonly timers: TimerRegistry;
    /**
     * The outcome of the game, or `null` when the game is still in progress.
     *
     * Set by the `resolveGameResult` hook in `ActionPipeline` after each
     * `reduce()` step (§4.38). The initial snapshot must always set this to
     * `null`. Downstream tasks (#509–#511) propagate this through
     * `PlayerSnapshot`, `HostSessionPipeline`, and `GameShell`.
     *
     * `winnerIds: []` encodes a draw. `null` means no decision yet.
     *
     * Architecture reference: §4.38 — Game Resolution & Winner Detection
     */
    readonly gameResult: GameResult | null;
    /** Current coarse-grained game scene (§4.18). Optional for pre-F38 fixtures/saves. */
    readonly sceneId?: SceneId;
    /** Default renderer screen key for the current scene, projected from SceneDescriptor (§4.18). Optional for pre-F38 fixtures/saves. */
    readonly sceneDefaultScreen?: string;
    /** Pending two-phase scene transition, or null between transitions (§4.18). */
    readonly sceneTransition?: SceneTransitionState | null;
    /**
     * Public host-authored lobby setup (chosen match settings + per-player
     * attributes) written at `engine:start_game` and carried host-local on the
     * authoritative snapshot. Projected verbatim by `StateProjector.project()`
     * so every client agrees on the match configuration — it holds no owner-only
     * fields (§4.37, Invariant #1). Optional and backward-compatible: absent on
     * pre-#705 fixtures/saves and games with no lobby setup.
     */
    readonly setup?: GameSetupConfig;
    /**
     * Stable identity of the current match (F68, #820). Minted host-side
     * (`crypto.randomUUID()` in `onGameStartRequested`) and carried in the
     * `engine:start_game` payload, so deterministic replay reproduces the same
     * id. Projected verbatim by `StateProjector.project()` like `setup` — this
     * is how clients learn the matchId from their normal snapshot stream
     * (Invariant #101). Preserved by `engine:return_to_lobby` so post-abandon
     * saves still correlate to the match; the next `engine:start_game` mints a
     * fresh one. Optional and backward-compatible: absent on pre-#820
     * fixtures/saves.
     */
    readonly matchId?: string;
    /**
     * Per-player commitment status for the current turn, for turn modes that gate
     * turn advance on every seated player having committed (commit-then-sync;
     * §4.6/§8, F54). Maps a player ID to the `turnNumber` they last committed for;
     * the end-turn guard treats an entry as current only when it equals the
     * snapshot's `turnNumber`, so stale entries from prior turns auto-expire.
     *
     * This is the non-secret "player X has committed for turn N" marker. It is
     * host-local: `StateProjector.project()` uses an explicit field allowlist and
     * does NOT project `committedTurns`, so it never crosses the trust boundary —
     * it is the snapshot-side counterpart that the pure end-turn guard reads,
     * distinct from `PlayerSnapshot.commitments` (the separately-projected envelope
     * hash map peers see). The player's actual buffered actions are NEVER stored
     * here either — they stay host-local in the reveal-staging store (Invariants
     * #3/#8). Integer values only (#42/#44). Absent for games/turn modes that do
     * not use commitments.
     */
    readonly committedTurns?: Readonly<Record<PlayerId, number>>;
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
 * an explicit projection step (Invariants #3/#8). The only authorised cast site
 * in `simulation/` is inside `ActionPipeline` Stage 7.
 *
 * Zero runtime overhead — the brand field exists only in the type system.
 */
export type ViewerSnapshot = Readonly<BaseGameSnapshot> &
    Readonly<Record<string, unknown>> & {
        readonly __chimera_viewer_snapshot: true;
    };

/**
 * Converts a projected per-viewer record to the opaque `ViewerSnapshot` brand.
 *
 * This is the **only** authorised cast site for `ViewerSnapshot` within
 * `simulation/`. Callers must ensure the supplied `projected` value is a
 * properly projected viewer-safe record — not a raw `GameSnapshot`.
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
 * Stage 7 (broadcast) passes the full `BaseGameSnapshot` to the broadcast
 * callback. The callback implementation (e.g., `StateBroadcaster`) is
 * responsible for projecting it via `StateProjector.project()` to produce the
 * per-viewer `PlayerSnapshot` before forwarding to transport (Invariants #3/#8).
 *
 * This separation ensures:
 *   - `ActionPipeline` remains free of projection/visibility logic.
 *   - `StateProjector.project()` is the sole mandatory gate for outbound snapshots.
 *   - `undoMeta` is computed once by the projector, not redundantly in the pipeline.
 *
 * Invariant #12: each pipeline stage receives only the context it needs.
 */
export interface BroadcastContext {
    readonly broadcast?: (snapshot: Readonly<BaseGameSnapshot>, to: PlayerId) => void;
    readonly broadcastTick?: (tick: number, to: PlayerId) => void;
}

/**
 * Narrow context for pipeline stages that emit debug observations.
 *
 * Allows the runtime debug layer (§4.12) to inspect every tick/snapshot pair
 * without the pipeline having a hard dependency on the debug subsystem.
 *
 * Contract: the observer must never throw. The pipeline invokes it unguarded
 * (the exact §4.12 call shape), so a thrown error would abort the in-flight
 * authoritative action — and on the stage-3 undo/redo intercept path also skip
 * the history append. The debug bridge catches all errors inside its observer.
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
//
// `EngineAction`, `TypedAction`, and `ActionEnvelope` are declared in the
// foundation leaf `../foundation/engine-contract.js` (re-exported above, issue
// #758) so the foundation wire/screen contracts can reference the action shape
// without importing up into simulation.

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

// ─── GameReduceContext ────────────────────────────────────────────────────────

/**
 * Public game-facing context handed to `ActionDefinition.validate()` and
 * `ActionDefinition.reduce()`.
 *
 * This interface is the ISP-compliant narrow surface for game code (§4.7,
 * Invariant #12). It intentionally excludes engine-internal fields such as
 * `dispatch`. Adding fields requires a dedicated invariant in
 * docs/executive-architecture/architecture-invariants.md.
 *
 * `rng` — seeded `DeterministicRng` instance derived from `(snapshot.seed, snapshot.tick)`
 *          by `ActionPipeline`. Game code MUST use `ctx.rng.*` for all randomness.
 *
 * `db`  — optional content database. Games that declare no content never receive a `db`.
 *
 * `undoManager` — optional undo eligibility query surface populated by `ActionPipeline`
 *          from `PipelineContext.undoManager` when provided (F16).
 *
 * `dispatchDepth` — re-entrant dispatch nesting depth. Zero for the top-level call;
 *          readable by game code per Invariant #89.
 */
export interface GameReduceContext {
    readonly rng: DeterministicRng;
    readonly db?: ContentDatabase;
    /** Populated from PipelineContext.undoManager by ActionPipeline (F16). */
    readonly undoManager?: {
        canUndo(playerId: PlayerId): boolean;
        canRedo(playerId: PlayerId): boolean;
    };
    /**
     * Optional per-game end-turn guard, populated by `ActionPipeline` from the
     * active game's `GameDefinition.canEndTurn`. `engine:end_turn.validate()`
     * consults it after its generic active-player checks so a game can reject a
     * premature end-turn (e.g. commit-then-sync mode blocking until every seat
     * has committed; §4.6/§8, F54) without the engine knowing the game. Absent
     * for games that register no `canEndTurn`. Adding this field to the
     * ISP-narrow surface is backed by a dedicated invariant (#102), as this
     * interface's contract requires.
     */
    readonly endTurnGuard?: (
        state: Readonly<BaseGameSnapshot>,
        playerId: PlayerId,
    ) => ValidationResult;
    /**
     * Optional per-game end-turn AUTHORIZATION, populated by `ActionPipeline`
     * from the active game's `GameDefinition.mayEndTurn`. When present it
     * REPLACES the engine's built-in active-player check in
     * `engine:end_turn.validate()`: the game decides which seats may end the
     * turn. The simultaneous commit-then-sync mode uses this so any seat may
     * fire the reveal once every seat has committed (the active-player gate
     * would otherwise deadlock a parallel turn; §4.6/§8, F54). Returning `false`
     * rejects with `not_active_player`. Absent ⇒ the engine keeps its default
     * "only `turnClock.activePlayerId` may end the turn" behaviour, so
     * sequential games are unaffected. The `endTurnGuard` (canEndTurn) is still
     * consulted afterwards. Backed by the same ISP-narrow rationale as
     * `endTurnGuard` (Invariant #102).
     */
    readonly endTurnAuthority?: (state: Readonly<BaseGameSnapshot>, playerId: PlayerId) => boolean;
    /**
     * Re-entrant dispatch nesting depth. Zero for the top-level
     * `ActionPipeline.process()` call; incremented by one for each nested
     * `ctx.dispatch()` invocation. Bounded by `MAX_NESTED_DISPATCH` (§4.7,
     * §4.20). Game code may read this value but must never call `ctx.dispatch()`
     * directly (Invariant #89).
     */
    readonly dispatchDepth: number;
}

// ─── ReduceContext ────────────────────────────────────────────────────────────

/**
 * Engine-internal context. Extends `GameReduceContext` with `dispatch?` which
 * is ONLY accessible to `engine:tick` (§4.20, F21). Game code receives
 * `GameReduceContext` via `ActionDefinition.validate/reduce` and cannot reach
 * `dispatch` without a deliberate `isReduceContext()` narrowing call.
 *
 * Use `isReduceContext(ctx)` to narrow a `GameReduceContext` to `ReduceContext`
 * inside engine actions that legitimately need `dispatch`.
 */
export interface ReduceContext extends GameReduceContext {
    readonly dispatch?: (
        state: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ) => BaseGameSnapshot;
    /**
     * Optional structured logger for engine-internal diagnostics (§4.20, F21).
     *
     * Populated by `ActionPipeline` from its injected logger. Used exclusively
     * by the `engine:tick` reducer to emit `warn`-level entries for timer-fired
     * actions that fail validation (non-fatal rejection pattern).
     *
     * Engine-internal — not visible on the public `GameReduceContext` surface.
     * Game reducers cannot reach this field; `engine:tick` (and any future
     * engine-only action) accesses it after narrowing via `isReduceContext()`.
     */
    readonly logger?: Logger;
}

/**
 * Type guard that narrows a `GameReduceContext` to the engine-internal
 * `ReduceContext` when the context carries the `dispatch` field.
 *
 * Only `engine:tick` should call this. Game code must never use `dispatch`.
 */
export const isReduceContext = (ctx: GameReduceContext): ctx is ReduceContext => 'dispatch' in ctx;

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
        ctx: GameReduceContext,
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
        ctx: GameReduceContext,
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
