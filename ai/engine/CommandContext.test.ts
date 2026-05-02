/**
 * ai/engine/CommandContext.test.ts
 *
 * Unit tests for CommandContext interface.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F23 (issue #418)
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline (dispatch bridge).
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import { type EngineAction, playerId } from '@chimera/simulation/engine/types.js';
import type { CommandContext } from './CommandContext.js';

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
