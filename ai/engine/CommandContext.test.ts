/**
 * ai/engine/CommandContext.test.ts
 *
 * Unit tests for CommandContext interface and CommandContextImpl.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418), F24 (issue #424)
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline (dispatch bridge).
 *   #19 — At most one state transition is applied per AI tick (last-wins buffer).
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@chimera/simulation/foundation/logging.js';
import { type EngineAction, playerId } from '@chimera/simulation/engine/types.js';
import { type CommandContext, CommandContextImpl } from './CommandContext.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const makeLogger = (): Logger => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(function (this: Logger) {
        return this;
    }),
});

// ─── CommandContext ────────────────────────────────────────────────────────────

describe('CommandContext', () => {
    it('conforming object satisfies the interface', () => {
        const ctx: CommandContext = {
            dispatch: vi.fn(),
            transitionState: vi.fn(),
        };
        expect(ctx).toBeDefined();
    });

    it('dispatch is callable with an EngineAction-shaped argument', () => {
        const dispatchFn = vi.fn();
        const ctx: CommandContext = {
            dispatch: dispatchFn,
            transitionState: vi.fn(),
        };

        const action: EngineAction = {
            type: 'engine:tick',
            playerId: playerId('p1'),
            tick: 0,
            payload: {},
        };
        ctx.dispatch(action);
        expect(dispatchFn).toHaveBeenCalledOnce();
        expect(dispatchFn).toHaveBeenCalledWith(action);
    });

    it('transitionState is callable with a state name string', () => {
        const transitionFn = vi.fn();
        const ctx: CommandContext = {
            dispatch: vi.fn(),
            transitionState: transitionFn,
        };

        ctx.transitionState('idle');
        expect(transitionFn).toHaveBeenCalledOnce();
        expect(transitionFn).toHaveBeenCalledWith('idle');
    });

    it('transitionState forwards arbitrary state names', () => {
        const transitionFn = vi.fn();
        const ctx: CommandContext = {
            dispatch: vi.fn(),
            transitionState: transitionFn,
        };

        ctx.transitionState('attack');
        ctx.transitionState('retreat');
        expect(transitionFn).toHaveBeenCalledTimes(2);
        expect(transitionFn).toHaveBeenNthCalledWith(1, 'attack');
        expect(transitionFn).toHaveBeenNthCalledWith(2, 'retreat');
    });
});

// ─── CommandContextImpl ───────────────────────────────────────────────────────

const makeAction = (): EngineAction => ({
    type: 'engine:tick',
    playerId: playerId('p1'),
    tick: 0,
    payload: {},
});

describe('CommandContextImpl', () => {
    it('dispatch() calls the injected dispatch callback immediately', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        const action = makeAction();
        ctx.dispatch(action);

        expect(dispatchFn).toHaveBeenCalledOnce();
        expect(dispatchFn).toHaveBeenCalledWith(action);
    });

    it('transitionState() does not call transitionCallback immediately (deferred)', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        ctx.transitionState('idle');

        expect(transitionFn).not.toHaveBeenCalled();
    });

    it('applyPendingTransition() calls transitionCallback with the buffered state name', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        ctx.transitionState('attack');
        ctx.applyPendingTransition();

        expect(transitionFn).toHaveBeenCalledOnce();
        expect(transitionFn).toHaveBeenCalledWith('attack');
    });

    it('applyPendingTransition() with no pending transition is a no-op', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        ctx.applyPendingTransition();

        expect(transitionFn).not.toHaveBeenCalled();
    });

    it('second transitionState() in same tick overwrites first and logs a warning via Logger', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const logger = makeLogger();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, logger);

        ctx.transitionState('attack');
        ctx.transitionState('retreat');

        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('last-wins: applyPendingTransition() applies only the final transitionState() request', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        ctx.transitionState('attack');
        ctx.transitionState('retreat');
        ctx.applyPendingTransition();

        expect(transitionFn).toHaveBeenCalledOnce();
        expect(transitionFn).toHaveBeenCalledWith('retreat');
    });

    it('applyPendingTransition() clears the buffer so a second flush is a no-op', () => {
        const dispatchFn = vi.fn();
        const transitionFn = vi.fn();
        const ctx = new CommandContextImpl(dispatchFn, transitionFn, makeLogger());

        ctx.transitionState('idle');
        ctx.applyPendingTransition();
        ctx.applyPendingTransition(); // second flush — buffer already cleared

        expect(transitionFn).toHaveBeenCalledOnce();
    });

    it('implements the CommandContext interface', () => {
        const ctx: CommandContext = new CommandContextImpl(vi.fn(), vi.fn(), makeLogger());
        expect(ctx).toBeDefined();
    });
});
