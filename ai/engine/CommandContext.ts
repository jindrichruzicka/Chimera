/**
 * ai/engine/CommandContext.ts
 *
 * CommandContext interface and CommandContextImpl — dispatch bridge between AI
 * commands and the ActionPipeline, plus deferred state-transition request.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418), F24 (issue #424)
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline (via dispatch).
 *   #19 — At most one state transition is applied per AI tick; last-wins buffer
 *          in CommandContextImpl; earlier requests discarded with a warning.
 */

import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import type { EngineAction } from '@chimera-engine/simulation/engine/types.js';

/**
 * Dispatch bridge supplied to every AICommand and AIState lifecycle method.
 *
 * `dispatch`        — submits an EngineAction through the ActionPipeline,
 *                     identical to the path taken by human player actions.
 * `transitionState` — requests a state transition; deferred to the end of
 *                     the current tick (re-entrancy guard, Invariant #19).
 */
export interface CommandContext {
    /** Submit an EngineAction — routes through ActionPipeline like a human action. */
    dispatch(action: EngineAction): void;
    /** Request state transition — deferred to end of current tick (re-entrancy guard). */
    transitionState(stateName: string): void;
}

// ─── CommandContextImpl ───────────────────────────────────────────────────────

/**
 * Concrete implementation of `CommandContext`.
 *
 * Wraps an `ActionPipeline` dispatch callback and a `transitionCallback` supplied
 * by the owning state machine. Behaviour:
 *
 * - `dispatch(action)` — invokes the dispatch callback immediately (Invariant #16).
 * - `transitionState(name)` — buffers the request in a single-slot; a second call
 *   in the same tick overwrites the previous request and logs a warning via the
 *   injected `Logger` (Invariant #19, last-wins).
 * - `applyPendingTransition()` — called by the state machine at the end of each
 *   tick; invokes `transitionCallback` with the buffered name (if any) and clears
 *   the buffer. No-op when no transition was requested.
 */
export class CommandContextImpl implements CommandContext {
    /** Single-slot deferred-transition buffer (Invariant #19). */
    private pendingTransition: string | null = null;

    constructor(
        private readonly _dispatch: (action: EngineAction) => void,
        private readonly _transitionCallback: (stateName: string) => void,
        private readonly _logger: Logger,
    ) {}

    public dispatch(action: EngineAction): void {
        this._dispatch(action);
    }

    public transitionState(stateName: string): void {
        if (this.pendingTransition !== null) {
            // Invariant #19: last-wins; warn and overwrite
            this._logger.warn(
                `[CommandContext] Multiple transitionState() calls in one tick: ` +
                    `discarding '${this.pendingTransition}', keeping '${stateName}'`,
            );
        }
        this.pendingTransition = stateName;
    }

    /**
     * Apply the buffered transition request (if any) — **standalone-use API**.
     *
     * When `CommandContextImpl` is used directly (without being wrapped by an
     * `AIStateMachineImpl`), the caller is responsible for flushing the buffer
     * by invoking this method at the end of each tick (Invariant #19).
     *
     * **Wrapped mode**: when `AIStateMachineImpl` is in play, its internal
     * `_wrappedCtx` proxy intercepts every `transitionState()` call and routes
     * it through `AIStateMachineImpl.transition()` before it ever reaches
     * `CommandContextImpl.transitionState()`.  In that mode
     * `CommandContextImpl.pendingTransition` is never written and calling this
     * method is a no-op.  The state machine manages its own deferred-transition
     * buffer exclusively.
     *
     * Clears the buffer after invoking the callback so a second call is a no-op.
     */
    public applyPendingTransition(): void {
        if (this.pendingTransition !== null) {
            const name = this.pendingTransition;
            this.pendingTransition = null;
            this._transitionCallback(name);
        }
    }
}
