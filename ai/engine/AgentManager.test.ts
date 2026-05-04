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
 *          Honest AI players receive a PlayerSnapshot; omniscient AI players
 *          receive fullState directly (bypassing projector).
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@chimera/shared/logging.js';
import { playerId, gamePhase } from '@chimera/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type { StateProjector } from '@chimera/simulation/projection/StateProjector.js';
import type { PlayerAgent, PlayerSnapshot, GameResult } from './PlayerAgent.js';
import { HumanPlayerAgent } from './PlayerAgent.js';
import { AgentManager } from './AgentManager.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const p1 = playerId('p1');
const p2 = playerId('p2');

const makeSnapshot = (tick = 0, viewerId = p1): PlayerSnapshot => ({
    tick,
    viewerId,
    phase: gamePhase('playing'),
    players: {},
    entities: {},
    events: [],
    commitments: Object.create(null),
    undoMeta: { canUndo: false, canRedo: false },
});

const makeFullState = (): BaseGameSnapshot => ({
    tick: 1,
    seed: 0,
    players: {},
    entities: {},
    phase: gamePhase('playing'),
    events: [],
    turnNumber: 0,
    timers: {},
});

const makeResult = (): GameResult => ({ winner: null });

const makeProjector = (): StateProjector => ({
    project: vi.fn(() => makeSnapshot()),
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

const makeAiAgent = (id = p1): PlayerAgent => ({
    playerId: id,
    kind: 'ai',
    omniscient: false,
    onTick: vi.fn(),
    onGameStart: vi.fn(),
    onGameEnd: vi.fn(),
});

const makeOmniscientAgent = (id = p1): PlayerAgent => ({
    playerId: id,
    kind: 'ai',
    omniscient: true,
    onTick: vi.fn(),
    onGameStart: vi.fn(),
    onGameEnd: vi.fn(),
});

// ─── AgentManager ─────────────────────────────────────────────────────────────

describe('AgentManager', () => {
    let manager: AgentManager;

    beforeEach(() => {
        manager = new AgentManager({ logger: makeNoopLogger() });
    });

    // ── registerAgent ─────────────────────────────────────────────────────────

    describe('registerAgent', () => {
        it('registers an agent', () => {
            const agent = makeAiAgent(p1);
            expect(() => manager.registerAgent(agent)).not.toThrow();
        });

        it('registering same playerId twice is a no-op and logs a warning via injected logger', () => {
            const logger = makeNoopLogger();
            const managerWithLogger = new AgentManager({ logger });
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p1);

            managerWithLogger.registerAgent(agent1);
            managerWithLogger.registerAgent(agent2);

            expect(logger.warn).toHaveBeenCalledOnce();
        });

        it('duplicate registration keeps the first entry', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p1);

            manager.registerAgent(agent1);
            manager.registerAgent(agent2);
            manager.tickAll(makeFullState(), 1, projector);

            // onTick should be called on agent1 (the kept entry), not agent2
            expect(agent1.onTick).toHaveBeenCalledOnce();
            expect(agent2.onTick).not.toHaveBeenCalled();
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

        it('omniscient agent receives raw fullState — projector.project() NOT called for it', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();

            manager.tickAll(fullState, 3, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onTick).toHaveBeenCalledWith(fullState, 3);
        });

        it('omniscient and honest agents both receive onTick; projector called only for honest agent', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            const honest = makeAiAgent(p2);
            manager.registerAgent(omniscient);
            manager.registerAgent(honest);
            const fullState = makeFullState();

            manager.tickAll(fullState, 2, projector);

            expect(projector.project).toHaveBeenCalledTimes(1);
            expect(projector.project).toHaveBeenCalledWith(fullState, p2);
            expect(omniscient.onTick).toHaveBeenCalledWith(fullState, 2);
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

        it('omniscient agent receives raw fullState in onGameStart — projector NOT called', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();

            manager.onGameStart(fullState, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onGameStart).toHaveBeenCalledWith(fullState);
        });

        it('omniscient and honest agents both receive onGameStart; projector called only for honest agent', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            const honest = makeAiAgent(p2);
            manager.registerAgent(omniscient);
            manager.registerAgent(honest);
            const fullState = makeFullState();

            manager.onGameStart(fullState, projector);

            expect(projector.project).toHaveBeenCalledTimes(1);
            expect(projector.project).toHaveBeenCalledWith(fullState, p2);
            expect(omniscient.onGameStart).toHaveBeenCalledWith(fullState);
        });

        it('emits logger.warn for each omniscient agent during onGameStart', () => {
            const logger = makeNoopLogger();
            const managerWithLogger = new AgentManager({ logger });
            const omniscient = makeOmniscientAgent(p1);
            managerWithLogger.registerAgent(omniscient);

            managerWithLogger.onGameStart(makeFullState(), makeProjector());

            expect(logger.warn).toHaveBeenCalledWith('agent-manager:omniscient-agent', {
                playerId: p1,
            });
        });

        it('does NOT emit logger.warn for honest agents during onGameStart', () => {
            const logger = makeNoopLogger();
            const managerWithLogger = new AgentManager({ logger });
            const honest = makeAiAgent(p1);
            managerWithLogger.registerAgent(honest);

            managerWithLogger.onGameStart(makeFullState(), makeProjector());

            expect(logger.warn).not.toHaveBeenCalled();
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

        it('omniscient agent receives raw fullState in onGameEnd — projector NOT called', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();
            const result = makeResult();

            manager.onGameEnd(fullState, result, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onGameEnd).toHaveBeenCalledWith(fullState, result);
        });

        it('omniscient and honest agents both receive onGameEnd; projector called only for honest agent', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            const honest = makeAiAgent(p2);
            manager.registerAgent(omniscient);
            manager.registerAgent(honest);
            const fullState = makeFullState();
            const result = makeResult();

            manager.onGameEnd(fullState, result, projector);

            expect(projector.project).toHaveBeenCalledTimes(1);
            expect(projector.project).toHaveBeenCalledWith(fullState, p2);
            expect(omniscient.onGameEnd).toHaveBeenCalledWith(fullState, result);
        });
    });
});
