/**
 * ai/engine/CommandScheduler.ts
 *
 * CommandScheduler<TParams> interface and CommandSchedulerImpl<TParams> concrete
 * class.
 *
 * Re-exports CommandProgress discriminated union and AnyAICommand existential
 * wrapper from AICommand.ts.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 */

import type { AnyAICommand } from './AICommand.js';
import type { AIParams, PlayerSnapshot } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';

export type { AICommand, CommandProgress, AnyAICommand } from './AICommand.js';

// ─── CommandScheduler ─────────────────────────────────────────────────────────

/**
 * Queue-based command scheduler interface.
 *
 * Drives the `AICommand` lifecycle: `onStart` → repeated `onTick` → `onEnd`
 * (or `onFail` on `failed` progress).
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

// ─── CommandSchedulerImpl ─────────────────────────────────────────────────────

/**
 * Concrete FIFO command scheduler.
 *
 * Lifecycle per `advance()` call:
 *   1. If no active command and queue is non-empty: dequeue head, call `onStart`.
 *   2. Call `onTick` on the active command.
 *   3. On `done`   → call `onEnd`,  clear active command.
 *      On `failed` → call `onFail`, clear active command.
 *      On `running` → keep active command for next tick.
 *
 * All `TParams` objects are frozen via `Object.freeze` before being forwarded
 * to any lifecycle method (Invariant #18). Because `TParams extends AIParams`
 * (primitive-only fields), shallow freeze is complete.
 *
 * Architecture reference: §4.9 — AI Framework, CommandScheduler.
 */
export class CommandSchedulerImpl<
    TParams extends AIParams = AIParams,
> implements CommandScheduler<TParams> {
    private _queue: AnyAICommand<TParams>[] = [];
    private _active: AnyAICommand<TParams> | null = null;

    public enqueue(command: AnyAICommand<TParams>): void {
        this._queue.push(command);
    }

    public enqueueNext(command: AnyAICommand<TParams>): void {
        this._queue.unshift(command);
    }

    public advance(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        context: CommandContext,
    ): void {
        // Freeze params once per advance call; all lifecycle methods share the frozen copy.
        // TParams only contains primitive fields, so shallow freeze is complete (Invariant #18).
        const frozen = Object.freeze({ ...params });

        if (this._active === null) {
            if (this._queue.length === 0) return;
            this._active = this._queue.shift()!;
            this._active.onStart(snapshot, frozen, context);
        }

        const progress = this._active.onTick(snapshot, tick, frozen, context);

        if (progress.status === 'done') {
            this._active.onEnd(snapshot, frozen, context);
            this._active = null;
        } else if (progress.status === 'failed') {
            this._active.onFail(snapshot, frozen, context, progress.reason);
            this._active = null;
        }
    }

    public clearQueue(): void {
        this._queue = [];
    }

    public abort(
        reason: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        context: CommandContext,
    ): void {
        const frozen = Object.freeze({ ...params });

        if (this._active !== null) {
            this._active.onFail(snapshot, frozen, context, reason);
            this._active = null;
        }
        this._queue = [];
    }

    public get isIdle(): boolean {
        return this._active === null && this._queue.length === 0;
    }

    public get queueLength(): number {
        return this._queue.length;
    }
}
