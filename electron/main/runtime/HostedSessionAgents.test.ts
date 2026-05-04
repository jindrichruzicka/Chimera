/**
 * electron/main/runtime/HostedSessionAgents.test.ts
 *
 * Host-level AI wiring coverage for M4 F22/F25.
 *
 * Tests written first (TDD): red confirmed before implementation.
 */

import { describe, expect, it, vi } from 'vitest';
import { playerId, gamePhase, type BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import { buildDefaultAIPlayerAgent } from './HostedSessionAgents.js';
import { buildHostSessionPipeline } from './HostSessionPipeline.js';
import { SessionRuntime } from './SessionRuntime.js';
import { createNoopLogger } from '../logging/logger.js';

const aiPlayerId = playerId('ai-0');
const humanPlayerId = playerId('human-1');

function makeSnapshot(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 99,
        players: {
            [aiPlayerId]: { id: aiPlayerId },
            [humanPlayerId]: { id: humanPlayerId },
        },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: aiPlayerId,
        turnClock: {
            activePlayerId: aiPlayerId,
            deadlineMs: 30_000,
        },
        timers: {},
    };
}

describe('buildDefaultAIPlayerAgent', () => {
    it('dispatches engine:end_turn through the real host ActionPipeline when the AI is active', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(),
            applyAction: processAction,
            now: () => 1_000,
        });

        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
        });

        agent.onGameStart(runtime.getSnapshot() as unknown as PlayerSnapshot);

        expect(runtime.getSnapshot().turnNumber).toBe(1);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);
    });

    it('drives the AI through multiple turns in a full headless match', () => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(),
            applyAction: processAction,
            now: () => 1_000,
        });

        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
        });

        // Turn 1: AI takes its turn
        agent.onGameStart(runtime.getSnapshot() as unknown as PlayerSnapshot);
        expect(runtime.getSnapshot().turnNumber).toBe(1);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);

        // Turn 2: Human takes its turn (manually dispatch)
        let snapshot = runtime.getSnapshot();
        runtime.applyAction({
            type: 'engine:end_turn',
            playerId: humanPlayerId,
            tick: snapshot.tick,
            payload: {},
        });
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(2);
        expect(snapshot.turnClock?.activePlayerId).toBe(aiPlayerId);

        // Turn 3: AI takes its second turn (onTick triggers the agent to dispatch)
        agent.onTick(snapshot as unknown as PlayerSnapshot, snapshot.tick);
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(3);
        expect(snapshot.turnClock?.activePlayerId).toBe(humanPlayerId);

        // Turn 4: Human takes second turn
        runtime.applyAction({
            type: 'engine:end_turn',
            playerId: humanPlayerId,
            tick: snapshot.tick,
            payload: {},
        });
        snapshot = runtime.getSnapshot();
        expect(snapshot.turnNumber).toBe(4);
        expect(snapshot.turnClock?.activePlayerId).toBe(aiPlayerId);

        // Verify we've completed a multi-turn cycle without errors
        expect(snapshot.turnNumber).toBeGreaterThanOrEqual(4);
    });
});
