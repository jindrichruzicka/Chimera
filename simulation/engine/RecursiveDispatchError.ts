/**
 * simulation/engine/RecursiveDispatchError.ts
 *
 * Depth guard for re-entrant `ctx.dispatch()` calls inside ActionPipeline.
 *
 * Exports:
 *   - `MAX_NESTED_DISPATCH` — ceiling for nested dispatch depth (16).
 *   - `RecursiveDispatchError` — thrown when that ceiling is exceeded.
 *
 * Architecture reference: §4.7, §4.20
 * Task: F21 (issue #405)
 *
 * Invariants upheld:
 *   #43 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #89 — ctx.dispatch() nesting depth is bounded; exceeding causes RecursiveDispatchError.
 */

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

// ─── Error class ──────────────────────────────────────────────────────────────

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
