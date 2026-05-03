/**
 * electron/main/runtime/HostedSessionAgents.test.ts
 *
 * Host-level AI wiring coverage for M4 F22/F25.
 *
 * Tests written first (TDD): red confirmed before implementation.
 */

import { describe, expect, it, vi } from 'vitest';
import { playerId, gamePhase, type BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
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

        agent.onGameStart(runtime.getSnapshot());

        expect(runtime.getSnapshot().turnNumber).toBe(1);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);
    });
});
