/**
 * ai/engine/CommandScheduler.test.ts
 *
 * Unit tests for CommandScheduler interface, AnyAICommand existential wrapper,
 * and CommandSchedulerImpl concrete class.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Tasks: F23 (issue #418), F24 (issue #425)
 *
 * CommandProgress discriminated-union tests live in AICommand.test.ts.
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import type { CommandProgress, AnyAICommand } from './AICommand.js';
import { CommandSchedulerImpl } from './CommandScheduler.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { CommandContext } from './CommandContext.js';
import type { AIParams } from './AITypes.js';

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
        const snapshot = makeStubPlayerSnapshot(5);
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
        const snapshot = makeStubPlayerSnapshot(1);
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

// ─── CommandSchedulerImpl ─────────────────────────────────────────────────────

// Helpers ─────────────────────────────────────────────────────────────────────

function makeContext(): CommandContext {
    return { dispatch: vi.fn(), transitionState: vi.fn() };
}

function makeCommand(progressSequence: CommandProgress[]): AnyAICommand & {
    onStart: ReturnType<typeof vi.fn>;
    onTick: ReturnType<typeof vi.fn>;
    onEnd: ReturnType<typeof vi.fn>;
    onFail: ReturnType<typeof vi.fn>;
} {
    let tickIndex = 0;
    return {
        type: 'test:cmd',
        payload: {},
        onStart: vi.fn(),
        onTick: vi
            .fn()
            .mockImplementation(() => progressSequence[tickIndex++] ?? { status: 'done' }),
        onEnd: vi.fn(),
        onFail: vi.fn(),
    };
}

const SNAPSHOT = makeStubPlayerSnapshot(1);
const TICK = 1;

describe('CommandSchedulerImpl', () => {
    // ── isIdle / queueLength ──────────────────────────────────────────────

    it('isIdle is true on a fresh scheduler', () => {
        const s = new CommandSchedulerImpl();
        expect(s.isIdle).toBe(true);
    });

    it('isIdle is false after enqueue', () => {
        const s = new CommandSchedulerImpl();
        s.enqueue(makeCommand([{ status: 'running' }]));
        expect(s.isIdle).toBe(false);
    });

    it('queueLength reflects number of pending commands (excluding active)', () => {
        const s = new CommandSchedulerImpl();
        expect(s.queueLength).toBe(0);

        s.enqueue(makeCommand([{ status: 'running' }]));
        expect(s.queueLength).toBe(1);

        s.enqueue(makeCommand([{ status: 'running' }]));
        expect(s.queueLength).toBe(2);

        // first advance: first command becomes active (dequeued), queueLength drops
        s.advance(SNAPSHOT, TICK, {}, makeContext());
        expect(s.queueLength).toBe(1);
    });

    it('isIdle becomes true again when the last command finishes', () => {
        const s = new CommandSchedulerImpl();
        s.enqueue(makeCommand([{ status: 'done' }]));

        s.advance(SNAPSHOT, TICK, {}, makeContext());
        expect(s.isIdle).toBe(true);
    });

    // ── advance happy path ────────────────────────────────────────────────

    it('calls onStart then onTick on the first advance', () => {
        const cmd = makeCommand([{ status: 'running' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);

        s.advance(SNAPSHOT, TICK, {}, makeContext());

        expect(cmd.onStart).toHaveBeenCalledTimes(1);
        expect(cmd.onTick).toHaveBeenCalledTimes(1);
    });

    it('does not call onStart again on subsequent advances', () => {
        const cmd = makeCommand([{ status: 'running' }, { status: 'running' }, { status: 'done' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        const ctx = makeContext();

        s.advance(SNAPSHOT, TICK, {}, ctx);
        s.advance(SNAPSHOT, TICK + 1, {}, ctx);
        s.advance(SNAPSHOT, TICK + 2, {}, ctx);

        expect(cmd.onStart).toHaveBeenCalledTimes(1);
        expect(cmd.onTick).toHaveBeenCalledTimes(3);
    });

    it('calls onEnd (not onFail) when onTick returns done', () => {
        const cmd = makeCommand([{ status: 'done' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);

        s.advance(SNAPSHOT, TICK, {}, makeContext());

        expect(cmd.onEnd).toHaveBeenCalledTimes(1);
        expect(cmd.onFail).not.toHaveBeenCalled();
    });

    it('calls onFail (not onEnd) when onTick returns failed', () => {
        const cmd = makeCommand([{ status: 'failed', reason: 'target lost' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);

        s.advance(SNAPSHOT, TICK, {}, makeContext());

        expect(cmd.onFail).toHaveBeenCalledTimes(1);
        expect(cmd.onFail).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            'target lost',
        );
        expect(cmd.onEnd).not.toHaveBeenCalled();
    });

    it('advances to the next command after the first completes', () => {
        const cmd1 = makeCommand([{ status: 'done' }]);
        const cmd2 = makeCommand([{ status: 'done' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd1);
        s.enqueue(cmd2);
        const ctx = makeContext();

        // tick 1: cmd1 starts and finishes
        s.advance(SNAPSHOT, TICK, {}, ctx);
        expect(cmd1.onStart).toHaveBeenCalledTimes(1);
        expect(cmd1.onEnd).toHaveBeenCalledTimes(1);
        expect(cmd2.onStart).not.toHaveBeenCalled();

        // tick 2: cmd2 starts and finishes
        s.advance(SNAPSHOT, TICK + 1, {}, ctx);
        expect(cmd2.onStart).toHaveBeenCalledTimes(1);
        expect(cmd2.onEnd).toHaveBeenCalledTimes(1);
        expect(s.isIdle).toBe(true);
    });

    it('does nothing when advance is called on an empty scheduler', () => {
        const s = new CommandSchedulerImpl();
        expect(() => s.advance(SNAPSHOT, TICK, {}, makeContext())).not.toThrow();
        expect(s.isIdle).toBe(true);
    });

    // ── enqueueNext (interrupt path) ──────────────────────────────────────

    it('enqueueNext inserts at front — runs before already-queued commands', () => {
        const cmdA = makeCommand([{ status: 'done' }]);
        const cmdB = makeCommand([{ status: 'done' }]);
        const cmdUrgent = makeCommand([{ status: 'done' }]);

        const s = new CommandSchedulerImpl();
        s.enqueue(cmdA);
        s.enqueue(cmdB);
        s.enqueueNext(cmdUrgent); // jumps ahead of cmdA and cmdB

        const ctx = makeContext();
        s.advance(SNAPSHOT, TICK, {}, ctx); // urgent runs first
        expect(cmdUrgent.onStart).toHaveBeenCalledTimes(1);
        expect(cmdA.onStart).not.toHaveBeenCalled();

        s.advance(SNAPSHOT, TICK + 1, {}, ctx); // cmdA runs next
        expect(cmdA.onStart).toHaveBeenCalledTimes(1);
        expect(cmdB.onStart).not.toHaveBeenCalled();
    });

    // ── abort ─────────────────────────────────────────────────────────────

    it('abort calls onFail on the active command with the given reason', () => {
        const cmd = makeCommand([{ status: 'running' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        const ctx = makeContext();

        s.advance(SNAPSHOT, TICK, {}, ctx); // activate cmd
        s.abort('timeout', SNAPSHOT, {}, ctx);

        expect(cmd.onFail).toHaveBeenCalledTimes(1);
        expect(cmd.onFail).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            'timeout',
        );
    });

    it('abort discards all queued commands and isIdle becomes true', () => {
        const s = new CommandSchedulerImpl();
        s.enqueue(makeCommand([{ status: 'running' }]));
        s.enqueue(makeCommand([{ status: 'running' }]));
        const ctx = makeContext();

        s.advance(SNAPSHOT, TICK, {}, ctx); // first command becomes active
        s.abort('game_ended', SNAPSHOT, {}, ctx);

        expect(s.isIdle).toBe(true);
        expect(s.queueLength).toBe(0);
    });

    it('abort with no active command still clears the queue and leaves isIdle true', () => {
        const s = new CommandSchedulerImpl();
        s.enqueue(makeCommand([{ status: 'running' }]));
        s.enqueue(makeCommand([{ status: 'running' }]));

        s.abort('cancelled', SNAPSHOT, {}, makeContext());

        expect(s.isIdle).toBe(true);
    });

    // ── clearQueue ────────────────────────────────────────────────────────

    it('clearQueue removes pending commands but does not affect active command', () => {
        const cmdActive = makeCommand([{ status: 'running' }]);
        const cmdPending = makeCommand([{ status: 'running' }]);
        const s = new CommandSchedulerImpl();
        s.enqueue(cmdActive);
        s.enqueue(cmdPending);

        s.advance(SNAPSHOT, TICK, {}, makeContext()); // cmdActive becomes active
        s.clearQueue();

        expect(s.queueLength).toBe(0);
        expect(s.isIdle).toBe(false); // still has active command
    });

    // ── Invariant #18: params are frozen ──────────────────────────────────

    it('passes frozen params to onStart (Invariant #18)', () => {
        let receivedParams: AIParams | undefined;
        const cmd: AnyAICommand = {
            type: 'test:freeze-start',
            payload: {},
            onStart: vi.fn().mockImplementation((_snap: unknown, params: AIParams) => {
                receivedParams = params;
            }),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'running' }),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        s.advance(SNAPSHOT, TICK, { aggression: 3 }, makeContext());

        expect(Object.isFrozen(receivedParams)).toBe(true);
    });

    it('passes frozen params to onTick (Invariant #18)', () => {
        let receivedParams: AIParams | undefined;
        const cmd: AnyAICommand = {
            type: 'test:freeze-tick',
            payload: {},
            onStart: vi.fn(),
            onTick: vi
                .fn()
                .mockImplementation(
                    (_snap: unknown, _tick: unknown, params: AIParams): CommandProgress => {
                        receivedParams = params;
                        return { status: 'done' };
                    },
                ),
            onEnd: vi.fn(),
            onFail: vi.fn(),
        };
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        s.advance(SNAPSHOT, TICK, { aggression: 3 }, makeContext());

        expect(Object.isFrozen(receivedParams)).toBe(true);
    });

    it('passes frozen params to onEnd (Invariant #18)', () => {
        let receivedParams: AIParams | undefined;
        const cmd: AnyAICommand = {
            type: 'test:freeze-end',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'done' }),
            onEnd: vi.fn().mockImplementation((_snap: unknown, params: AIParams) => {
                receivedParams = params;
            }),
            onFail: vi.fn(),
        };
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        s.advance(SNAPSHOT, TICK, { aggression: 3 }, makeContext());

        expect(Object.isFrozen(receivedParams)).toBe(true);
    });

    it('passes frozen params to onFail on failed progress (Invariant #18)', () => {
        let receivedParams: AIParams | undefined;
        const cmd: AnyAICommand = {
            type: 'test:freeze-fail',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({
                status: 'failed',
                reason: 'err',
            }),
            onEnd: vi.fn(),
            onFail: vi.fn().mockImplementation((_snap: unknown, params: AIParams) => {
                receivedParams = params;
            }),
        };
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        s.advance(SNAPSHOT, TICK, { aggression: 3 }, makeContext());

        expect(Object.isFrozen(receivedParams)).toBe(true);
    });

    it('passes frozen params to onFail via abort (Invariant #18)', () => {
        let receivedParams: AIParams | undefined;
        const cmd: AnyAICommand = {
            type: 'test:freeze-abort',
            payload: {},
            onStart: vi.fn(),
            onTick: vi.fn<() => CommandProgress>().mockReturnValue({ status: 'running' }),
            onEnd: vi.fn(),
            onFail: vi.fn().mockImplementation((_snap: unknown, params: AIParams) => {
                receivedParams = params;
            }),
        };
        const s = new CommandSchedulerImpl();
        s.enqueue(cmd);
        const ctx = makeContext();
        s.advance(SNAPSHOT, TICK, {}, ctx); // activate
        s.abort('test', SNAPSHOT, { aggression: 7 }, ctx);

        expect(Object.isFrozen(receivedParams)).toBe(true);
    });
});
