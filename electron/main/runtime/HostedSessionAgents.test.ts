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
    type ActionEnvelope,
    type BaseGameSnapshot,
} from '@chimera-engine/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/index.js';
import { createTacticsAIState } from '@chimera-engine/tactics/ai/tacticsPolicy.js';
import { registerTacticsActions } from '@chimera-engine/tactics/simulation/actions.js';
import { tacticsVisibilityRules } from '@chimera-engine/tactics/simulation/visibility-rules.js';
import { TACTICS_MOVE_UNIT_ACTION } from '@chimera-engine/tactics/simulation/constants.js';
import type { LobbyAgentSlot } from '@chimera-engine/networking';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    buildReplayPlayers,
    collectGameStartAiPlayerSlots,
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

describe('buildDefaultAIPlayerAgent with the tactics policy (issue #725)', () => {
    const aiUnit = entityId('ai-unit');
    const enemyUnit = entityId('enemy-unit');

    function makeTacticsSnapshot(enemy: {
        readonly x: number;
        readonly y: number;
        readonly visibleToAI: boolean;
    }): BaseGameSnapshot {
        const entities = {
            [aiUnit]: {
                id: aiUnit,
                kind: 'unit',
                ownerId: aiPlayerId,
                x: 0,
                y: 0,
                hp: 1,
                visibleTo: [aiPlayerId],
            },
            [enemyUnit]: {
                id: enemyUnit,
                kind: 'unit',
                ownerId: humanPlayerId,
                x: enemy.x,
                y: enemy.y,
                hp: 1,
                visibleTo: enemy.visibleToAI ? [humanPlayerId, aiPlayerId] : [humanPlayerId],
            },
        } as unknown as BaseGameSnapshot['entities'];
        return {
            tick: 0,
            seed: 99,
            players: {
                [aiPlayerId]: { id: aiPlayerId },
                [humanPlayerId]: { id: humanPlayerId },
            },
            entities,
            phase: gamePhase('playing'),
            events: [],
            turnNumber: 0,
            hostPlayerId: aiPlayerId,
            turnClock: { activePlayerId: aiPlayerId, deadlineMs: 30_000 },
            timers: {},
            gameResult: null,
        };
    }

    function makeTacticsRuntime(initialSnapshot: BaseGameSnapshot): {
        readonly runtime: SessionRuntime;
        readonly projector: DefaultStateProjector;
    } {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        registerTacticsActions(registry);
        const { processAction } = buildHostSessionPipeline(registry, vi.fn());
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot,
            applyAction: processAction,
            now: () => 1_000,
        });
        return { runtime, projector: new DefaultStateProjector(tacticsVisibilityRules) };
    }

    it('attacks an adjacent visible enemy through the real host ActionPipeline', () => {
        const { runtime, projector } = makeTacticsRuntime(
            makeTacticsSnapshot({ x: 1, y: 0, visibleToAI: true }),
        );
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => runtime.applyAction(action),
            logger: createNoopLogger(),
            createState: createTacticsAIState,
        });

        const projected = projector.project(runtime.getSnapshot(), aiPlayerId);
        agent.onTick(projected, projected.tick);

        const enemy = runtime.getSnapshot().entities[enemyUnit] as unknown as {
            readonly hp: number;
        };
        expect(enemy.hp).toBe(0);
    });

    it('respects stamina (3 actions) then ends the turn when no enemy is in reach (AC4)', () => {
        const { runtime, projector } = makeTacticsRuntime(
            // Enemy parked in the far corner and not visible to the AI: it wanders.
            makeTacticsSnapshot({ x: 3, y: -2, visibleToAI: false }),
        );
        const dispatched: ActionEnvelope[] = [];
        const agent = buildDefaultAIPlayerAgent({
            playerId: aiPlayerId,
            initialSnapshot: runtime.getSnapshot(),
            dispatch: (action) => {
                dispatched.push(action);
                runtime.applyAction(action);
            },
            logger: createNoopLogger(),
            createState: createTacticsAIState,
        });

        // Drive enough idle ticks to exhaust stamina and pass the turn.
        for (let i = 0; i < 6; i += 1) {
            const projected = projector.project(runtime.getSnapshot(), aiPlayerId);
            agent.onTick(projected, projected.tick);
        }

        const moves = dispatched.filter((action) => action.type === TACTICS_MOVE_UNIT_ACTION);
        expect(moves).toHaveLength(3); // exactly the per-turn stamina budget
        expect(dispatched.some((action) => action.type === 'engine:end_turn')).toBe(true);
        expect(runtime.getSnapshot().turnClock?.activePlayerId).toBe(humanPlayerId);
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

describe('collectGameStartAiPlayerSlots', () => {
    // The seating fix (#730 follow-up): a lobby-added AI seat must be derived from
    // the LIVE lobby `agentSlots` at game-start, since the host-time metadata
    // captured by `collectInitialPlayerSlots` is empty (AI is added after hosting).
    it('returns no slots when there are no agent slots', () => {
        expect(collectGameStartAiPlayerSlots(undefined)).toEqual([]);
        expect(collectGameStartAiPlayerSlots([])).toEqual([]);
    });

    it('maps an AI slot to its synthetic player id, preserving the slot index', () => {
        const slots: readonly LobbyAgentSlot[] = [{ slotIndex: 1, kind: 'ai' }];

        expect(collectGameStartAiPlayerSlots(slots)).toEqual([
            { slotIndex: 1, playerId: playerId('ai-1') },
        ]);
    });

    it('ignores human slots and preserves AI order', () => {
        const slots: readonly LobbyAgentSlot[] = [
            { slotIndex: 1, kind: 'ai' },
            { slotIndex: 2, kind: 'human' },
            { slotIndex: 3, kind: 'ai' },
        ];

        expect(collectGameStartAiPlayerSlots(slots)).toEqual([
            { slotIndex: 1, playerId: playerId('ai-1') },
            { slotIndex: 3, playerId: playerId('ai-3') },
        ]);
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
