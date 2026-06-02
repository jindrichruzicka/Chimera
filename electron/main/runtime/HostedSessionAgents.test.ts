/**
 * electron/main/runtime/HostedSessionAgents.test.ts
 *
 * Host-level AI wiring coverage for M4 F22/F25.
 *
 * Tests written first (TDD): red confirmed before implementation.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    playerId,
    gamePhase,
    entityId,
    sceneId,
    type BaseGameSnapshot,
} from '@chimera/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    buildReplayPlayers,
} from './HostedSessionAgents.js';
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
        gameResult: null,
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

describe('buildInitialHostedSessionSnapshot', () => {
    it('uses injected initialEntities when provided', () => {
        const host = playerId('host-entities-1');
        const customId = entityId('unit-custom');
        const customEntities: BaseGameSnapshot['entities'] = {
            [customId]: { id: customId },
        };

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
            initialEntities: customEntities,
        });

        expect(snapshot.entities).toBe(customEntities);
    });

    it('uses an explicit firstPlayer for the initial turn clock at tick 0', () => {
        const host = playerId('host-first-player-1');
        const client = playerId('client-first-player-1');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            firstPlayer: client,
            playerSlots: [
                { slotIndex: 0, playerId: host },
                { slotIndex: 1, playerId: client },
            ],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.tick).toBe(0);
        expect(snapshot.turnClock).toEqual({ activePlayerId: client, deadlineMs: 30_000 });
    });

    it('yields empty entities when initialEntities is not provided', () => {
        const host = playerId('host-entities-2');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.entities).toEqual({});
    });

    it('serializes the lobby scene as the initial hosted scene', () => {
        const host = playerId('host-scene-1');

        const snapshot = buildInitialHostedSessionSnapshot({
            seed: 42,
            hostPlayerId: host,
            playerSlots: [{ slotIndex: 0, playerId: host }],
            phase: gamePhase('lobby'),
        });

        expect(snapshot.sceneId).toBe(sceneId('engine:lobby'));
        expect(snapshot.sceneTransition).toBeNull();
    });
});

describe('buildReplayPlayers', () => {
    it('resolves each slot to its directory display name', () => {
        const host = playerId('host-1');
        const client = playerId('client-2');

        const players = buildReplayPlayers(
            [
                { slotIndex: 0, playerId: host },
                { slotIndex: 1, playerId: client },
            ],
            (id) => (id === host ? 'Alice' : id === client ? 'Bob' : undefined),
        );

        expect(players).toEqual([
            { playerId: host, displayName: 'Alice' },
            { playerId: client, displayName: 'Bob' },
        ]);
    });

    it('falls back to the stringified playerId when no display name is known', () => {
        const ai = playerId('ai-1');

        const players = buildReplayPlayers([{ slotIndex: 1, playerId: ai }], () => undefined);

        expect(players).toEqual([{ playerId: ai, displayName: String(ai) }]);
    });

    it('preserves slot order', () => {
        const a = playerId('a');
        const b = playerId('b');
        const c = playerId('c');

        const players = buildReplayPlayers(
            [
                { slotIndex: 2, playerId: c },
                { slotIndex: 0, playerId: a },
                { slotIndex: 1, playerId: b },
            ],
            () => undefined,
        );

        expect(players.map((p) => p.playerId)).toEqual([c, a, b]);
    });
});
