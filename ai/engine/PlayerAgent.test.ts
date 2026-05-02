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
import { playerId } from '@chimera/simulation/engine/types.js';
import type { PlayerAgent, PlayerSnapshot, GameResult } from './PlayerAgent.js';
import { HumanPlayerAgent, AIPlayerAgent } from './PlayerAgent.js';

const p1 = playerId('p1');

const makeSnapshot = (tick = 0): PlayerSnapshot => ({ tick });

const makeResult = (): GameResult => ({ winner: null });

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
    const makeBrain = () => ({
        tick: vi.fn<(snapshot: PlayerSnapshot, tick: number) => void>(),
        onGameStart: vi.fn<(snapshot: PlayerSnapshot) => void>(),
        onGameEnd: vi.fn<(snapshot: PlayerSnapshot, result: GameResult) => void>(),
    });

    it('has kind "ai"', () => {
        const agent = new AIPlayerAgent(p1, makeBrain());
        expect(agent.kind).toBe('ai');
    });

    it('stores playerId', () => {
        const agent = new AIPlayerAgent(p1, makeBrain());
        expect(agent.playerId).toBe(p1);
    });

    it('satisfies the PlayerAgent interface', () => {
        const agent: PlayerAgent = new AIPlayerAgent(p1, makeBrain());
        expect(agent).toBeDefined();
    });

    it('onTick delegates to brain.tick with the same snapshot and tick number', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(42);

        agent.onTick(snapshot, 42);

        expect(brain.tick).toHaveBeenCalledOnce();
        expect(brain.tick).toHaveBeenCalledWith(snapshot, 42);
    });

    it('onGameStart delegates to brain.onGameStart with the same snapshot', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(5);

        agent.onGameStart(snapshot);

        expect(brain.onGameStart).toHaveBeenCalledOnce();
        expect(brain.onGameStart).toHaveBeenCalledWith(snapshot);
    });

    it('onGameEnd delegates to brain.onGameEnd with the same snapshot and result', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);
        const snapshot = makeSnapshot(100);
        const result: GameResult = { winner: p1 };

        agent.onGameEnd(snapshot, result);

        expect(brain.onGameEnd).toHaveBeenCalledOnce();
        expect(brain.onGameEnd).toHaveBeenCalledWith(snapshot, result);
    });

    it('onTick does not call brain.onGameStart or brain.onGameEnd', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);

        agent.onTick(makeSnapshot(), 0);

        expect(brain.onGameStart).not.toHaveBeenCalled();
        expect(brain.onGameEnd).not.toHaveBeenCalled();
    });

    it('onGameStart does not call brain.tick or brain.onGameEnd', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);

        agent.onGameStart(makeSnapshot());

        expect(brain.tick).not.toHaveBeenCalled();
        expect(brain.onGameEnd).not.toHaveBeenCalled();
    });

    it('onGameEnd does not call brain.tick or brain.onGameStart', () => {
        const brain = makeBrain();
        const agent = new AIPlayerAgent(p1, brain);

        agent.onGameEnd(makeSnapshot(), makeResult());

        expect(brain.tick).not.toHaveBeenCalled();
        expect(brain.onGameStart).not.toHaveBeenCalled();
    });
});
