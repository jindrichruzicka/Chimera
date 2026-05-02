/**
 * ai/engine/CommandScheduler.ts
 *
 * CommandScheduler<TParams> interface.
 * Re-exports CommandProgress discriminated union and AnyAICommand existential
 * wrapper from AICommand.ts.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 */

import type { AnyAICommand } from './AICommand.js';
import type { CommandContext } from './CommandContext.js';
import type { AIParams, PlayerSnapshot } from './PlayerAgent.js';

export type { AICommand, CommandProgress, AnyAICommand } from './AICommand.js';

// ─── CommandScheduler ─────────────────────────────────────────────────────────

/**
 * Queue-based command scheduler interface.
 *
 * Drives the `AICommand` lifecycle: `onStart` → repeated `onTick` → `onEnd`
 * (or `onFail` on `failed` progress). The full queue implementation lands in F24.
 *
 * Architecture reference: §4.9 — AI Framework, CommandScheduler.
 */
export interface CommandScheduler<TParams extends AIParams = AIParams> {
    /** Append a command to the back of the queue. */
    enqueue(command: AnyAICommand<TParams>): void;
    /** Prepend a command to the front of the queue (urgent/interrupt). */
    enqueueNext(command: AnyAICommand<TParams>): void;
    /** Advance the active command by one tick; calls lifecycle methods as needed. */
    advance(snapshot: PlayerSnapshot, tick: number, params: TParams, context: CommandContext): void;
    /** Discard all queued commands without calling any lifecycle methods. */
    clearQueue(): void;
    /**
     * Abort the active command with a reason, then drain the queue.
     * Calls `onFail` on the active command before clearing.
     */
    abort(reason: string, snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    /** `true` when no active command and the queue is empty. */
    readonly isIdle: boolean;
    /** Number of commands in the queue (excluding the active command). */
    readonly queueLength: number;
}
