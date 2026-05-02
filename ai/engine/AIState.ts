/**
 * ai/engine/AIState.ts
 *
 * AIState<TParams> interface — state-pattern building block for AIStateMachine.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method;
 *          signatures accept TParams by value, not by reference mutation.
 *   #19 — At most one state transition is applied per AI tick (enforced by
 *          AIStateMachine via CommandContext.transitionState deferral).
 */

import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { AIParams, PlayerSnapshot } from './AITypes.js';

/**
 * A single state in an `AIStateMachine<TParams>`.
 *
 * Implement this interface to define AI behaviour for one state. Register the
 * state with `AIStateMachine.registerState()` (implemented in F25).
 *
 * Lifecycle order per transition:
 *   old state `onExit` → new state `onEnter` → repeated `onTick` / `onIdle`
 *
 * `onIdle` is the primary planning hook — called by the machine whenever the
 * `CommandScheduler` queue is empty so the state can enqueue new work.
 */
export interface AIState<TParams extends AIParams = AIParams> {
    /** Unique state name used by `CommandContext.transitionState`. */
    readonly name: string;

    /**
     * Called once when the state is entered (after the previous state's `onExit`).
     *
     * @param snapshot  Viewer-safe snapshot for this player at entry tick.
     * @param params    Frozen AI personality parameters (Invariant #18).
     * @param scheduler Command queue for this brain.
     * @param context   Dispatch bridge and state-transition handle.
     */
    onEnter(
        snapshot: PlayerSnapshot,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    /**
     * Called every simulation tick while this state is active.
     *
     * @param snapshot  Viewer-safe snapshot for this tick.
     * @param tick      Current simulation tick counter.
     * @param params    Frozen AI personality parameters (Invariant #18).
     * @param scheduler Command queue for this brain.
     * @param context   Dispatch bridge and state-transition handle.
     */
    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    /**
     * Called when the `CommandScheduler` queue empties mid-tick.
     *
     * Primary planning hook — enqueue new commands here rather than in `onTick`.
     *
     * @param snapshot  Viewer-safe snapshot at idle moment.
     * @param tick      Current simulation tick counter.
     * @param params    Frozen AI personality parameters (Invariant #18).
     * @param scheduler Command queue for this brain (currently idle).
     * @param context   Dispatch bridge and state-transition handle.
     */
    onIdle(
        snapshot: PlayerSnapshot,
        tick: number,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    /**
     * Called once when the state is exited (before the next state's `onEnter`).
     *
     * @param snapshot  Viewer-safe snapshot at exit tick.
     * @param params    Frozen AI personality parameters (Invariant #18).
     */
    onExit(snapshot: PlayerSnapshot, params: Readonly<TParams>): void;
}
