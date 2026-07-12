/**
 * AIBrain<TParams> facade — wires together AIStateMachine, CommandScheduler,
 * CommandContext, and AIParams into a single lifecycle object consumed by
 * AIPlayerAgent.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline; AIBrain
 *          exposes no direct state-mutation path. All actions must route
 *          through CommandContext.dispatch().
 *   #18 — AIParams are frozen in the constructor before being stored and
 *          forwarded to every lifecycle method.
 */

import type { AIStateMachine } from './AIStateMachine.js';
import type { AIParams, GameResult, PlayerSnapshot } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';

/**
 * Facade that wires the full AI subsystem together for a single player agent.
 *
 * Lifecycle:
 *   - `onGameStart`  — fires tick 0 on the state machine (initial planning).
 *   - `tick`         — fires on every simulation tick.
 *   - `onGameEnd`    — aborts the command scheduler with reason `"game_ended"`.
 *
 * Params are frozen on construction (Invariant #18) and forwarded by reference
 * to every state-machine tick and scheduler call.
 */
export class AIBrain<TParams extends AIParams = AIParams> {
    /** Frozen copy of the params provided at construction (Invariant #18). */
    readonly params: Readonly<TParams>;

    constructor(
        private readonly stateMachine: AIStateMachine<TParams>,
        private readonly scheduler: CommandScheduler<TParams>,
        private readonly context: CommandContext,
        params: TParams,
    ) {
        // Spread + freeze: TParams extends Record<string, primitive> ensures
        // no object-valued fields exist, making shallow freeze complete (Invariant #18).
        this.params = Object.freeze({ ...params });
    }

    /**
     * Called once before the first simulation tick.
     * Delegates to `stateMachine.tick(snapshot, 0, ...)` for initial planning.
     */
    onGameStart(snapshot: PlayerSnapshot): void {
        this.stateMachine.tick(snapshot, 0, this.params, this.scheduler, this.context);
    }

    /**
     * Called once per simulation tick.
     * Delegates to `stateMachine.tick(snapshot, tick, ...)`.
     */
    tick(snapshot: PlayerSnapshot, tick: number): void {
        this.stateMachine.tick(snapshot, tick, this.params, this.scheduler, this.context);
    }

    /**
     * Called when the game session ends.
     * Aborts all queued commands with reason `"game_ended"` (Invariant #16 —
     * no actions may be submitted after the game ends).
     */
    onGameEnd(snapshot: PlayerSnapshot, _result: GameResult): void {
        this.scheduler.abort('game_ended', snapshot, this.params, this.context);
    }
}
