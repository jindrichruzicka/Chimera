/**
 * ai/__tests__/honest-ai-isolation.test.ts
 *
 * Regression coverage for Invariant #17 at the AgentManager FAN-OUT: honest AI
 * agents receive only the projected PlayerSnapshot, while explicit omniscient
 * agents receive full state.
 *
 * Scope: delivery to an already-constructed agent. The other #17 delivery path
 * — the snapshot an agent is SEEDED with at construction — is covered by
 * `electron/main/runtime/HostedSessionAgents.test.ts` (unit) and the restore
 * scenario in `electron/main/__tests__/session-restore.integration.test.ts`,
 * because the agent factory lives in the Electron host shell.
 *
 * Tests written first (TDD — red confirmed before implementation).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import { AgentManager } from '../engine/AgentManager.js';
import type { StateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
import { AIBrain } from '../engine/AIBrain.js';
import type { AIStateMachine } from '../engine/AIStateMachine.js';
import type { CommandContext } from '../engine/CommandContext.js';
import type { CommandScheduler } from '../engine/CommandScheduler.js';
import { AIPlayerAgent } from '../engine/PlayerAgent.js';
import type { PlayerSnapshot } from '../engine/PlayerAgent.js';

interface VisibilityEntity extends BaseEntityState {
    readonly visibleToHonestAi: boolean;
}

interface VisibilitySnapshot extends PlayerSnapshot {
    readonly entities: Readonly<Record<EntityId, VisibilityEntity>>;
}

const honestPlayerId = playerId('honest-ai');
const visibleEntityId = entityId('visible-entity');
const hiddenEntityId = entityId('hidden-entity');

const visibleEntity: VisibilityEntity = {
    id: visibleEntityId,
    visibleToHonestAi: true,
};

const hiddenEntity: VisibilityEntity = {
    id: hiddenEntityId,
    visibleToHonestAi: false,
};

const makeNoopLogger = (): Logger => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis() as Logger['child'],
});

function makeFullState(): BaseGameSnapshot {
    return {
        tick: 7,
        seed: 0,
        players: {
            [honestPlayerId]: { id: honestPlayerId },
        },
        entities: {
            [visibleEntityId]: visibleEntity,
            [hiddenEntityId]: hiddenEntity,
        },
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

function projectVisibleEntities(fullState: BaseGameSnapshot): VisibilitySnapshot {
    return {
        tick: fullState.tick,
        viewerId: honestPlayerId,
        phase: fullState.phase,
        players: {},
        entities: {
            [visibleEntityId]: visibleEntity,
        },
        events: [],
        gameResult: fullState.gameResult,
        commitments: Object.create(null),
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeProjector(): StateProjector {
    return {
        project: vi.fn((fullState) => projectVisibleEntities(fullState)),
    };
}

function makeRecordingBrain(receivedSnapshots: PlayerSnapshot[]): AIBrain {
    const stateMachine: AIStateMachine = {
        registerState: vi.fn(),
        setInitialState: vi.fn(),
        transition: vi.fn(),
        tick: vi.fn((snapshot) => {
            receivedSnapshots.push(snapshot);
        }),
        get currentState(): never {
            throw new Error('no state registered in honest-ai-isolation test double');
        },
    };
    const scheduler: CommandScheduler = {
        enqueue: vi.fn(),
        enqueueNext: vi.fn(),
        advance: vi.fn(),
        clearQueue: vi.fn(),
        abort: vi.fn(),
        isIdle: true,
        queueLength: 0,
    };
    const context: CommandContext = {
        dispatch: vi.fn(),
        transitionState: vi.fn(),
    };

    return new AIBrain(stateMachine, scheduler, context, {});
}

describe('honest AI isolation', () => {
    it('passes a projected snapshot without fog-hidden entities to a non-omniscient AIPlayerAgent', () => {
        const fullState = makeFullState();
        const projectedSnapshot = projectVisibleEntities(fullState);
        const projector: StateProjector = {
            project: vi.fn(() => projectedSnapshot),
        };
        const receivedSnapshots: PlayerSnapshot[] = [];
        const agent = new AIPlayerAgent(honestPlayerId, makeRecordingBrain(receivedSnapshots));
        const manager = new AgentManager({ logger: makeNoopLogger() });

        manager.registerAgent(agent);
        manager.tickAll(fullState, fullState.tick, projector);

        expect(projector.project).toHaveBeenCalledWith(fullState, honestPlayerId);
        expect(projectedSnapshot.entities[visibleEntityId]).toBe(visibleEntity);
        expect(projectedSnapshot.entities[hiddenEntityId]).toBeUndefined();
        expect(receivedSnapshots).toStrictEqual([projectedSnapshot]);
    });

    it('bypasses projection and passes full state snapshot to an omniscient AIPlayerAgent', () => {
        const fullState = makeFullState();
        const projector = makeProjector();
        const receivedSnapshots: PlayerSnapshot[] = [];
        const agent = new AIPlayerAgent(honestPlayerId, makeRecordingBrain(receivedSnapshots), {
            omniscient: true,
        });
        const manager = new AgentManager({ logger: makeNoopLogger() });

        manager.registerAgent(agent);
        manager.tickAll(fullState, fullState.tick, projector);

        // Projector is bypassed — omniscient agent builds its snapshot directly
        expect(projector.project).not.toHaveBeenCalled();
        // Omniscient snapshot contains all full-state entities (fog-of-war does not apply)
        expect(receivedSnapshots).toHaveLength(1);
        const received = receivedSnapshots[0]!;
        expect(received.entities[visibleEntityId]).toBe(visibleEntity);
        expect(received.entities[hiddenEntityId]).toBe(hiddenEntity);
    });
});
