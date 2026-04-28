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
    UndoMeta,
    ViewerSnapshot,
} from './types.js';
import { toViewerSnapshot } from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';
import { createRng } from './DeterministicRng.js';
import { StateReducer } from './StateReducer.js';
import { TURN_MEMENTO_RETENTION } from './UndoManager.js';
export { ActionSchemaError, StateReducer } from './StateReducer.js';

// ─── Engine constant ──────────────────────────────────────────────────────────

/**
 * Maximum number of nested re-entrant `ctx.dispatch()` calls permitted inside
 * a single top-level `ActionPipeline.process()` invocation.
 *
 * Exceeding this limit indicates a cyclic timer chain or a game logic bug.
 * The pipeline throws `RecursiveDispatchError` at depth `MAX_NESTED_DISPATCH + 1`.
 *
 * Only `engine:tick` (F21 timer dispatch) may call `ctx.dispatch()`.
 * Game reducers must schedule work via `TimerManager.create()` instead.
 */
export const MAX_NESTED_DISPATCH = 16;

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
 * Thrown by `ActionPipeline.process()` when a re-entrant `ctx.dispatch()` call
 * causes the nesting depth to exceed `MAX_NESTED_DISPATCH`.
 *
 * Indicates a cyclic timer chain or an `engine:tick` reducer that dispatches
 * without a base case. Fix the offending reducer — do NOT increase the limit.
 */
export class RecursiveDispatchError extends Error {
    readonly code = 'RECURSIVE_DISPATCH' as const;
    readonly depth: number;

    constructor(depth: number) {
        super(
            `RecursiveDispatchError: re-entrant dispatch depth (${depth}) exceeded ` +
                `MAX_NESTED_DISPATCH = ${MAX_NESTED_DISPATCH}. ` +
                `Only engine:tick may call ctx.dispatch(); check for cyclic timer chains.`,
        );
        this.name = 'RecursiveDispatchError';
        this.depth = depth;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── ActionPipeline ───────────────────────────────────────────────────────────

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
     * Mutable singleton context handed to `validate()` and `reduce()`.
     *
     * Only `rng` is updated per call (re-seeded from `snapshot.seed` and
     * `snapshot.tick` at the top of each `process()` invocation). All other
     * fields are constant after construction.
     *
     * IMPORTANT: This object MUST NEVER escape the `process()` stack frame.
     */
    readonly #ctx: MutableReduceContext;

    constructor(
        registry: ActionRegistry<TState>,
        options?: { logger?: Logger; context?: PipelineContext },
    ) {
        this.#registry = registry;
        this.#logger = options?.logger ?? NOOP_LOGGER;
        this.#context = options?.context;

        // Hoist the dispatch closure once — same body as before, rooted on the
        // instance so #depth tracking works correctly for re-entrant calls.
        this.#dispatchFn = (dispatchState, dispatchAction) => {
            if (this.#depth >= MAX_NESTED_DISPATCH) {
                throw new RecursiveDispatchError(this.#depth);
            }
            this.#depth++;
            try {
                return this.process(dispatchState as Readonly<TState>, dispatchAction);
            } finally {
                this.#depth--;
            }
        };

        // Build the reusable context object. `rng` is a placeholder — it is
        // re-assigned at the start of every `process()` call before any
        // validate/reduce invocation reads it.
        this.#ctx = {
            rng: createRng(0, 0),
            dispatch: this.#dispatchFn,
            ...(this.#context?.db !== undefined ? { db: this.#context.db } : {}),
            ...(this.#context?.undoManager !== undefined
                ? { undoManager: this.#context.undoManager }
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

            // Stage 6 equivalent — record undo/redo in history so it appears in replay.
            this.#context.history?.append({
                tickApplied: snapshot.tick,
                turnNumber: snapshot.turnNumber,
                action,
            });

            // Stage 7 — broadcast reconstructed snapshot to all viewers.
            // TODO(F26): replace `toViewerRecord` + `#makeViewerRecord` with a real
            // `StateProjector` call so each player receives only their own view of
            // the state and `undoMeta` is folded into the single projection — avoiding
            // a separate spread per viewer. The same TODO marker exists below the
            // normal Stage 7 path; both must be replaced together.
            if (reconstructed !== snapshot) {
                const rawRecord = toViewerRecord(reconstructed);
                for (const pid of Object.keys(reconstructed.players)) {
                    const viewerId = pid as PlayerId;
                    const viewerSnapshot = this.#makeViewerRecord(rawRecord, viewerId, undoManager);
                    this.#context.broadcast?.(viewerSnapshot, viewerId);
                }
            }

            return reconstructed as TState;
        }

        // ── Stage 4 — authorization (validate) ────────────────────────────
        // Re-seed the shared context for this invocation. `#ctx` is reused
        // across calls (issue #36) — only `rng` varies per (seed, tick) pair.
        // IMPORTANT: #ctx must never escape this stack frame.
        this.#ctx.rng = createRng(snapshot.seed, snapshot.tick);
        const ctx: ReduceContext = this.#ctx;

        const result = def.validate(parsedPayload, snapshot, action.playerId, ctx);
        if (!result.ok) {
            throw new ActionUnauthorizedError(action.type, result.reason);
        }

        // ── Stage 5 — reduce ──────────────────────────────────────────────
        const nextState = def.reduce(snapshot, parsedPayload, action.playerId, ctx);

        this.#logger.debug('action reduced', {
            type: action.type,
            playerId: action.playerId,
            tick: action.tick,
        });

