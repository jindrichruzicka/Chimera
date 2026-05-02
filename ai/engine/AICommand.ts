/**
 * ai/engine/AICommand.ts
 *
 * AICommand interface, CommandProgress discriminated union,
 * AnyAICommand existential wrapper.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 */

import type { CommandContext } from './CommandContext.js';
import type { AIParams, PlayerSnapshot } from './PlayerAgent.js';

// ─── CommandProgress ───────────────────────────────────────────────────────────

/**
 * Discriminated union returned by `AICommand.onTick` to drive the scheduler.
 *
 * - `running` — command is still in progress; scheduler will call `onTick` next tick.
 * - `done`    — command completed successfully; scheduler advances to next command.
 * - `failed`  — command failed; scheduler calls `onFail` then advances.
 */
export type CommandProgress =
    | { readonly status: 'running' }
    | { readonly status: 'done' }
    | { readonly status: 'failed'; readonly reason: string };

// ─── AICommand ────────────────────────────────────────────────────────────────

/**
 * Command pattern interface — a single goal spanning multiple simulation ticks.
 *
 * `onTick` returns `CommandProgress` to drive the scheduler loop.
 *
 * Architecture reference: §4.9 — AI Framework, AICommand.
 */
export interface AICommand<TParams extends AIParams = AIParams, TPayload = unknown> {
    /** Namespaced command type identifier, e.g. `'tactics:move-to-target'`. */
    readonly type: string;
    /** Immutable command payload provided at enqueue time. */
    readonly payload: Readonly<TPayload>;

    onStart(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        context: CommandContext,
    ): CommandProgress;
    onEnd(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    onFail(
        snapshot: PlayerSnapshot,
        params: TParams,
        context: CommandContext,
        reason: string,
    ): void;
}

/**
 * Existential wrapper so the scheduler queue remains well-typed without `any`.
 *
 * `TPayload` is hidden (`unknown`) so heterogeneous command queues type-check.
 */
export type AnyAICommand<TParams extends AIParams = AIParams> = AICommand<TParams, unknown>;
