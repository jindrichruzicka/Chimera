/**
 * ai/engine/AICommand.test.ts
 *
 * Unit tests for AICommand interface, CommandProgress discriminated union,
 * and AnyAICommand existential wrapper.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F24 (issue #423)
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method;
 *          all AICommand lifecycle signatures must use Readonly<TParams>.
 *
 * Tests written first (TDD — red confirmed: test file did not exist before
 * this commit; `pnpm test` reported 0 tests for ai/engine/AICommand).
 */

import { describe, it, expect } from 'vitest';
import type { AICommand, AnyAICommand, CommandProgress } from './AICommand.js';
import type { AIParams, PlayerSnapshot } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';

// ─── CommandProgress ──────────────────────────────────────────────────────────

describe('CommandProgress', () => {
    it('running variant has status "running"', () => {
        const p: CommandProgress = { status: 'running' };
        expect(p.status).toBe('running');
    });

    it('done variant has status "done"', () => {
        const p: CommandProgress = { status: 'done' };
        expect(p.status).toBe('done');
    });

    it('failed variant carries a reason string', () => {
        const p: CommandProgress = { status: 'failed', reason: 'target lost' };
        expect(p.status).toBe('failed');
        if (p.status === 'failed') {
            expect(p.reason).toBe('target lost');
        }
    });

    it('discriminant narrows each variant correctly', () => {
        const running: CommandProgress = { status: 'running' };
        const done: CommandProgress = { status: 'done' };
        const failed: CommandProgress = { status: 'failed', reason: 'no path' };

        if (running.status === 'running') {
            // TypeScript narrows to { status: 'running' } — no extra fields
            expect(running.status).toBe('running');
        }
        if (done.status === 'done') {
            expect(done.status).toBe('done');
        }
        if (failed.status === 'failed') {
            // TypeScript narrows to { status: 'failed'; reason: string }
            expect(failed.reason).toBe('no path');
        }
    });

    it('exhaustive switch — TypeScript errors at compile time if a variant is unhandled (Invariant #18)', () => {
        /**
         * If a new status is added to CommandProgress without updating this
         * switch, TypeScript will error on `assertNever(p)` because `p` will
         * no longer be `never`.  This test acts as a compile-time regression
         * guard.
         */
        const assertNever = (x: never): never => {
            throw new Error(
                `Unhandled CommandProgress status: ${String((x as { status: string }).status)}`,
            );
        };

        const classify = (p: CommandProgress): string => {
            switch (p.status) {
                case 'running':
                    return 'running';
                case 'done':
                    return 'done';
                case 'failed':
                    return p.reason;
                default:
                    return assertNever(p);
            }
        };

        expect(classify({ status: 'running' })).toBe('running');
        expect(classify({ status: 'done' })).toBe('done');
        expect(classify({ status: 'failed', reason: 'timeout' })).toBe('timeout');
    });

    it('rejects unknown status at compile time', () => {
        // @ts-expect-error: 'unknown' is not a valid CommandProgress status
        const _: CommandProgress = { status: 'unknown' };
        expect(_).toBeDefined();
    });

    it('failed variant rejects missing reason at compile time', () => {
        // @ts-expect-error: failed variant requires a reason field
        const _: CommandProgress = { status: 'failed' };
        expect(_).toBeDefined();
    });
});

// ─── AICommand interface ──────────────────────────────────────────────────────

describe('AICommand', () => {
    type TestParams = AIParams & { aggressivity: number };

    /**
     * Minimal conforming implementation used to verify the interface shape.
     * Invariant #18 — all lifecycle methods receive Readonly<TParams>.
     */
    const makeCommand = (): AICommand<TestParams, string> => ({
        type: 'test:noop',
        payload: 'hello',
        onStart: (
            _snapshot: PlayerSnapshot,
            _params: Readonly<TestParams>,
            _ctx: CommandContext,
        ) => {
            /* no-op */
        },
        onTick: (
            _snapshot: PlayerSnapshot,
            _tick: number,
            _params: Readonly<TestParams>,
            _ctx: CommandContext,
        ): CommandProgress => ({ status: 'done' }),
        onEnd: (_snapshot: PlayerSnapshot, _params: Readonly<TestParams>, _ctx: CommandContext) => {
            /* no-op */
        },
        onFail: (
            _snapshot: PlayerSnapshot,
            _params: Readonly<TestParams>,
            _ctx: CommandContext,
            _reason: string,
        ) => {
            /* no-op */
        },
    });

    it('conforming object satisfies the interface', () => {
        const cmd = makeCommand();
        expect(cmd).toBeDefined();
    });

    it('type property is a string', () => {
        const cmd = makeCommand();
        expect(typeof cmd.type).toBe('string');
    });

    it('payload is accessible', () => {
        const cmd = makeCommand();
        expect(cmd.payload).toBe('hello');
    });

    it('onTick returns CommandProgress', () => {
        const cmd = makeCommand();
        const snapshot: PlayerSnapshot = { tick: 1 };
        const params: TestParams = { aggressivity: 0.5 };
        const ctx: CommandContext = { dispatch: () => {}, transitionState: () => {} };
        const result = cmd.onTick(snapshot, 1, params, ctx);
        expect(result.status).toBe('done');
    });
});

// ─── AnyAICommand ─────────────────────────────────────────────────────────────

describe('AnyAICommand', () => {
    it('hides TPayload so heterogeneous queues type-check without any', () => {
        // AnyAICommand<TParams> fixes TPayload=unknown so a heterogeneous queue
        // can hold commands with different payload types without using `any`.
        const makeStringCmd = (): AnyAICommand => ({
            type: 'cmd:string',
            payload: 'payload-value',
            onStart: () => {},
            onTick: () => ({ status: 'done' }),
            onEnd: () => {},
            onFail: () => {},
        });

        const makeNumberCmd = (): AnyAICommand => ({
            type: 'cmd:number',
            payload: 42,
            onStart: () => {},
            onTick: () => ({ status: 'running' }),
            onEnd: () => {},
            onFail: () => {},
        });

        // Both fit in the same typed array — no `any` required
        const queue: AnyAICommand[] = [makeStringCmd(), makeNumberCmd()];
        expect(queue).toHaveLength(2);
        expect(queue[0]?.type).toBe('cmd:string');
        expect(queue[1]?.type).toBe('cmd:number');
    });
});
