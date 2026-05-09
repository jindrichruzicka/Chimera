/**
 * ai/engine/PlayerAgent.test.ts
 *
 * Unit tests for PlayerAgent interface, HumanPlayerAgent, and AIPlayerAgent.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F22 (issue #412)
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import { playerId } from '@chimera/simulation/engine/types.js';
import { AIBrain } from './AIBrain.js';
import type { AIStateMachine } from './AIStateMachine.js';
import type { CommandContext } from './CommandContext.js';
import type { CommandScheduler } from './CommandScheduler.js';
import {
    type PlayerAgent,
    type PlayerSnapshot,
    type GameResult,
    HumanPlayerAgent,
    AIPlayerAgent,
} from './PlayerAgent.js';

const p1 = playerId('p1');

const makeSnapshot = (tick = 0): PlayerSnapshot => makeStubPlayerSnapshot(tick);

const makeResult = (): GameResult => ({ winnerIds: [] });

// ─── HumanPlayerAgent ─────────────────────────────────────────────────────────

describe('HumanPlayerAgent', () => {
    it('has kind "human"', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.kind).toBe('human');
    });

    it('stores playerId', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.playerId).toBe(p1);
    });

    it('is not omniscient', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.omniscient).toBe(false);
    });

    it('satisfies the PlayerAgent interface', () => {
        const agent: PlayerAgent = new HumanPlayerAgent(p1);
        expect(agent).toBeDefined();
    });

    it('onTick is a no-op that does not throw', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(() => agent.onTick(makeSnapshot(), 1)).not.toThrow();
    });

    it('onGameStart is a no-op that does not throw', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(() => agent.onGameStart(makeSnapshot())).not.toThrow();
    });

    it('onGameEnd is a no-op that does not throw', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(() => agent.onGameEnd(makeSnapshot(), makeResult())).not.toThrow();
    });

    it('onTick returns undefined', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.onTick(makeSnapshot(), 0)).toBeUndefined();
    });

    it('onGameStart returns undefined', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.onGameStart(makeSnapshot())).toBeUndefined();
    });

    it('onGameEnd returns undefined', () => {
        const agent = new HumanPlayerAgent(p1);
        expect(agent.onGameEnd(makeSnapshot(), makeResult())).toBeUndefined();
    });
});

// ─── AIPlayerAgent ────────────────────────────────────────────────────────────

describe('AIPlayerAgent', () => {
    const makeStateMachine = (): AIStateMachine => ({
        registerState: vi.fn(),
        setInitialState: vi.fn(),
        transition: vi.fn(),
        tick: vi.fn(),
        get currentState(): never {
            throw new Error('no state registered in test double');
        },
    });

    const makeScheduler = (): CommandScheduler => ({
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

    const makeBrain = () => new AIBrain(makeStateMachine(), makeScheduler(), makeContext(), {});

    it('has kind "ai"', () => {
        const agent = new AIPlayerAgent(p1, makeBrain());
        expect(agent.kind).toBe('ai');
    });

    it('stores playerId', () => {
        const agent = new AIPlayerAgent(p1, makeBrain());
        expect(agent.playerId).toBe(p1);
    });

    it('is not omniscient by default', () => {
        const agent = new AIPlayerAgent(p1, makeBrain());
        expect(agent.omniscient).toBe(false);
    });

    it('can opt in to omniscient mode through constructor options', () => {
        const agent = new AIPlayerAgent(p1, makeBrain(), { omniscient: true });
        expect(agent.omniscient).toBe(true);
    });

    it('satisfies the PlayerAgent interface', () => {
        const agent: PlayerAgent = new AIPlayerAgent(p1, makeBrain());
        expect(agent).toBeDefined();
    });

    it('onTick delegates to brain.tick with the same snapshot and tick number', () => {
        const brain = makeBrain();
        const tickSpy = vi.spyOn(brain, 'tick');
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(42);

        agent.onTick(snapshot, 42);

        expect(tickSpy).toHaveBeenCalledOnce();
        expect(tickSpy).toHaveBeenCalledWith(snapshot, 42);
    });

    it('onGameStart delegates to brain.onGameStart with the same snapshot', () => {
        const brain = makeBrain();
        const onGameStartSpy = vi.spyOn(brain, 'onGameStart');
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(5);

        agent.onGameStart(snapshot);

        expect(onGameStartSpy).toHaveBeenCalledOnce();
        expect(onGameStartSpy).toHaveBeenCalledWith(snapshot);
    });

    it('onGameEnd delegates to brain.onGameEnd with the same snapshot and result', () => {
        const brain = makeBrain();
        const onGameEndSpy = vi.spyOn(brain, 'onGameEnd');
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(100);
        const result: GameResult = { winnerIds: [p1] };

        agent.onGameEnd(snapshot, result);

        expect(onGameEndSpy).toHaveBeenCalledOnce();
        expect(onGameEndSpy).toHaveBeenCalledWith(snapshot, result);
    });

    it('onTick does not call brain.onGameStart or brain.onGameEnd', () => {
        const brain = makeBrain();
        const onGameStartSpy = vi.spyOn(brain, 'onGameStart');
        const onGameEndSpy = vi.spyOn(brain, 'onGameEnd');
        const agent = new AIPlayerAgent(p1, brain);

        agent.onTick(makeSnapshot(), 0);

        expect(onGameStartSpy).not.toHaveBeenCalled();
        expect(onGameEndSpy).not.toHaveBeenCalled();
    });

    it('onGameStart does not call brain.tick or brain.onGameEnd', () => {
        const brain = makeBrain();
        const tickSpy = vi.spyOn(brain, 'tick');
        const onGameEndSpy = vi.spyOn(brain, 'onGameEnd');
        const agent = new AIPlayerAgent(p1, brain);

        agent.onGameStart(makeSnapshot());

        expect(tickSpy).not.toHaveBeenCalled();
        expect(onGameEndSpy).not.toHaveBeenCalled();
    });

    it('onGameEnd does not call brain.tick or brain.onGameStart', () => {
        const brain = makeBrain();
        const tickSpy = vi.spyOn(brain, 'tick');
        const onGameStartSpy = vi.spyOn(brain, 'onGameStart');
        const agent = new AIPlayerAgent(p1, brain);

        agent.onGameEnd(makeSnapshot(), makeResult());

        expect(tickSpy).not.toHaveBeenCalled();
        expect(onGameStartSpy).not.toHaveBeenCalled();
    });
});
