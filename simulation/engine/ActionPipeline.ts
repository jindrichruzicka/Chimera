/**
 * simulation/engine/ActionPipeline.ts
 *
 * `ActionPipeline` — invariant 7-stage pipeline that is the SOLE mutation point
 * for all game state changes. No game action may bypass it.
 *
 * `StateReducer` and `ActionSchemaError` are defined in `./StateReducer.ts` and
 * re-exported here for backward compatibility.
 *
 * Architecture reference: §4.7
 * Task: F03 / T5 (issue #28)
 *
 * Invariants upheld:
 *   #1  — ActionPipeline is the sole mutation point; no raw action object bypasses it.
 *   #2  — Stage order is immutable; no hooks can reorder or skip stages.
 *   #3  — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #43 — validate() and reduce() use only ReduceContext. No Math.random() or Date.now().
 */

import type { Logger } from '@chimera/shared/logging.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PipelineContext,
    PlayerId,
    ReduceContext,
} from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';
import { createRng } from './DeterministicRng.js';
import { gamePhase } from './types.js';
import { StateReducer } from './StateReducer.js';
import { TURN_MEMENTO_RETENTION } from './UndoManager.js';
import { MAX_NESTED_DISPATCH, RecursiveDispatchError } from './RecursiveDispatchError.js';
export { ActionSchemaError, StateReducer } from './StateReducer.js';
export { MAX_NESTED_DISPATCH, RecursiveDispatchError } from './RecursiveDispatchError.js';

// ─── Error classes ────────────────────────────────────────────────────────────

/**
 * Thrown by `ActionPipeline.process()` at Stage 1 when the tick number
 * carried by an `ActionEnvelope` does not match the current
 * `BaseGameSnapshot.tick`.
 *
 * Stale envelopes are a normal network condition (clock drift, late arrival)
 * and MUST be rejected before any game logic runs so the authoritative state
 * never diverges.
 */
export class StaleActionError extends Error {
    readonly code = 'STALE_ACTION' as const;
    readonly actionTick: number;
    readonly snapshotTick: number;

