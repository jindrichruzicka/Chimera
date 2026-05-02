/**
 * ai/engine/CommandContext.ts
 *
 * CommandContext interface — dispatch bridge between AI commands and the
 * ActionPipeline, plus deferred state-transition request.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline (via dispatch).
 */

import type { EngineAction } from '@chimera/simulation/engine/types.js';

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
