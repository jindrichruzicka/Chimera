/**
 * ai/engine/AgentManager.test.ts
 *
 * Unit tests for AgentManager — tick fan-out coordinator.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F22 (issue #413)
 *
 * Invariants upheld:
 *   #17 — AgentManager.tickAll() calls projector.project() for each agent;
 *          AI players receive a PlayerSnapshot, never the raw GameSnapshot.
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playerId } from '@chimera/simulation/engine/types.js';
import type { PlayerAgent, PlayerSnapshot, GameResult } from './PlayerAgent.js';
import { HumanPlayerAgent } from './PlayerAgent.js';
import { AgentManager } from './AgentManager.js';
import type { StateProjector } from './AgentManager.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const p1 = playerId('p1');
const p2 = playerId('p2');

const makeSnapshot = (tick = 0): PlayerSnapshot => ({ tick });

const makeFullState = (): BaseGameSnapshot => ({
    tick: 1,
    seed: 0,
    players: {},
    entities: {},
    phase: 'playing' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber: 0,
    timers: {},
});

const makeResult = (): GameResult => ({ winner: null });

const makeProjector = (): StateProjector => ({
    project: vi.fn(() => makeSnapshot()),
});

const makeAiAgent = (id = p1): PlayerAgent => ({
    playerId: id,
    kind: 'ai',
    onTick: vi.fn(),
    onGameStart: vi.fn(),
    onGameEnd: vi.fn(),
});

// ─── AgentManager ─────────────────────────────────────────────────────────────

describe('AgentManager', () => {
    let manager: AgentManager;

    beforeEach(() => {
        manager = new AgentManager();
    });

    // ── registerAgent ─────────────────────────────────────────────────────────

    describe('registerAgent', () => {
        it('registers an agent', () => {
            const agent = makeAiAgent(p1);
            expect(() => manager.registerAgent(agent)).not.toThrow();
        });

        it('registering same playerId twice is a no-op and logs a warning', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p1);

            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            expect(warnSpy).toHaveBeenCalledOnce();
            warnSpy.mockRestore();
        });

        it('duplicate registration keeps the first entry', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p1);

            manager.registerAgent(agent1);
            manager.registerAgent(agent2);
            manager.tickAll(makeFullState(), 1, projector);

            // onTick should be called on agent1 (the kept entry), not agent2
            expect(agent1.onTick).toHaveBeenCalledOnce();
            expect(agent2.onTick).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    // ── tickAll ───────────────────────────────────────────────────────────────

    describe('tickAll', () => {
        it('calls projector.project() once per registered agent per tick', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.tickAll(makeFullState(), 1, projector);

            expect(projector.project).toHaveBeenCalledTimes(2);
        });

        it('calls projector.project() with the full state and the agent playerId', () => {
            const projector = makeProjector();
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);
            const fullState = makeFullState();

            manager.tickAll(fullState, 1, projector);

            expect(projector.project).toHaveBeenCalledWith(fullState, p1);
        });

        it('calls agent.onTick with projected snapshot and tick for every agent', () => {
            const snapshot = makeSnapshot(5);
            const projector: StateProjector = { project: vi.fn(() => snapshot) };
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);

            manager.tickAll(makeFullState(), 5, projector);

            expect(agent.onTick).toHaveBeenCalledWith(snapshot, 5);
        });

        it('fans out to all registered agents', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.tickAll(makeFullState(), 1, projector);

            expect(agent1.onTick).toHaveBeenCalledOnce();
            expect(agent2.onTick).toHaveBeenCalledOnce();
        });

        it('does nothing when no agents are registered', () => {
            const projector = makeProjector();
            expect(() => manager.tickAll(makeFullState(), 1, projector)).not.toThrow();
            expect(projector.project).not.toHaveBeenCalled();
        });

        it('calls projector.project() for human agents too (uniform fan-out)', () => {
            const projector = makeProjector();
            const humanAgent = new HumanPlayerAgent(p1);
            manager.registerAgent(humanAgent);

            manager.tickAll(makeFullState(), 1, projector);

            expect(projector.project).toHaveBeenCalledOnce();
        });
    });

    // ── onGameStart ───────────────────────────────────────────────────────────

    describe('onGameStart', () => {
        it('fans out to all agents', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.onGameStart(makeFullState(), projector);

            expect(agent1.onGameStart).toHaveBeenCalledOnce();
            expect(agent2.onGameStart).toHaveBeenCalledOnce();
        });

        it('calls projector.project() for each agent', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.onGameStart(makeFullState(), projector);

            expect(projector.project).toHaveBeenCalledTimes(2);
        });

        it('passes projected snapshot to agent.onGameStart', () => {
            const snapshot = makeSnapshot(0);
            const projector: StateProjector = { project: vi.fn(() => snapshot) };
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);

            manager.onGameStart(makeFullState(), projector);

            expect(agent.onGameStart).toHaveBeenCalledWith(snapshot);
        });
    });

    // ── onGameEnd ─────────────────────────────────────────────────────────────

    describe('onGameEnd', () => {
        it('fans out to all agents with result', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);
            const result = makeResult();

            manager.onGameEnd(makeFullState(), result, projector);

            expect(agent1.onGameEnd).toHaveBeenCalledWith(expect.anything(), result);
            expect(agent2.onGameEnd).toHaveBeenCalledWith(expect.anything(), result);
        });

        it('calls projector.project() for each agent', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.onGameEnd(makeFullState(), makeResult(), projector);

            expect(projector.project).toHaveBeenCalledTimes(2);
        });

        it('passes projected snapshot to agent.onGameEnd', () => {
            const snapshot = makeSnapshot(99);
            const projector: StateProjector = { project: vi.fn(() => snapshot) };
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);
            const result = makeResult();

            manager.onGameEnd(makeFullState(), result, projector);

            expect(agent.onGameEnd).toHaveBeenCalledWith(snapshot, result);
        });
    });
});