    constructor(actionTick: number, snapshotTick: number) {
        super(
            `StaleActionError: action.tick (${actionTick}) does not match snapshot.tick ` +
                `(${snapshotTick}). Reject and discard the envelope.`,
        );
        this.name = 'StaleActionError';
        this.actionTick = actionTick;
        this.snapshotTick = snapshotTick;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by `ActionPipeline.process()` at Stage 4 when
 * `ActionDefinition.validate()` returns `{ ok: false }`.
 *
 * The `reason` field is the stable snake_case code from `ValidationResult`.
 * Use it as an i18n key for REJECT messages broadcast to clients.
 */
export class ActionUnauthorizedError extends Error {
    readonly code = 'ACTION_UNAUTHORIZED' as const;
    readonly type: string;
    readonly reason: string | undefined;

    constructor(type: string, reason?: string) {
        super(
            `ActionUnauthorizedError: action "${type}" was rejected by validate(). ` +
                `Reason: ${reason ?? 'unspecified'}.`,
        );
        this.name = 'ActionUnauthorizedError';
        this.type = type;
        this.reason = reason;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by the `ctx.dispatch` stub injected into `ReduceContext` when an
 * action type other than `'engine:tick'` attempts to call `ctx.dispatch()`.
 *
 * Only `engine:tick` may trigger re-entrant dispatch (§4.20, F21, Invariant #89).
 * Game reducers that call `ctx.dispatch` are violating the ISP contract and
 * will receive this error immediately — before any recursive pipeline call.
 */
export class ForbiddenDispatchError extends Error {
    readonly code = 'FORBIDDEN_DISPATCH' as const;
    readonly actionType: string;

    constructor(actionType: string) {
        super(
            `ForbiddenDispatchError: action "${actionType}" called ctx.dispatch(), ` +
                `but only "engine:tick" may use ctx.dispatch (§4.20, Invariant #89). ` +
                `Game reducers must not call ctx.dispatch directly.`,
        );
        this.name = 'ForbiddenDispatchError';
        this.actionType = actionType;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Internal mutable twin of `ReduceContext`.
 *
 * Strips `readonly` from every field so `#ctx.rng` can be re-assigned before
 * each `process()` invocation without allocating a new object. All other fields
 * (`db`, `undoManager`, `dispatch`) are set once at construction and never change.
 *
 * IMPORTANT: `#ctx` is an internal implementation detail and MUST NEVER escape
 * the `process()` stack frame. It is cast to `ReduceContext` (the readonly public
 * interface) when passed to `ActionDefinition.validate()` and `reduce()`.
 */
type MutableReduceContext = { -readonly [K in keyof ReduceContext]: ReduceContext[K] };

/**
 * Invariant 7-stage pipeline that is the sole authoritative mutation point for
 * all game state. Every `ActionEnvelope` must travel through all 7 stages in
 * fixed sequential order. No stage may be skipped or reordered.
 *
 * Stage order (immutable — invariant #2):
 *   1. Tick validation     — envelope.tick must equal snapshot.tick; throws StaleActionError.
 *   2. Schema validation   — def.parsePayload(); throws ActionSchemaError.
 *   3. Undo/redo intercept — engine:undo/redo are short-circuited via UndoManager (F16).
 *   4. Authorization       — def.validate(); throws ActionUnauthorizedError.
 *   5. Reduce              — def.reduce() via StateReducer; produces nextState.
 *   6. History record      — appends ActionEnvelope to HistoryContext (F16).
 *   7. Snapshot broadcast  — fires only when nextState !== snapshot (F26).
 *
 * Between stages 5 and 7 the optional `context.debugObserver` is invoked with
 * the post-reduce state (§4.12, Invariant #31) — undefined in production. The
 * Stage-3 undo/redo intercept fires it likewise with the reconstructed state.
 *
 * Constructor:
 *   `new ActionPipeline(registry, { logger?, context? })`
 *   `context` is an optional `PipelineContext` carrying all role-specific
 *   sub-contexts (db, undoManager, broadcast, debugObserver, history).
 *   Stages destructure only the narrow sub-context they need.
 *   The `logger` is optional and defaults to a noop. Pass any `Logger` from
 *   `shared/logging.ts` — the pipeline never creates its own logger.
 */
export class ActionPipeline<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #registry: ActionRegistry<TState>;
    readonly #logger: Logger;
    readonly #context: PipelineContext | undefined;
    readonly #gameId: string | undefined;
    /**
     * Tracks current re-entrant dispatch depth. Starts at 0 (top-level call);
     * incremented by the dispatch closure before each nested process() call and
     * decremented in the `finally` block. Synchronous-only — simulation has no
     * async reducers.
     */
    #depth = 0;
    /**
     * Re-entrant dispatch function hoisted to a private field so the same
     * closure is reused across every `process()` call (issue #36).
     *
     * Only `engine:tick` (F21 timers) may call this. Game reducers must NOT.
     */
    readonly #dispatchFn: NonNullable<ReduceContext['dispatch']>;
    /**
     * Forbidden dispatch stub injected into `ctx.dispatch` for every action
     * type other than `'engine:tick'` (issue #35, Invariant #89).
     *
     * Throws `ForbiddenDispatchError` immediately when called, providing a
     * developer-friendly message that identifies the offending action type.
     * The action type is captured per-call via `#currentActionType`.
     */
    readonly #forbiddenDispatchFn: NonNullable<ReduceContext['dispatch']>;
    /** Tracks the action type currently being processed, used by `#forbiddenDispatchFn`. */
    #currentActionType = '';
    /**
     * Mutable singleton context handed to `validate()` and `reduce()`.
     *
     * `rng` and `dispatchDepth` are updated per call — `rng` is re-seeded from
     * `snapshot.seed` and `snapshot.tick`; `dispatchDepth` mirrors `#depth` so
     * reducers can inspect the current nesting level. All other fields are
     * constant after construction.
     *
     * IMPORTANT: This object MUST NEVER escape the `process()` stack frame.
     */
    readonly #ctx: MutableReduceContext;

    constructor(
        registry: ActionRegistry<TState>,
        options?: { logger?: Logger; context?: PipelineContext; gameId?: string },
    ) {
        this.#registry = registry;
        this.#logger = options?.logger ?? NOOP_LOGGER;
        this.#context = options?.context;
        this.#gameId = options?.gameId;

        // Hoist the dispatch closure once — same body as before, rooted on the
        // instance so #depth tracking works correctly for re-entrant calls.
        // Save/restore #ctx.dispatch and #currentActionType around the nested
        // process() call so the outer context's dispatch is not clobbered when
        // a fired game action's process() sets #ctx.dispatch = forbiddenStub
        // (issue #35 — #ctx is a shared mutable singleton).
        this.#dispatchFn = (dispatchState, dispatchAction) => {
            if (this.#depth >= MAX_NESTED_DISPATCH) {
                throw new RecursiveDispatchError(this.#depth);
            }
            this.#depth++;
            // Save the current dispatch and action type so nested process() calls
            // (which overwrite #ctx.dispatch for the nested action) do not clobber
            // the outer engine:tick context (issue #35 — #ctx is a shared singleton).
            // Fallback to #forbiddenDispatchFn (always non-null) satisfies the
            // exactOptionalPropertyTypes constraint on #ctx.dispatch.
            const savedDispatch = this.#ctx.dispatch ?? this.#forbiddenDispatchFn;
            const savedActionType = this.#currentActionType;
            try {
                // Cast invariant (WARN-2): `dispatch` is only invoked by
                // `engine:tick` reducers, which receive the accumulating state
                // from a prior `process()` call on a `TState` snapshot. The
                // `ReduceContext.dispatch` signature uses the wider
                // `BaseGameSnapshot` to stay generic, but the concrete value
                // passed here is always a `TState` — the pipeline is the sole
                // producer of state through `def.reduce()`. If `UndoManager` is
                // ever parameterised as `UndoManager<TState>`, this cast can be
                // removed.
                return this.process(dispatchState as Readonly<TState>, dispatchAction);
            } finally {
                this.#depth--;
                this.#ctx.dispatch = savedDispatch;
                this.#currentActionType = savedActionType;
            }
        };

        // Forbidden stub — throws ForbiddenDispatchError for any non-engine:tick action.
        // Captures the current action type at throw time via #currentActionType.
        this.#forbiddenDispatchFn = () => {
            throw new ForbiddenDispatchError(this.#currentActionType);
        };

        // Build the reusable context object. `rng` and `dispatchDepth` are
        // placeholders — both are updated at the start of every `process()` call
        // before any validate/reduce invocation reads them.
        // `dispatch` defaults to the forbidden stub; `process()` will replace it
        // with `#dispatchFn` when the action type is 'engine:tick'.
        // The active game's optional end-turn guard (e.g. commit-then-sync turn
        // modes). Resolved once — gameId and the registry are fixed for the
        // pipeline's lifetime — and exposed on the public context so
        // `engine:end_turn.validate()` can consult it without the engine knowing
        // any specific game.
        const resolvedGame =
            this.#gameId !== undefined ? this.#registry.resolveGame(this.#gameId) : undefined;
        const canEndTurn = resolvedGame?.canEndTurn;
        const mayEndTurn = resolvedGame?.mayEndTurn;

        this.#ctx = {
            rng: createRng(0, 0),
            dispatchDepth: 0,
            dispatch: this.#forbiddenDispatchFn,
            logger: this.#logger,
            ...(this.#context?.db !== undefined ? { db: this.#context.db } : {}),
            ...(this.#context?.undoManager !== undefined
                ? { undoManager: this.#context.undoManager }
                : {}),
            ...(canEndTurn !== undefined
                ? {
                      endTurnGuard: (state: Readonly<BaseGameSnapshot>, playerId: PlayerId) =>
                          canEndTurn(state as TState, playerId),
                  }
                : {}),
            ...(mayEndTurn !== undefined
                ? {
                      endTurnAuthority: (state: Readonly<BaseGameSnapshot>, playerId: PlayerId) =>
                          mayEndTurn(state as TState, playerId),
                  }
                : {}),
        };
    }

    /**
     * Execute all 7 pipeline stages for the given `action` against the current
     * `snapshot`, returning the next authoritative state.
     *
     * Throws:
     *   - `StaleActionError`         — Stage 1: tick mismatch.
     *   - `UnknownActionTypeError`   — Stage 1: type not registered.
     *   - `ActionSchemaError`        — Stage 2: parsePayload threw.
     *   - `ActionUnauthorizedError`  — Stage 4: validate returned { ok: false }.
     *   - `RecursiveDispatchError`   — re-entrant dispatch exceeded MAX_NESTED_DISPATCH.
     */
    process(snapshot: Readonly<TState>, action: ActionEnvelope): TState {
        // ── Stage 1 — tick validation + resolve ────────────────────────────
        if (action.tick !== snapshot.tick) {
            throw new StaleActionError(action.tick, snapshot.tick);
        }

        // resolve() throws UnknownActionTypeError if the type is not registered.
        const def = this.#registry.resolve(action.type);

        // ── Stage 2 — schema validation (parse) ────────────────────────────
        const parsedPayload = StateReducer.parsePayloadOrThrow(
            action.type,
            (payload) => def.parsePayload(payload),
            action.payload,
        );

        // ── Terminal-match gate ───────────────────────────────────────────
        // Once a game result is recorded the authoritative match is finished.
        // Reject gameplay, turn, tick, undo, and redo actions before the
        // undo/redo intercept can reconstruct prior state. Read-only sync
        // requests remain allowed so reconnecting clients can receive the
        // terminal snapshot.
        if (snapshot.gameResult !== null && !isAllowedAfterGameResult(action.type)) {
            throw new ActionUnauthorizedError(action.type, MATCH_ALREADY_RESOLVED_REASON);
        }

        // ── Stage 3 — undo/redo intercept ────────────────────────────────────
        // When the action is engine:undo or engine:redo and an UndoManager is
        // present, Stage 3 short-circuits Stages 4–5. The reconstructed state is
        // returned directly after recording in history (Stage 6 equivalent) and
        // broadcasting to viewers (Stage 7).
        //
        // When undoManager is absent, the action falls through to Stage 4 and
        // is handled as a normal EngineAction (Invariant #7).
        if (
            (action.type === 'engine:undo' || action.type === 'engine:redo') &&
            this.#context?.undoManager !== undefined
        ) {
            const undoRedoPayload = parsedPayload as { readonly steps: number };
            const { steps } = undoRedoPayload;
            const undoManager = this.#context.undoManager;

            const reconstructed: BaseGameSnapshot =
                action.type === 'engine:undo'
                    ? undoManager.undo(action.playerId, steps)
                    : undoManager.redo(action.playerId, steps);
            const resolvedReconstructed = this.#resolveGameResult(reconstructed as TState);

            // Debug observer hook (§4.12) — fires on the intercept path too, so
            // a live Inspector sees undo/redo transitions and the ring buffer
            // replaces any stale entry held for the reconstructed tick.
            this.#context.debugObserver?.(resolvedReconstructed.tick, resolvedReconstructed);

            // Stage 6 equivalent — record undo/redo in history so it appears in replay.
            this.#context.history?.append({
                tickApplied: snapshot.tick,
                turnNumber: snapshot.turnNumber,
                action,
            });

            // Stage 7 — broadcast reconstructed snapshot to all viewers.
            // The broadcast callback receives the full BaseGameSnapshot.
            // Implementations (e.g., StateBroadcaster) must project it via
            // StateProjector.project() to produce the per-viewer PlayerSnapshot
            // before forwarding to transport (Invariants #3/#8).
            if (resolvedReconstructed !== snapshot) {
                for (const pid of Object.keys(resolvedReconstructed.players)) {
                    const viewerId = pid as PlayerId;
                    this.#context.broadcast?.(resolvedReconstructed, viewerId);
                }
            }

            // Cast invariant (WARN-2): `UndoManager.undo/redo()` returns
            // `BaseGameSnapshot` because the interface is non-generic. The
            // concrete value is always a `TState` because every memento stored
            // by `saveTurnMemento()` (called after `engine:end_turn`) was itself
            // produced by `process()` on a `TState` snapshot — the pipeline is
            // the sole mutation point for game state. If `UndoManager` is ever
            // parameterised as `UndoManager<TState>`, this cast can be removed.
            return resolvedReconstructed;
        }

        // ── Stage 4 — authorization (validate) ────────────────────────────
        // Re-seed the shared context for this invocation. `#ctx` is reused
        // across calls (issue #36) — `rng` varies per (seed, tick) pair and
        // `dispatchDepth` mirrors the current re-entrant depth so reducers can
        // inspect it. `dispatch` is gated to 'engine:tick' only (issue #35,
        // Invariant #89) — all other action types receive the forbidden stub.
        // IMPORTANT: #ctx must never escape this stack frame.
        this.#ctx.rng = createRng(snapshot.seed, snapshot.tick);
        this.#ctx.dispatchDepth = this.#depth;
        this.#currentActionType = action.type;
        this.#ctx.dispatch =
            action.type === 'engine:tick' ? this.#dispatchFn : this.#forbiddenDispatchFn;
        const ctx: ReduceContext = this.#ctx;

        const result = def.validate(parsedPayload, snapshot, action.playerId, ctx);
        if (!result.ok) {
            throw new ActionUnauthorizedError(action.type, result.reason);
        }

        // ── Stage 5 — reduce ──────────────────────────────────────────────
        const reducedState = def.reduce(snapshot, parsedPayload, action.playerId, ctx);
        const nextState = this.#resolveGameResult(reducedState);

        this.#logger.debug('action reduced', {
            type: action.type,
            playerId: action.playerId,
            tick: action.tick,
        });

        // ── Debug observer hook (§4.12, Invariant #31) ─────────────────────
        // The single simulation-side debug coupling: pushes the post-reduce
        // state to the Runtime Debug Layer (SnapshotRingBuffer) between
        // stage 5 (reduce) and stage 7 (broadcast). `debugObserver` is
        // undefined in production — the optional chain is the entire cost.
        this.#context?.debugObserver?.(nextState.tick, nextState);

        // ── Stage 6 — history record ────────────────────────────────────────
        // Append the action envelope to the history so the undo/redo subsystem
        // can reconstruct the action sequence for a turn. turnNumber is the
        // dedicated turn counter on BaseGameSnapshot — it advances only on
        // engine:end_turn while tick advances on every reduce.
        //
        // Skipped for nested dispatches (this.#depth > 0): ActionHistory records
        // only the outer engine:tick frame. Replays re-derive timer fires from
        // TimerRegistry state (§4.20, Invariant #55).
        if (this.#depth === 0) {
            this.#context?.history?.append({
                tickApplied: snapshot.tick,
                turnNumber: snapshot.turnNumber,
                action,
            });
        }

        // ── Pre-broadcast turn-lifecycle hook ──────────────────────────────
        // After a successful `engine:end_turn` reduce we must:
        //   1. Clear the prior active player's undo history so the
        //      `crossTurnUndo: false` policy default holds in production.
        //   2. Record a turn memento for the NEW active player so the next
        //      turn has a baseline to undo back to (host wiring — WARN-1).
        //   3. Prune the bounded action history to `TURN_MEMENTO_RETENTION`
        //      turns of retention so memory stays bounded under long sessions.
        // This runs before Stage 7 so projected `undoMeta` reflects the current
        // turn boundary and never leaks stale undo/redo eligibility to the UI.
        if (action.type === 'engine:end_turn') {
            this.#context?.undoManager?.clearUndoHistory(action.playerId);

            // Save a memento for the new active player whenever turnClock
            // advanced (i.e. the action actually changed state). Games that
            // do not configure `turnClock` opt out of memento bookkeeping.
            if (nextState !== snapshot && nextState.turnClock !== undefined) {
                this.#context?.undoManager?.saveTurnMemento(
                    nextState,
                    nextState.turnClock.activePlayerId,
                );
            }

            // Prune action history regardless of turnClock presence —
            // history is a per-tick log and the bound applies uniformly.
            // Cutoff uses the post-reduce turnNumber so the new turn boundary
            // is reflected before pruning.
            //
            // Note: for games without a turnClock the engine:end_turn reducer
            // returns the input reference unchanged (early return), so
            // nextState.turnNumber === snapshot.turnNumber and the cutoff is
            // identical to the previous call — pruneTo is idempotent in that
            // case and no entries are incorrectly evicted.
            this.#context?.history?.pruneTo(nextState.turnNumber - TURN_MEMENTO_RETENTION);
        }

        // ── Stage 7 — snapshot broadcast ───────────────────────────────────
        // Policy: broadcast is skipped when nextState === snapshot (same reference).
        // Engine actions that truly do not change state MUST preserve reference equality.
        // `engine:tick` is a state change even when no timers fire: it always advances
        // the logical clock and therefore returns a new snapshot reference, causing a
        // broadcast. If "always broadcast" semantics are ever required for unchanged
        // state (e.g. for sync-on-join), revisit this guard here and in
        // StateBroadcaster (F26).
        //
        // Skipped for nested dispatches (this.#depth > 0): only the outer action's
        // final state is broadcast. Timer-fired sub-actions accumulate into the
        // outer state; a single broadcast of the outer engine:tick result follows.
        //
        // The broadcast callback receives the full BaseGameSnapshot. Implementations
        // (e.g., StateBroadcaster) must project it via StateProjector.project() to
        // produce the per-viewer PlayerSnapshot before forwarding to transport
        // (Invariants #3/#8). This ensures undoMeta is computed once by the projector,
        // not redundantly in the pipeline.
        if (this.#depth === 0 && this.#shouldNotifyViewers(action.type, snapshot, nextState)) {
            const clockOnly = this.#isClockOnlyTick(action.type, snapshot, nextState);
            for (const pid of Object.keys(nextState.players)) {
                const viewerId = pid as PlayerId;
                if (clockOnly && this.#context?.broadcastTick !== undefined) {
                    this.#context.broadcastTick(nextState.tick, viewerId);
                } else {
                    this.#context?.broadcast?.(nextState, viewerId);
                }
            }
        }

        return nextState;
    }

