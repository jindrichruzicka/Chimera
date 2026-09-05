/**
 * ai/engine/AgentManager.test.ts
 *
 * Unit tests for AgentManager — tick fan-out coordinator.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F22
 *
 * Invariants upheld:
 *   #17 — AgentManager.tickAll() calls projector.project() for each honest
 *          tick-observing agent; omniscient AI players receive fullState
 *          directly (bypassing projector). An agent that does not observe
 *          ticks (HumanPlayerAgent) is neither projected nor ticked.
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { playerId, gamePhase } from '@chimera-engine/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import type { StateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
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
    gameResult: null,
    commitments: Object.create(null),
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
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
    gameResult: null,
});

const makeResult = (): GameResult => ({ winnerIds: [] });

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
    observesTicks: true,
    onTick: vi.fn(),
    onGameStart: vi.fn(),
    onGameEnd: vi.fn(),
});

const makeOmniscientAgent = (id = p1): PlayerAgent => ({
    playerId: id,
    kind: 'ai',
    omniscient: true,
    observesTicks: true,
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

    // ── clear ───────────────────────────────────────────────────────────────

    describe('clear', () => {
        it('drops all registered agents so subsequent fan-out reaches none', () => {
            const projector = makeProjector();
            const agent1 = makeAiAgent(p1);
            const agent2 = makeAiAgent(p2);
            manager.registerAgent(agent1);
            manager.registerAgent(agent2);

            manager.clear();
            manager.tickAll(makeFullState(), 1, projector);
            manager.onGameStart(makeFullState(), projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(agent1.onTick).not.toHaveBeenCalled();
            expect(agent2.onTick).not.toHaveBeenCalled();
            expect(agent1.onGameStart).not.toHaveBeenCalled();
        });

        it('allows re-registering the same playerId after clear (no dedup no-op)', () => {
            const projector = makeProjector();
            const original = makeAiAgent(p1);
            const replacement = makeAiAgent(p1);
            manager.registerAgent(original);

            manager.clear();
            manager.registerAgent(replacement);
            manager.tickAll(makeFullState(), 1, projector);

            // The replacement is now the live entry; the original is gone.
            expect(replacement.onTick).toHaveBeenCalledOnce();
            expect(original.onTick).not.toHaveBeenCalled();
        });

        it('is a no-op when no agents are registered', () => {
            expect(() => manager.clear()).not.toThrow();
        });
    });

    // ── tickAll ───────────────────────────────────────────────────────────────

    describe('tickAll', () => {
        it('calls projector.project() once per tick for each of two registered AI agents', () => {
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

        it('calls agent.onTick with the projected snapshot and the tick', () => {
            const snapshot = makeSnapshot(5);
            const projector: StateProjector = { project: vi.fn(() => snapshot) };
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);

            manager.tickAll(makeFullState(), 5, projector);

            expect(agent.onTick).toHaveBeenCalledWith(snapshot, 5);
        });

        it('fans out to both registered AI agents', () => {
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

        it('does not call projector.project() for a HumanPlayerAgent on a beat', () => {
            const projector = makeProjector();
            manager.registerAgent(new HumanPlayerAgent(p1));

            manager.tickAll(makeFullState(), 1, projector);

            expect(projector.project).not.toHaveBeenCalled();
        });

        it('does not call onTick on a HumanPlayerAgent on a beat', () => {
            const humanAgent = new HumanPlayerAgent(p1);
            const onTick = vi.spyOn(humanAgent, 'onTick');
            manager.registerAgent(humanAgent);

            manager.tickAll(makeFullState(), 1, makeProjector());

            expect(onTick).not.toHaveBeenCalled();
        });

        it('skips both the projection and onTick for any agent declaring observesTicks: false, whatever its kind', () => {
            const projector = makeProjector();
            const inert: PlayerAgent = { ...makeAiAgent(p1), observesTicks: false };
            manager.registerAgent(inert);

            manager.tickAll(makeFullState(), 1, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(inert.onTick).not.toHaveBeenCalled();
        });

        it('projects for the tick-observing AI agent seated beside a human on every beat, and for it alone', () => {
            const projector = makeProjector();
            const human = new HumanPlayerAgent(p1);
            const humanOnTick = vi.spyOn(human, 'onTick');
            const ai = makeAiAgent(p2);
            manager.registerAgent(human);
            manager.registerAgent(ai);
            const fullState = makeFullState();

            manager.tickAll(fullState, 1, projector);
            manager.tickAll(fullState, 2, projector);

            expect(projector.project).toHaveBeenCalledTimes(2);
            expect(projector.project).toHaveBeenNthCalledWith(1, fullState, p2);
            expect(projector.project).toHaveBeenNthCalledWith(2, fullState, p2);
            expect(ai.onTick).toHaveBeenCalledTimes(2);
            expect(humanOnTick).not.toHaveBeenCalled();
        });

        it('hands an honest tick-observing agent the projector return itself, by identity', () => {
            const projected = makeSnapshot(4, p1);
            const projector: StateProjector = { project: vi.fn(() => projected) };
            const agent = makeAiAgent(p1);
            manager.registerAgent(agent);

            manager.tickAll(makeFullState(), 4, projector);

            expect(vi.mocked(agent.onTick).mock.calls[0]?.[0]).toBe(projected);
        });

        it('still projects for a HumanPlayerAgent in onGameStart and onGameEnd — the flag scopes the per-beat path only', () => {
            const projector = makeProjector();
            const human = new HumanPlayerAgent(p1);
            const onGameStart = vi.spyOn(human, 'onGameStart');
            const onGameEnd = vi.spyOn(human, 'onGameEnd');
            manager.registerAgent(human);
            const fullState = makeFullState();

            manager.onGameStart(fullState, projector);
            manager.onGameEnd(fullState, makeResult(), projector);

            expect(projector.project).toHaveBeenCalledTimes(2);
            expect(onGameStart).toHaveBeenCalledOnce();
            expect(onGameEnd).toHaveBeenCalledOnce();
        });

        it('omniscient agent receives full state snapshot — projector.project() NOT called for it', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();

            manager.tickAll(fullState, 3, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onTick).toHaveBeenCalledWith(expect.objectContaining(fullState), 3);
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
            expect(omniscient.onTick).toHaveBeenCalledWith(expect.objectContaining(fullState), 2);
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

        it('omniscient agent receives full state snapshot in onGameStart — projector NOT called', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();

            manager.onGameStart(fullState, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onGameStart).toHaveBeenCalledWith(expect.objectContaining(fullState));
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
            expect(omniscient.onGameStart).toHaveBeenCalledWith(expect.objectContaining(fullState));
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

        it('omniscient agent receives full state snapshot in onGameEnd — projector NOT called', () => {
            const projector = makeProjector();
            const omniscient = makeOmniscientAgent(p1);
            manager.registerAgent(omniscient);
            const fullState = makeFullState();
            const result = makeResult();

            manager.onGameEnd(fullState, result, projector);

            expect(projector.project).not.toHaveBeenCalled();
            expect(omniscient.onGameEnd).toHaveBeenCalledWith(
                expect.objectContaining(fullState),
                result,
            );
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
            expect(omniscient.onGameEnd).toHaveBeenCalledWith(
                expect.objectContaining(fullState),
                result,
            );
        });
    });
});
