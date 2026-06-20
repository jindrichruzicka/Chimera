/**
 * ai/engine/AIStateMachine.test.ts
 *
 * Unit tests for AIStateMachine<TParams> interface and AIStateMachineImpl<TParams>.
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import type { Logger } from '@chimera/simulation/foundation/logging.js';
import type { AIState } from './AIState.js';
import { AIStateMachineImpl, type AIStateMachine } from './AIStateMachine.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';
import type { AIParams, PlayerSnapshot } from './AITypes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeSnapshot = (tick = 0): PlayerSnapshot => makeStubPlayerSnapshot(tick);

const makeScheduler = <TParams extends AIParams = AIParams>(
    idle = true,
): CommandScheduler<TParams> => ({
    enqueue: vi.fn(),
    enqueueNext: vi.fn(),
    advance: vi.fn(),
    clearQueue: vi.fn(),
    abort: vi.fn(),
    isIdle: idle,
    queueLength: 0,
});

const makeContext = (): CommandContext => ({
    dispatch: vi.fn(),
    transitionState: vi.fn(),
});

const makeNoopLogger = (): Logger => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis() as Logger['child'],
});

const makeState = (name: string): AIState => ({
    name,
    onEnter: vi.fn(),
    onTick: vi.fn(),
    onIdle: vi.fn(),
    onExit: vi.fn(),
});

// ─── AIStateMachineImpl ───────────────────────────────────────────────────────

describe('AIStateMachineImpl', () => {
    let machine: AIStateMachineImpl<AIParams>;
    let snapshot: PlayerSnapshot;
    let params: AIParams;
    let scheduler: CommandScheduler<AIParams>;
    let context: CommandContext;

    beforeEach(() => {
        machine = new AIStateMachineImpl<AIParams>();
        snapshot = makeSnapshot();
        params = {};
        scheduler = makeScheduler();
        context = makeContext();
    });

    // ── registerState ─────────────────────────────────────────────────────────

    describe('registerState', () => {
        it('stores a state by name so that setInitialState can retrieve it', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            expect(machine.currentState.name).toBe('idle');
        });

        it('duplicate registration overwrites silently — no throw', () => {
            const stateV1 = makeState('idle');
            const stateV2 = makeState('idle');
            machine.registerState(stateV1);
            machine.registerState(stateV2);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            expect(machine.currentState).toBe(stateV2);
        });
    });

    // ── setInitialState ───────────────────────────────────────────────────────

    describe('setInitialState', () => {
        it('calls onEnter on the named state synchronously', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            expect(vi.mocked(stateA.onEnter)).toHaveBeenCalledOnce();
        });

        it('passes snapshot, frozen-params, scheduler, and context to onEnter', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            const [snapArg, paramsArg, schedulerArg, contextArg] = vi.mocked(stateA.onEnter).mock
                .calls[0]!;
            expect(snapArg).toBe(snapshot);
            expect(Object.isFrozen(paramsArg)).toBe(true);
            expect(schedulerArg).toBe(scheduler);
            // contextArg is the wrapped context (not the raw context passed in), which defers
            // transitionState() calls through the machine's buffer (Invariant #19).
            expect(contextArg).toBeDefined();
            expect(typeof contextArg.dispatch).toBe('function');
            expect(typeof contextArg.transitionState).toBe('function');
        });

        it('sets currentState to the named state after calling onEnter', () => {
            const stateA = makeState('active');
            machine.registerState(stateA);
            machine.setInitialState('active', snapshot, params, scheduler, context);
            expect(machine.currentState).toBe(stateA);
        });

        it('does not call onExit on any state (no previous state to exit)', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            expect(vi.mocked(stateA.onExit)).not.toHaveBeenCalled();
        });

        it('throws when state name is unknown (not registered)', () => {
            expect(() => {
                machine.setInitialState('unknown', snapshot, params, scheduler, context);
            }).toThrow(/State 'unknown' is not registered/);
        });

        it('defers transition if onEnter calls context.transitionState() (Invariant #19 edge case)', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);

            // stateA.onEnter will call context.transitionState('stateB') during setInitialState
            vi.mocked(stateA.onEnter).mockImplementation((_snap, _params, _sched, ctx) => {
                ctx.transitionState('stateB');
            });

            // Call setInitialState: stateA.onEnter calls context.transitionState('stateB')
            machine.setInitialState('stateA', snapshot, params, scheduler, context);

            // Transition must have been deferred, not executed immediately
            // So stateB.onEnter must NOT have been called yet
            expect(vi.mocked(stateB.onEnter)).not.toHaveBeenCalled();
            expect(machine.currentState.name).toBe('stateA'); // Still in stateA

            // On the next tick, the buffered transition is applied
            machine.tick(snapshot, 1, params, scheduler, context);
            expect(vi.mocked(stateA.onExit)).toHaveBeenCalledOnce();
            expect(vi.mocked(stateB.onEnter)).toHaveBeenCalledOnce();
            expect(machine.currentState.name).toBe('stateB');
        });
    });

    // ── currentState ──────────────────────────────────────────────────────────

    describe('currentState', () => {
        it('throws before setInitialState has been called', () => {
            expect(() => machine.currentState).toThrow();
        });

        it('returns the active state after setInitialState', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            expect(machine.currentState).toBe(stateA);
        });
    });

    // ── transition (deferred) ─────────────────────────────────────────────────

    describe('transition', () => {
        it('defers the transition — onExit and onEnter are NOT called in the same tick as transition()', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);

            // Call transition() mid-tick (simulates game code requesting a state change)
            vi.mocked(stateA.onTick).mockImplementation(() => {
                machine.transition('stateB', snapshot, params, scheduler, context);
            });
            machine.tick(snapshot, 1, params, scheduler, context);

            // Transition has been buffered — onExit / onEnter must NOT have fired yet
            expect(vi.mocked(stateA.onExit)).not.toHaveBeenCalled();
            expect(vi.mocked(stateB.onEnter)).not.toHaveBeenCalled();
        });

        it('applies the deferred transition at the start of the next tick(): onExit old, onEnter new', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);

            vi.mocked(stateA.onTick).mockImplementation(() => {
                machine.transition('stateB', snapshot, params, scheduler, context);
            });
            machine.tick(snapshot, 1, params, scheduler, context);

            // Next tick: apply the buffered transition first
            const snapshot2 = makeSnapshot(2);
            machine.tick(snapshot2, 2, params, scheduler, context);

            expect(vi.mocked(stateA.onExit)).toHaveBeenCalledOnce();
            expect(vi.mocked(stateB.onEnter)).toHaveBeenCalledOnce();
        });

        it('after the deferred transition, the new state becomes currentState', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);
            machine.transition('stateB', snapshot, params, scheduler, context);
            machine.tick(snapshot, 1, params, scheduler, context);
            expect(machine.currentState).toBe(stateB);
        });

        it('after the deferred transition, the new state receives onTick in the same tick', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);
            machine.transition('stateB', snapshot, params, scheduler, context);
            machine.tick(snapshot, 1, params, scheduler, context);
            // stateB.onTick should have been called in this tick (after transition)
            expect(vi.mocked(stateB.onTick)).toHaveBeenCalledOnce();
        });

        it('two transition() calls in one tick — last name wins, warn is logged, onEnter called once for last state only', () => {
            const logger = makeNoopLogger();
            const machineWithLogger = new AIStateMachineImpl<AIParams>({ logger });

            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            const stateC = makeState('stateC');
            machineWithLogger.registerState(stateA);
            machineWithLogger.registerState(stateB);
            machineWithLogger.registerState(stateC);
            machineWithLogger.setInitialState('stateA', snapshot, params, scheduler, context);

            vi.mocked(stateA.onTick).mockImplementation(() => {
                machineWithLogger.transition('stateB', snapshot, params, scheduler, context);
                machineWithLogger.transition('stateC', snapshot, params, scheduler, context);
            });

            machineWithLogger.tick(snapshot, 1, params, scheduler, context);

            // warn must have been emitted on the second transition() call
            expect(logger.warn).toHaveBeenCalledOnce();

            // Apply deferred transition on next tick
            machineWithLogger.tick(snapshot, 2, params, scheduler, context);

            // stateC wins; stateB must not have been entered
            expect(vi.mocked(stateB.onEnter)).not.toHaveBeenCalled();
            expect(vi.mocked(stateC.onEnter)).toHaveBeenCalledOnce();
        });

        it('throws on the next tick when transitioning to an unknown state name', () => {
            const stateA = makeState('stateA');
            machine.registerState(stateA);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);

            // Buffer a transition to an unknown state
            machine.transition('unknownState', snapshot, params, scheduler, context);

            // The error is thrown when tick() tries to apply the buffered transition
            expect(() => {
                machine.tick(snapshot, 1, params, scheduler, context);
            }).toThrow(/State 'unknownState' is not registered/);
        });
    });

    // ── tick ──────────────────────────────────────────────────────────────────

    describe('tick', () => {
        // BLOCK-1: CommandScheduler.advance() must be called per tick
        it('calls CommandScheduler.advance() with snapshot, tick, frozen params, and context', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            machine.tick(snapshot, 5, params, scheduler, context);

            expect(vi.mocked(scheduler.advance)).toHaveBeenCalledOnce();
            const [snapArg, tickArg, paramsArg, contextArg] = vi.mocked(scheduler.advance).mock
                .calls[0]!;
            expect(snapArg).toBe(snapshot);
            expect(tickArg).toBe(5);
            expect(Object.isFrozen(paramsArg)).toBe(true);
            expect(contextArg).toBeDefined(); // wrapped context
        });

        // BLOCK-2: onIdle must be called before onTick when scheduler is idle
        it('calls onIdle before onTick when scheduler is idle', () => {
            const callOrder: string[] = [];
            const stateA = makeState('idle');
            const idleScheduler = makeScheduler(true);

            vi.mocked(stateA.onIdle).mockImplementation(() => {
                callOrder.push('onIdle');
            });
            vi.mocked(stateA.onTick).mockImplementation(() => {
                callOrder.push('onTick');
            });

            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, idleScheduler, context);
            machine.tick(snapshot, 1, params, idleScheduler, context);

            expect(callOrder).toEqual(['onIdle', 'onTick']);
        });

        it('calls AIState.onTick with snapshot, tick number, frozen params, scheduler, and a CommandContext', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            machine.tick(snapshot, 5, params, scheduler, context);

            expect(vi.mocked(stateA.onTick)).toHaveBeenCalledOnce();
            const [snapArg, tickArg, paramsArg, schedulerArg] = vi.mocked(stateA.onTick).mock
                .calls[0]!;
            expect(snapArg).toBe(snapshot);
            expect(tickArg).toBe(5);
            expect(Object.isFrozen(paramsArg)).toBe(true);
            expect(schedulerArg).toBe(scheduler);
        });

        it('calls AIState.onIdle when the scheduler is idle', () => {
            const idleScheduler = makeScheduler(true);
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, idleScheduler, context);
            machine.tick(snapshot, 1, params, idleScheduler, context);
            expect(vi.mocked(stateA.onIdle)).toHaveBeenCalledOnce();
        });

        it('does NOT call AIState.onIdle when the scheduler has active commands', () => {
            const busyScheduler = makeScheduler(false);
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, busyScheduler, context);
            machine.tick(snapshot, 1, params, busyScheduler, context);
            expect(vi.mocked(stateA.onIdle)).not.toHaveBeenCalled();
        });

        it('params passed to onTick are frozen (Invariant #18)', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);
            machine.tick(snapshot, 1, params, scheduler, context);
            const [, , paramsArg] = vi.mocked(stateA.onTick).mock.calls[0]!;
            expect(Object.isFrozen(paramsArg)).toBe(true);
        });

        it('context.transitionState() called from onTick also defers the transition (Invariant #19)', () => {
            const stateA = makeState('stateA');
            const stateB = makeState('stateB');
            machine.registerState(stateA);
            machine.registerState(stateB);
            machine.setInitialState('stateA', snapshot, params, scheduler, context);

            // Game code calls context.transitionState() from within onTick
            vi.mocked(stateA.onTick).mockImplementation((_snap, _tick, _params, _sched, ctx) => {
                ctx.transitionState('stateB');
            });

            machine.tick(snapshot, 1, params, scheduler, context);
            // Not applied yet
            expect(vi.mocked(stateA.onExit)).not.toHaveBeenCalled();

            machine.tick(snapshot, 2, params, scheduler, context);
            // Applied on next tick
            expect(vi.mocked(stateA.onExit)).toHaveBeenCalledOnce();
            expect(vi.mocked(stateB.onEnter)).toHaveBeenCalledOnce();
        });

        // Performance §13 — frozen() memoization (Fix 1)

        it('frozen params: returns the same Readonly reference when params object is unchanged across consecutive ticks', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);

            machine.tick(snapshot, 1, params, scheduler, context);
            machine.tick(snapshot, 2, params, scheduler, context);

            const [, , frozenParams1] = vi.mocked(stateA.onTick).mock.calls[0]!;
            const [, , frozenParams2] = vi.mocked(stateA.onTick).mock.calls[1]!;
            expect(frozenParams1).toBe(frozenParams2);
        });

        it('frozen params: returns a new Readonly reference when params object changes between ticks', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            const params1: AIParams = { x: 1 };
            const params2: AIParams = { x: 2 };
            machine.setInitialState('idle', snapshot, params1, scheduler, context);

            machine.tick(snapshot, 1, params1, scheduler, context);
            machine.tick(snapshot, 2, params2, scheduler, context);

            const [, , frozenParams1] = vi.mocked(stateA.onTick).mock.calls[0]!;
            const [, , frozenParams2] = vi.mocked(stateA.onTick).mock.calls[1]!;
            expect(frozenParams1).not.toBe(frozenParams2);
        });

        // Performance §13 — stable wrapped context (Fix 2)

        it('wrapped context: passes the same CommandContext object reference to onTick across consecutive ticks', () => {
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);

            machine.tick(snapshot, 1, params, scheduler, context);
            machine.tick(snapshot, 2, params, scheduler, context);

            const ctx1 = vi.mocked(stateA.onTick).mock.calls[0]![4];
            const ctx2 = vi.mocked(stateA.onTick).mock.calls[1]![4];
            expect(ctx1).toBe(ctx2);
        });

        it('wrapped context: dispatch() throws if called on a context reference captured from a completed tick', () => {
            let capturedCtx: CommandContext | undefined;
            const stateA = makeState('idle');
            machine.registerState(stateA);
            machine.setInitialState('idle', snapshot, params, scheduler, context);

            vi.mocked(stateA.onTick).mockImplementation((_snap, _tick, _params, _sched, ctx) => {
                capturedCtx = ctx;
            });
            machine.tick(snapshot, 1, params, scheduler, context);

            // Tick is complete; the proxy's live fields have been nulled out
            expect(() =>
                capturedCtx!.dispatch({} as Parameters<CommandContext['dispatch']>[0]),
            ).toThrow();
        });
    });

    // ── AIStateMachine interface type-check ───────────────────────────────────

    describe('AIStateMachine interface', () => {
        it('AIStateMachineImpl satisfies the AIStateMachine<AIParams> interface', () => {
            const typed: AIStateMachine<AIParams> = new AIStateMachineImpl<AIParams>();
            expect(typed).toBeDefined();
        });
    });
});
