/**
 * ai/engine/CommandScheduler.test.ts
 *
 * Unit tests for CommandScheduler interface, CommandProgress discriminated union,
 * and AnyAICommand existential wrapper.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import type { CommandProgress, AnyAICommand } from './AICommand.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { AIParams } from './PlayerAgent.js';

// ─── CommandProgress ───────────────────────────────────────────────────────────

describe('CommandProgress', () => {
    it('running variant has status "running"', () => {
        const p: CommandProgress = { status: 'running' };
        expect(p.status).toBe('running');
    });

    it('done variant has status "done"', () => {
        const p: CommandProgress = { status: 'done' };
        expect(p.status).toBe('done');
    });

    it('failed variant has status "failed" and a reason string', () => {
        const p: CommandProgress = { status: 'failed', reason: 'target lost' };
        expect(p.status).toBe('failed');
        if (p.status === 'failed') {
            expect(p.reason).toBe('target lost');
        }
    });

    it('discriminated union narrows correctly on status', () => {
        const classify = (p: CommandProgress): string => {
            switch (p.status) {
                case 'running':
                    return 'in-flight';
                case 'done':
                    return 'success';
                case 'failed':
                    return `fail:${p.reason}`;
            }
        };

        expect(classify({ status: 'running' })).toBe('in-flight');
        expect(classify({ status: 'done' })).toBe('success');
        expect(classify({ status: 'failed', reason: 'timeout' })).toBe('fail:timeout');
    });
});

// ─── CommandScheduler ─────────────────────────────────────────────────────────

describe('CommandScheduler', () => {
    const makeScheduler = <TParams extends AIParams = AIParams>(): CommandScheduler<TParams> => ({
        enqueue: vi.fn(),
        enqueueNext: vi.fn(),
        advance: vi.fn(),
        clearQueue: vi.fn(),
        abort: vi.fn(),
        isIdle: true,
        queueLength: 0,
    });

    it('conforming object satisfies the interface', () => {
        const scheduler = makeScheduler();
        expect(scheduler).toBeDefined();
    });

    it('isIdle is a boolean', () => {
        const scheduler = makeScheduler();
        expect(typeof scheduler.isIdle).toBe('boolean');
    });

    it('queueLength is a number', () => {
        const scheduler = makeScheduler();
        expect(typeof scheduler.queueLength).toBe('number');
    });

    it('enqueue is callable', () => {
        const scheduler = makeScheduler();
        const command: AnyAICommand = {
            type: 'test:noop',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'done' }),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };
        expect(() => scheduler.enqueue(command)).not.toThrow();
    });

    it('enqueueNext is callable', () => {
        const scheduler = makeScheduler();
        const command: AnyAICommand = {
            type: 'test:urgent',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'running' }),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };
        expect(() => scheduler.enqueueNext(command)).not.toThrow();
    });

    it('clearQueue is callable', () => {
        const scheduler = makeScheduler();
        expect(() => scheduler.clearQueue()).not.toThrow();
    });

    it('abort is callable with reason and context args', () => {
        const scheduler = makeScheduler();
        const snapshot = { tick: 5 };
        const params: AIParams = {};
        const context = { dispatch: vi.fn(), transitionState: vi.fn() };
        expect(() => scheduler.abort('target lost', snapshot, params, context)).not.toThrow();
    });
});

// ─── AnyAICommand ─────────────────────────────────────────────────────────────

describe('AnyAICommand', () => {
    it('conforming command object satisfies the type', () => {
        const cmd: AnyAICommand = {
            type: 'tactics:move',
            payload: { x: 3, y: 4 },
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'running' }),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };
        expect(cmd.type).toBe('tactics:move');
        expect(cmd.payload).toEqual({ x: 3, y: 4 });
    });

    it('onTick returns CommandProgress', () => {
        const snapshot = { tick: 1 };
        const params: AIParams = {};
        const context = { dispatch: vi.fn(), transitionState: vi.fn() };

        const cmd: AnyAICommand = {
            type: 'tactics:attack',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'done' }),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };

        const result = cmd.onTick(snapshot, 1, params, context);
        expect(result.status).toBe('done');
    });
});
