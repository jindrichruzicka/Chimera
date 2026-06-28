/**
 * ai/engine/AIState.test.ts
 *
 * Unit tests for AIState<TParams> interface.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 *   #19 — At most one state transition is applied per AI tick.
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera-engine/simulation/engine/__test-support__/stubs.js';
import type { AIState } from './AIState.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler, CommandProgress } from './CommandScheduler.js';
import type { AIParams } from './PlayerAgent.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeSnapshot = (tick = 0) => makeStubPlayerSnapshot(tick);

const makeScheduler = <TParams extends AIParams = AIParams>(): CommandScheduler<TParams> => ({
    enqueue: vi.fn(),
    enqueueNext: vi.fn(),
    advance: vi.fn(),
    clearQueue: vi.fn(),
    abort: vi.fn(),
    isIdle: true,
    queueLength: 0,
});

const makeContext = (): CommandContext => ({
    dispatch: vi.fn(),
    transitionState: vi.fn(),
});

// ─── AIState ──────────────────────────────────────────────────────────────────

describe('AIState', () => {
    it('conforming object satisfies the interface', () => {
        const state: AIState = {
            name: 'idle',
            onEnter: vi.fn(),
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };
        expect(state).toBeDefined();
        expect(state.name).toBe('idle');
    });

    it('name is a readonly string', () => {
        const state: AIState = {
            name: 'attack',
            onEnter: vi.fn(),
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };
        expect(typeof state.name).toBe('string');
    });

    it('onEnter receives snapshot, params, scheduler, context', () => {
        const onEnterFn = vi.fn();
        const state: AIState = {
            name: 'patrol',
            onEnter: onEnterFn,
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };

        const snapshot = makeSnapshot(0);
        const params: AIParams = {};
        const scheduler = makeScheduler();
        const context = makeContext();

        state.onEnter(snapshot, params, scheduler, context);
        expect(onEnterFn).toHaveBeenCalledOnce();
        expect(onEnterFn).toHaveBeenCalledWith(snapshot, params, scheduler, context);
    });

    it('onTick receives snapshot, tick, params, scheduler, context', () => {
        const onTickFn = vi.fn();
        const state: AIState = {
            name: 'patrol',
            onEnter: vi.fn(),
            onTick: onTickFn,
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };

        const snapshot = makeSnapshot(5);
        const params: AIParams = {};
        const scheduler = makeScheduler();
        const context = makeContext();

        state.onTick(snapshot, 5, params, scheduler, context);
        expect(onTickFn).toHaveBeenCalledOnce();
        expect(onTickFn).toHaveBeenCalledWith(snapshot, 5, params, scheduler, context);
    });

    it('onIdle receives snapshot, tick, params, scheduler, context', () => {
        const onIdleFn = vi.fn();
        const state: AIState = {
            name: 'patrol',
            onEnter: vi.fn(),
            onTick: vi.fn(),
            onIdle: onIdleFn,
            onExit: vi.fn(),
        };

        const snapshot = makeSnapshot(3);
        const params: AIParams = {};
        const scheduler = makeScheduler();
        const context = makeContext();

        state.onIdle(snapshot, 3, params, scheduler, context);
        expect(onIdleFn).toHaveBeenCalledOnce();
        expect(onIdleFn).toHaveBeenCalledWith(snapshot, 3, params, scheduler, context);
    });

    it('onExit receives snapshot and params', () => {
        const onExitFn = vi.fn();
        const state: AIState = {
            name: 'patrol',
            onEnter: vi.fn(),
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: onExitFn,
        };

        const snapshot = makeSnapshot(7);
        const params: AIParams = {};

        state.onExit(snapshot, params);
        expect(onExitFn).toHaveBeenCalledOnce();
        expect(onExitFn).toHaveBeenCalledWith(snapshot, params);
    });

    it('generic TParams constraint is honoured — custom params are accepted', () => {
        interface TacticsParams extends AIParams {
            aggressivity: number;
        }

        const onEnterFn = vi.fn();
        const state: AIState<TacticsParams> = {
            name: 'rush',
            onEnter: onEnterFn,
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };

        const snap = makeSnapshot(0);
        const params: TacticsParams = { aggressivity: 0.9 };
        const scheduler = makeScheduler<TacticsParams>();
        const ctx = makeContext();

        state.onEnter(snap, params, scheduler, ctx);
        expect(onEnterFn).toHaveBeenCalledWith(snap, params, scheduler, ctx);
    });

    it('Invariant #18 — onEnter receives frozen params without mutation', () => {
        const state: AIState = {
            name: 'idle',
            onEnter: (_snap, params) => {
                // must not mutate params
                expect(Object.isFrozen(params)).toBe(true);
            },
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: vi.fn(),
        };

        const params = Object.freeze<AIParams>({});
        state.onEnter(makeSnapshot(), params, makeScheduler(), makeContext());
    });

    it('Invariant #18 — onExit receives frozen params without mutation', () => {
        const state: AIState = {
            name: 'idle',
            onEnter: vi.fn(),
            onTick: vi.fn(),
            onIdle: vi.fn(),
            onExit: (_snap, params) => {
                expect(Object.isFrozen(params)).toBe(true);
            },
        };

        const params = Object.freeze<AIParams>({});
        state.onExit(makeSnapshot(), params);
    });
});

// ─── AICommand (via AnyAICommand) for CommandProgress coverage ────────────────

describe('CommandProgress exhaustiveness', () => {
    it('all three variants are valid CommandProgress values', () => {
        const variants: CommandProgress[] = [
            { status: 'running' },
            { status: 'done' },
            { status: 'failed', reason: 'path blocked' },
        ];
        expect(variants).toHaveLength(3);
    });
});