    #shouldNotifyViewers(
        actionType: string,
        snapshot: Readonly<TState>,
        nextState: TState,
    ): boolean {
        return nextState !== snapshot || actionType === 'engine:sync_request';
    }

    #isClockOnlyTick(actionType: string, snapshot: Readonly<TState>, nextState: TState): boolean {
        if (actionType !== 'engine:tick') {
            return false;
        }
        if (nextState.tick !== snapshot.tick + 1) {
            return false;
        }

        const previous = snapshot as Readonly<Record<string, unknown>>;
        const next = nextState as Readonly<Record<string, unknown>>;
        let previousKeyCount = 0;
        let nextKeyCount = 0;

        for (const key in previous) {
            if (!Object.prototype.hasOwnProperty.call(previous, key)) {
                continue;
            }
            previousKeyCount += 1;
            if (key !== 'tick' && previous[key] !== next[key]) {
                return false;
            }
        }

        for (const key in next) {
            if (Object.prototype.hasOwnProperty.call(next, key)) {
                nextKeyCount += 1;
            }
        }

        return previousKeyCount === nextKeyCount;
    }

    #resolveGameResult(snapshot: TState): TState {
        if (this.#gameId === undefined) {
            return snapshot;
        }

        // Guard early-exit: if game is already resolved, skip resolver invocation.
        // Ensures resolveGame().resolveGameResult() is never called redundantly
        // on undo, redo, or subsequent actions after game-over (Invariant #38).
        if (snapshot.gameResult !== null) {
            return snapshot;
        }

        const gameResult = this.#registry.resolveGame(this.#gameId)?.resolveGameResult?.(snapshot);
        if (gameResult === undefined || gameResult === null) {
            return snapshot;
        }

        return {
            ...snapshot,
            phase: gamePhase('ended'),
            gameResult,
        };
    }
}

// ─── Noop logger ──────────────────────────────────────────────────────────────

/**
 * Internal noop logger used when no logger is injected. Avoids conditional
 * checks on every log call site inside the pipeline.
 */
const NOOP_LOGGER: Logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: function () {
        return this;
    },
};

const MATCH_ALREADY_RESOLVED_REASON = 'match_already_resolved';

function isAllowedAfterGameResult(actionType: string): boolean {
    return actionType === 'engine:sync_request';
}
