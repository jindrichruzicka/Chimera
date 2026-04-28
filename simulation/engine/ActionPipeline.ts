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
    BroadcastContext,
    ContentDatabase,
    PlayerId,
    ReduceContext,
} from './types.js';
import type { ActionRegistry } from './ActionRegistry.js';
import { createRng } from './DeterministicRng.js';
import { ActionSchemaError } from './StateReducer.js';
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
 * Invariant 7-stage pipeline that is the sole authoritative mutation point for
 * all game state. Every `ActionEnvelope` must travel through all 7 stages in
 * fixed sequential order. No stage may be skipped or reordered.
 *
 * Stage order (immutable — invariant #2):
 *   1. Tick validation     — envelope.tick must equal snapshot.tick; throws StaleActionError.
 *   2. Schema validation   — def.parsePayload(); throws ActionSchemaError.
 *   3. Undo/redo intercept — no-op stub (F16).
 *   4. Authorization       — def.validate(); throws ActionUnauthorizedError.
 *   5. Reduce              — def.reduce() via StateReducer; produces nextState.
 *   6. History record      — no-op stub (F16).
 *   7. Snapshot broadcast  — no-op stub (F15/F26).
 *
 * Constructor:
 *   `new ActionPipeline(registry, { logger? })`
 *   The `logger` is optional and defaults to a noop. Pass any `Logger` from
 *   `shared/logging.ts` — the pipeline never creates its own logger.
 */
export class ActionPipeline<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #registry: ActionRegistry<TState>;
    readonly #logger: Logger;
    readonly #db: ContentDatabase | undefined;
    readonly #broadcastContext: BroadcastContext | undefined;
    /**
     * Tracks current re-entrant dispatch depth. Starts at 0 (top-level call);
     * incremented by the dispatch closure before each nested process() call and
     * decremented in the `finally` block. Synchronous-only — simulation has no
     * async reducers.
     */
    #depth = 0;

    constructor(
        registry: ActionRegistry<TState>,
        options?: { logger?: Logger; db?: ContentDatabase; broadcastContext?: BroadcastContext },
    ) {
        this.#registry = registry;
        this.#logger = options?.logger ?? NOOP_LOGGER;
        this.#db = options?.db;
        this.#broadcastContext = options?.broadcastContext;
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
        let parsedPayload: Record<string, unknown>;
        try {
            parsedPayload = def.parsePayload(action.payload);
        } catch (err) {
            throw new ActionSchemaError(
                action.type,
                err instanceof Error ? err : new Error(String(err)),
            );
        }

        // ── Stage 3 — undo/redo intercept (no-op stub) ────────────────────
        // TODO(F16): intercept engine:undo / engine:redo via UndoManager.
        //            Short-circuit here and return the undo/redo state directly
        //            without reaching Stage 5.

        // ── Stage 4 — authorization (validate) ────────────────────────────
        // Build the ReduceContext that validate() and reduce() both receive.
        // dispatch is a closure over `this` so it can enforce the depth limit.
        const ctx: ReduceContext = this.#buildReduceContext(snapshot);

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

        // ── Stage 6 — history record (no-op stub) ─────────────────────────
        // TODO(F16): append to ActionHistory via HistoryContext.
        //            Record the ActionEnvelope and the pre/post snapshots for
        //            undo/redo memento construction.

        // ── Stage 7 — snapshot broadcast ───────────────────────────────────
        // Stub: broadcasts the raw nextState (cast as opaque) per player.
        // Real per-viewer projection via StateProjector lands in F26.
        for (const pid of Object.keys(nextState.players)) {
            this.#broadcastContext?.broadcast?.(
                nextState as Readonly<Record<string, unknown>>,
                pid as PlayerId,
            );
        }

        return nextState;
    }

    /**
     * Build the `ReduceContext` for a single `process()` invocation.
     *
     * `rng` is a seeded `DeterministicRng` derived from `(snapshot.seed, snapshot.tick)`
     * via `createRng`. Each `process()` call gets a fresh RNG seeded from the canonical
     * (seed, tick) pair — ensuring deterministic, reproducible draws for every action.
     *
     * `dispatch` is the re-entrant pipeline entry point. Depth is tracked on
     * the pipeline instance (synchronous only). Exceeding `MAX_NESTED_DISPATCH`
     * throws `RecursiveDispatchError`.
     *
     * NOTE: Only `engine:tick` (F21 timers) may call `ctx.dispatch()`.
     *       Game reducers must NOT call it.
     */
    #buildReduceContext(snapshot: Readonly<BaseGameSnapshot>): ReduceContext {
        const ctx: ReduceContext = {
            rng: createRng(snapshot.seed, snapshot.tick),
            dispatch: (dispatchState, dispatchAction) => {
                if (this.#depth >= MAX_NESTED_DISPATCH) {
                    throw new RecursiveDispatchError(this.#depth);
                }
                this.#depth++;
                try {
                    return this.process(dispatchState as Readonly<TState>, dispatchAction);
                } finally {
                    this.#depth--;
                }
            },
        };
        // Only set db when provided — required by exactOptionalPropertyTypes.
        if (this.#db !== undefined) {
            return { ...ctx, db: this.#db };
        }
        return ctx;
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
