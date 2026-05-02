/**
 * ai/engine/AIBrain.test.ts
 *
 * Unit tests for AIBrain<TParams> facade.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #420)
 *
 * Tests written first (TDD — red confirmed before implementation).
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline; no direct
 *          mutation path is exposed by AIBrain.
 *   #18 — AIParams are frozen in the constructor.
 */

import { describe, it, expect, vi } from 'vitest';
import { AIBrain } from './AIBrain.js';
import type { AIStateMachine } from './AIStateMachine.js';
import type { AIParams, PlayerSnapshot, GameResult } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

interface TestParams extends AIParams {
    readonly aggressiveness: number;
}

const makeParams = (): TestParams => ({ aggressiveness: 5 });

const makeSnapshot = (tick = 0): PlayerSnapshot => ({ tick });

const makeResult = (): GameResult => ({ winner: null });

const makeStateMachine = (): AIStateMachine<TestParams> => ({
    registerState: vi.fn(),
    setInitialState: vi.fn(),
    transition: vi.fn(),
    tick: vi.fn(),
    get currentState(): never {
        throw new Error('no state registered in test double');
    },
});

const makeScheduler = (): CommandScheduler<TestParams> => ({
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

// ─── AIBrain ──────────────────────────────────────────────────────────────────

describe('AIBrain', () => {
    it('freezes params in the constructor (Invariant #18)', () => {
        const params = makeParams();
        const brain = new AIBrain(makeStateMachine(), makeScheduler(), makeContext(), params);
        expect(Object.isFrozen(brain.params)).toBe(true);
    });

    it('stores a frozen copy that still has the original values', () => {
        const params = makeParams();
        const brain = new AIBrain(makeStateMachine(), makeScheduler(), makeContext(), params);
        expect(brain.params.aggressiveness).toBe(5);
    });

    describe('onGameStart', () => {
        it('delegates to stateMachine.tick with tick=0', () => {
            const sm = makeStateMachine();
            const scheduler = makeScheduler();
            const context = makeContext();
            const params = makeParams();
            const brain = new AIBrain(sm, scheduler, context, params);
            const snapshot = makeSnapshot(0);

            brain.onGameStart(snapshot);

            expect(sm.tick).toHaveBeenCalledOnce();
            expect(sm.tick).toHaveBeenCalledWith(snapshot, 0, brain.params, scheduler, context);
        });
    });

    describe('tick', () => {
        it('delegates to stateMachine.tick with the given tick number', () => {
            const sm = makeStateMachine();
            const scheduler = makeScheduler();
            const context = makeContext();
            const params = makeParams();
            const brain = new AIBrain(sm, scheduler, context, params);
            const snapshot = makeSnapshot(7);

            brain.tick(snapshot, 7);

            expect(sm.tick).toHaveBeenCalledOnce();
            expect(sm.tick).toHaveBeenCalledWith(snapshot, 7, brain.params, scheduler, context);
        });
    });

    describe('onGameEnd', () => {
        it('calls scheduler.abort with reason "game_ended"', () => {
            const sm = makeStateMachine();
            const scheduler = makeScheduler();
            const context = makeContext();
            const params = makeParams();
            const brain = new AIBrain(sm, scheduler, context, params);
            const snapshot = makeSnapshot(10);
            const result = makeResult();

            brain.onGameEnd(snapshot, result);

            expect(scheduler.abort).toHaveBeenCalledOnce();
            expect(scheduler.abort).toHaveBeenCalledWith(
                'game_ended',
                snapshot,
                brain.params,
                context,
            );
        });

        it('does not call stateMachine.tick on game end', () => {
            const sm = makeStateMachine();
            const scheduler = makeScheduler();
            const brain = new AIBrain(sm, scheduler, makeContext(), makeParams());

            brain.onGameEnd(makeSnapshot(), makeResult());

            expect(sm.tick).not.toHaveBeenCalled();
        });
    });
});