        // ── Stage 6 — history record ────────────────────────────────────────
        // Append the action envelope to the history so the undo/redo subsystem
        // can reconstruct the action sequence for a turn. turnNumber is the
        // dedicated turn counter on BaseGameSnapshot — it advances only on
        // engine:end_turn while tick advances on every reduce.
        this.#context?.history?.append({
            tickApplied: snapshot.tick,
            turnNumber: snapshot.turnNumber,
            action,
        });

        // ── Stage 7 — snapshot broadcast ───────────────────────────────────
        // Policy: broadcast is skipped when nextState === snapshot (same reference).
        // All current stub engine actions (engine:tick, engine:undo, etc.) return the
        // same reference, so no network traffic is generated until state actually
        // changes. If "always broadcast" semantics are ever required (e.g. for
        // sync-on-join), revisit this guard here and in StateBroadcaster (F26).
        //
        // TODO(F26): replace `toViewerRecord` + `#makeViewerRecord` with a real
        // `StateProjector` call so each player receives only their own view of the
        // state and `undoMeta` is folded into the single projection — avoiding a
        // per-viewer spread allocation. (Invariant #1 — `GameSnapshot` must never
        // leave the main process as-is.) The same TODO exists in the Stage 3
        // short-circuit broadcast path above; both must be replaced together.
        if (nextState !== snapshot) {
            const rawRecord = toViewerRecord(nextState);
            for (const pid of Object.keys(nextState.players)) {
                const viewerId = pid as PlayerId;
                const viewerSnapshot = this.#makeViewerRecord(rawRecord, viewerId);
                this.#context?.broadcast?.(viewerSnapshot, viewerId);
            }
        }

        // ── Post-Stage-7 turn-lifecycle hook ───────────────────────────────
        // After a successful `engine:end_turn` reduce we must:
        //   1. Clear the prior active player's undo history so the
        //      `crossTurnUndo: false` policy default holds in production.
        //   2. Record a turn memento for the NEW active player so the next
        //      turn has a baseline to undo back to (host wiring — WARN-1).
        //   3. Prune the bounded action history to `TURN_MEMENTO_RETENTION`
        //      turns of retention so memory stays bounded under long sessions.
        // All of this runs AFTER Stage 7 so the broadcast snapshot still
        // carries the player's pre-clear `undoMeta` for the final tick.
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
            this.#context?.history?.pruneTo(nextState.turnNumber - TURN_MEMENTO_RETENTION);
        }

        return nextState;
    }

    /**
     * Builds the per-viewer broadcast record from the raw state record.
     *
     * Merges `undoMeta` derived from `undoManager` (or `#context.undoManager`
     * when `undoManager` is not supplied) into the record for the given viewer.
     * Both fields default to `false` when no `UndoManager` is available.
     *
     * TODO(F26): Replace this method with a `StateProjector` call so the
     * per-player projection and `undoMeta` injection happen in one pass —
     * eliminating the per-viewer spread allocation at the pipeline hot path.
     */
    #makeViewerRecord(
        rawRecord: Readonly<Record<string, unknown>>,
        viewerId: PlayerId,
        undoManager?: PipelineContext['undoManager'],
    ): ViewerSnapshot {
        const mgr = undoManager ?? this.#context?.undoManager;
        const undoMeta: UndoMeta = {
            canUndo: mgr?.canUndo(viewerId) ?? false,
            canRedo: mgr?.canRedo(viewerId) ?? false,
        };
        return toViewerSnapshot({ ...rawRecord, undoMeta });
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

// ─── Internal cast helper ─────────────────────────────────────────────────────

/**
 * Reinterprets a `BaseGameSnapshot` (or subtype) as a viewer record so the
 * pipeline can spread `undoMeta` into per-player broadcast payloads without
 * triggering a TS index-signature error on every call site.
 *
 * This is the **only** place in `simulation/` that performs the
 * `BaseGameSnapshot → Record<string, unknown>` reinterpretation. Both Stage 3
 * (undo/redo short-circuit) and Stage 7 (normal broadcast) call into it so a
 * future `StateProjector` implementation (F26) can replace this single helper.
 *
 * Safety: `BaseGameSnapshot` is a plain data object with `string`-keyed fields,
 * so the reinterpretation is structurally sound. The double cast is required
 * because `BaseGameSnapshot` lacks an explicit index signature.
 *
 * INVARIANT #1: this function does NOT brand the value as `ViewerSnapshot`.
 * Callers must pass through `#makeViewerRecord` → `toViewerSnapshot` so the
 * brand is applied only after a per-viewer projection (currently a no-op
 * spread that injects `undoMeta`).
 */
const toViewerRecord = (state: Readonly<BaseGameSnapshot>): Readonly<Record<string, unknown>> =>
    state;
