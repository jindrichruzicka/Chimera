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
import { AIStateMachineImpl } from './AIStateMachine.js';
import type { AIStateMachine } from './AIStateMachine.js';
import { CommandContextImpl } from './CommandContext.js';
import type { AIParams, PlayerSnapshot, GameResult } from './AITypes.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { AIState } from './AIState.js';
import { CommandSchedulerImpl } from './CommandScheduler.js';

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

// ─── Integration: CommandContextImpl + AIStateMachineImpl (Invariant #19) ───────

describe('Integration: Deferred state transitions (Invariant #19)', () => {
    /**
     * Integration test combining CommandContextImpl + AIStateMachineImpl.
     *
     * Addresses WARN-2 from code review: "No integration test combining
     * CommandContextImpl + AIStateMachineImpl for end-to-end Invariant #19."
     *
     * Verifies that when a state calls context.transitionState(), the transition
     * is deferred and applied on the next tick() call, ensuring the two
     * deferred-transition buffers (AIStateMachineImpl.pendingTransition and
     * CommandContextImpl.pendingTransition) are properly wired.
     *
     * Architecture reference: §4.9 — AI Framework, Invariant #19.
     * Risk mitigation: Integration test exercises the full path from onTick through
     *                  next tick's transition application, preventing misuse of
     *                  CommandContextImpl where a developer calls transitionState()
     *                  without calling applyPendingTransition().
     */
    it('defers state transition to next tick when context.transitionState() is called in onTick', () => {
        // ── Arrange ────────────────────────────────────────────────────────────
        const params: TestParams = { aggressiveness: 5 };
        const snapshot: PlayerSnapshot = { tick: 0 };
        const scheduler = new CommandSchedulerImpl<TestParams>();

        // Track which states are entered/exited and when
        const lifecycle: string[] = [];

        // State A: Calls context.transitionState('stateB') on first tick
        const stateA: AIState<TestParams> = {
            name: 'stateA',
            onEnter: () => {
                lifecycle.push('A.onEnter');
            },
            onTick: (snap, tick, _params, _sched, ctx) => {
                lifecycle.push(`A.onTick(tick=${tick})`);
                if (tick === 0) {
                    // Request transition to stateB during tick 0
                    ctx.transitionState('stateB');
                }
            },
            onIdle: () => {
                lifecycle.push('A.onIdle');
            },
            onExit: () => {
                lifecycle.push('A.onExit');
            },
        };

        // State B: Just logs its lifecycle
        const stateB: AIState<TestParams> = {
            name: 'stateB',
            onEnter: () => {
                lifecycle.push('B.onEnter');
            },
            onTick: (snap, tick) => {
                lifecycle.push(`B.onTick(tick=${tick})`);
            },
            onIdle: () => {
                lifecycle.push('B.onIdle');
            },
            onExit: () => {
                lifecycle.push('B.onExit');
            },
        };

        // Create a real state machine with CommandContextImpl
        const machine = new AIStateMachineImpl<TestParams>();
        machine.registerState(stateA);
        machine.registerState(stateB);

        // Create a real CommandContextImpl
        const dispatchSpy = vi.fn();
        const transitionSpy = vi.fn();
        const context = new CommandContextImpl(dispatchSpy, transitionSpy);

        // ── Act ────────────────────────────────────────────────────────────────
        // Initialize with stateA
        machine.setInitialState('stateA', snapshot, params, scheduler, context);
        expect(machine.currentState.name).toBe('stateA');

        // Tick 0: stateA.onTick calls context.transitionState('stateB')
        // The transition should be buffered, not applied yet
        machine.tick(snapshot, 0, params, scheduler, context);
        expect(machine.currentState.name).toBe('stateA');
        expect(lifecycle).toContain('A.onTick(tick=0)');
        expect(lifecycle).not.toContain('A.onExit');
        expect(lifecycle).not.toContain('B.onEnter');

        // Tick 1: The pending transition should be applied at the start
        // This should call A.onExit, then B.onEnter
        machine.tick(snapshot, 1, params, scheduler, context);
        expect(machine.currentState.name).toBe('stateB');
        const a_onExit_idx = lifecycle.indexOf('A.onExit');
        const b_onEnter_idx = lifecycle.indexOf('B.onEnter');
        expect(a_onExit_idx).toBeGreaterThan(-1);
        expect(b_onEnter_idx).toBeGreaterThan(-1);
        expect(a_onExit_idx).toBeLessThan(b_onEnter_idx); // onExit before onEnter
        expect(lifecycle).toContain('B.onTick(tick=1)');

        // ── Assert ─────────────────────────────────────────────────────────────
        // Verify the full lifecycle sequence
        expect(lifecycle).toEqual([
            'A.onEnter', // setInitialState
            'A.onIdle', // tick(0): scheduler is idle at start of first tick
            'A.onTick(tick=0)', // tick 0
            'A.onExit', // transition applied at start of tick 1
            'B.onEnter', // transition applied at start of tick 1
            'B.onIdle', // tick 1 (scheduler is idle)
            'B.onTick(tick=1)', // tick 1
        ]);
    });
});
