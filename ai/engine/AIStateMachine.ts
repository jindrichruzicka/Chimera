/**
 * AIStateMachine<TParams> interface and AIStateMachineImpl<TParams> class.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method;
 *          AIStateMachineImpl freezes a shallow copy of params before forwarding.
 *   #19 — At most one state transition is applied per AI tick. Multiple
 *          transition() calls within a single tick: last-wins; earlier requests
 *          are discarded and a warning is logged.
 */

import type { AIState } from './AIState.js';
import type { AIParams, PlayerSnapshot } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';

/**
 * State-machine interface for AI brains.
 *
 * Register named states with `registerState`, then call `setInitialState` once
 * to enter the first state (calls `onEnter` synchronously). Subsequent state
 * changes go through `transition()` — which buffers the request and applies it
 * at the start of the **next** `tick()` call (Invariant #19).
 *
 * Architecture reference: §4.9, AIStateMachine.
 */
export interface AIStateMachine<TParams extends AIParams = AIParams> {
    /** Register a state by name. Duplicate names overwrite silently. */
    registerState(state: AIState<TParams>): void;
    /**
     * Enter the first state synchronously — identical to an immediate transition.
     * Calls `onEnter` on the named state before returning.
     */
    setInitialState(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    /**
     * Buffer a deferred state transition.
     *
     * The transition is applied at the **start** of the next `tick()` call:
     * `onExit` fires on the current state, then `onEnter` fires on the new state.
     * Multiple calls within the same tick discard earlier requests and log a
     * warning (Invariant #19, last-wins).
     */
    transition(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    /**
     * Advance the state machine by one simulation tick.
     *
     * 1. Applies any pending deferred transition (`onExit` old → `onEnter` new).
     * 2. Calls `scheduler.advance()` to drive the command queue and update `isIdle`.
     * 3. If `scheduler.isIdle`, calls `currentState.onIdle` (planning).
     * 4. Calls `currentState.onTick` (reactions).
     */
    tick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    /** The currently active state. Throws if `setInitialState` has not been called. */
    readonly currentState: AIState<TParams>;
}

/**
 * Concrete implementation of `AIStateMachine<TParams>`.
 *
 * Maintains a name→state registry and a single-slot deferred-transition
 * buffer. See `AIStateMachine` interface for the full contract.
 */
export class AIStateMachineImpl<
    TParams extends AIParams = AIParams,
> implements AIStateMachine<TParams> {
    private readonly states = new Map<string, AIState<TParams>>();
    private _currentState: AIState<TParams> | null = null;
    /** Single-slot deferred-transition buffer (Invariant #19). */
    private pendingTransition: string | null = null;
    private readonly logger: Logger | undefined;

    constructor(options?: { readonly logger?: Logger }) {
        this.logger = options?.logger;
    }

    // Stable wrapped-context proxy (Performance §13). Live tick args are stored
    // here for the duration of tick() and nulled in finally, so any post-tick use
    // of a captured context reference throws immediately.
    private _tc: CommandContext | null = null;
    private _ts: PlayerSnapshot | null = null;
    private _tp: TParams | null = null;
    private _tsch: CommandScheduler<TParams> | null = null;

    /**
     * Single CommandContext object allocated once per machine instance.
     * Its closures forward to the live fields above (Performance §13).
     */
    private readonly _wrappedCtx: CommandContext = {
        dispatch: (action) => {
            if (this._tc === null) {
                throw new Error('[AIStateMachine] wrappedCtx.dispatch() called outside of tick()');
            }
            this._tc.dispatch(action);
        },
        transitionState: (stateName) => {
            if (
                this._tc === null ||
                this._ts === null ||
                this._tp === null ||
                this._tsch === null
            ) {
                throw new Error(
                    '[AIStateMachine] wrappedCtx.transitionState() called outside of tick()',
                );
            }
            this.transition(stateName, this._ts, this._tp, this._tsch, this._tc);
        },
    };

    // frozen() memoization (Performance §13): avoids a spread+freeze allocation
    // when the caller passes the same params reference on consecutive ticks.
    private _lastParams: TParams | undefined;
    private _lastFrozen: Readonly<TParams> | undefined;

    public registerState(state: AIState<TParams>): void {
        this.states.set(state.name, state);
    }

    public setInitialState(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void {
        const state = this.requireState(stateName);
        this._currentState = state;

        // If onEnter calls context.transitionState(), it must route through _wrappedCtx
        // to buffer the transition (Invariant #19), so populate the live fields first;
        // null them out in finally so stale captured references throw (Performance §13).
        const frozenParams = this.frozen(params);
        this._tc = context;
        this._ts = snapshot;
        this._tp = params;
        this._tsch = scheduler;

        try {
            state.onEnter(snapshot, frozenParams, scheduler, this._wrappedCtx);
        } finally {
            this._tc = null;
            this._ts = null;
            this._tp = null;
            this._tsch = null;
        }
    }

    public transition(
        stateName: string,
        _snapshot: PlayerSnapshot,
        _params: TParams,
        _scheduler: CommandScheduler<TParams>,
        _context: CommandContext,
    ): void {
        if (this.pendingTransition !== null) {
            // Invariant #19: last-wins; warn and overwrite
            this.logger?.warn('ai-state-machine:transition-overwrite', {
                discarded: this.pendingTransition,
                kept: stateName,
            });
        }
        this.pendingTransition = stateName;
    }

    public tick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void {
        const frozenParams = this.frozen(params);

        // Populate live fields so the stable _wrappedCtx proxy can forward calls;
        // nulled in finally so stale captured references throw.
        this._tc = context;
        this._ts = snapshot;
        this._tp = params;
        this._tsch = scheduler;

        try {
            // Apply the transition buffered on the previous tick (Invariant #19).
            if (this.pendingTransition !== null) {
                const nextStateName = this.pendingTransition;
                this.pendingTransition = null;
                const nextState = this.requireState(nextStateName);
                this.currentState.onExit(snapshot, frozenParams);
                this._currentState = nextState;
                nextState.onEnter(snapshot, frozenParams, scheduler, this._wrappedCtx);
            }

            // Drive the command queue; updates scheduler.isIdle.
            scheduler.advance(snapshot, tick, frozenParams, this._wrappedCtx);

            const current = this.currentState; // throws if not initialised
            // Planning hook: enqueue new work only when the queue has drained.
            if (scheduler.isIdle) {
                current.onIdle(snapshot, tick, frozenParams, scheduler, this._wrappedCtx);
            }

            current.onTick(snapshot, tick, frozenParams, scheduler, this._wrappedCtx);
        } finally {
            this._tc = null;
            this._ts = null;
            this._tp = null;
            this._tsch = null;
        }
    }

    public get currentState(): AIState<TParams> {
        if (this._currentState === null) {
            throw new Error(
                '[AIStateMachine] currentState accessed before setInitialState was called',
            );
        }
        return this._currentState;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Return a frozen shallow copy of params (Invariant #18).
     * Memoized by reference — returns the same Readonly object when
     * the caller supplies the same params reference across consecutive ticks
     * (Performance §13).
     */
    private frozen(params: TParams): Readonly<TParams> {
        if (params !== this._lastParams) {
            this._lastParams = params;
            this._lastFrozen = Object.freeze({ ...params });
        }
        // Non-null: the branch above always sets _lastFrozen when params changes, and params is never nullish.
        return this._lastFrozen!;
    }

    private requireState(name: string): AIState<TParams> {
        const state = this.states.get(name);
        if (state === undefined) {
            throw new Error(`[AIStateMachine] State '${name}' is not registered`);
        }
        return state;
    }
}
