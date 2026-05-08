/**
 * electron/main/runtime/HostedSessionAgents.ts
 *
 * Host-session AI composition helpers. This module lives in Electron main
 * because it wires concrete AI engine objects to the host ActionPipeline.
 */

import { AIBrain } from '@chimera/ai/engine/AIBrain.js';
import type { AIState } from '@chimera/ai/engine/AIState.js';
import { AIStateMachineImpl } from '@chimera/ai/engine/AIStateMachine.js';
import { CommandContextImpl } from '@chimera/ai/engine/CommandContext.js';
import { CommandSchedulerImpl } from '@chimera/ai/engine/CommandScheduler.js';
import { AIPlayerAgent } from '@chimera/ai/engine/PlayerAgent.js';
import type { PlayerAgent } from '@chimera/ai/engine/PlayerAgent.js';
import type { Logger } from '@chimera/shared/logging.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    GamePhase,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId } from '@chimera/simulation/engine/types.js';
import type { LobbyAgentSlot } from '@chimera/networking/provider/MultiplayerProvider.js';

export interface HostedSessionAgentMetadata {
    readonly hostId: PlayerId;
    readonly maxPlayers: number;
    readonly agentSlots?: readonly LobbyAgentSlot[];
}

export interface HostedSessionPlayerSlot {
    readonly slotIndex: number;
    readonly playerId: PlayerId;
}

export interface BuildInitialHostedSessionSnapshotOptions {
    readonly seed: number;
    readonly hostPlayerId: PlayerId;
    readonly playerSlots: readonly HostedSessionPlayerSlot[];
    readonly phase: GamePhase;
    readonly initialEntities?: BaseGameSnapshot['entities'];
}

export interface BuildDefaultAIPlayerAgentOptions {
    readonly playerId: PlayerId;
    readonly initialSnapshot: Readonly<BaseGameSnapshot>;
    readonly dispatch: (action: ActionEnvelope) => void;
    readonly logger: Logger;
    readonly omniscient?: boolean;
}

const DEFAULT_AI_STATE = 'engine:auto-end-turn';
const DEFAULT_TURN_DEADLINE_MS = 30_000;

export function resolveAgentSlot(
    metadata: HostedSessionAgentMetadata,
    slotIndex: number,
): LobbyAgentSlot {
    const configured = metadata.agentSlots?.find((slot) => slot.slotIndex === slotIndex);
    return configured ?? { slotIndex, kind: 'human' };
}

export function createSyntheticAIPlayerId(slotIndex: number): PlayerId {
    return playerId(`ai-${slotIndex}`);
}

export function collectInitialPlayerSlots(
    metadata: HostedSessionAgentMetadata,
): readonly HostedSessionPlayerSlot[] {
    const slots: HostedSessionPlayerSlot[] = [{ slotIndex: 0, playerId: metadata.hostId }];
    for (let slotIndex = 1; slotIndex < metadata.maxPlayers; slotIndex += 1) {
        const configured = resolveAgentSlot(metadata, slotIndex);
        if (configured.kind === 'ai') {
            slots.push({ slotIndex, playerId: createSyntheticAIPlayerId(slotIndex) });
        }
    }
    return slots;
}

export function buildInitialHostedSessionSnapshot(
    options: BuildInitialHostedSessionSnapshotOptions,
): BaseGameSnapshot {
    const players: BaseGameSnapshot['players'] = {};
    for (const slot of options.playerSlots) {
        players[slot.playerId] = { id: slot.playerId };
    }

    const firstPlayer = options.playerSlots[0]?.playerId;
    const entities: BaseGameSnapshot['entities'] = options.initialEntities ?? {};

    return {
        tick: 0,
        seed: options.seed,
        players,
        entities,
        phase: options.phase,
        events: [],
        turnNumber: 0,
        hostPlayerId: options.hostPlayerId,
        ...(firstPlayer !== undefined
            ? {
                  turnClock: {
                      activePlayerId: firstPlayer,
                      deadlineMs: DEFAULT_TURN_DEADLINE_MS,
                  },
              }
            : {}),
        timers: {},
    };
}

export function buildDefaultAIPlayerAgent(options: BuildDefaultAIPlayerAgentOptions): PlayerAgent {
    const stateMachine = new AIStateMachineImpl({ logger: options.logger });
    const scheduler = new CommandSchedulerImpl();
    const context = new CommandContextImpl(options.dispatch, () => undefined, options.logger);
    stateMachine.registerState(createAutoEndTurnState(options.playerId));
    stateMachine.setInitialState(
        DEFAULT_AI_STATE,
        {
            ...options.initialSnapshot,
            viewerId: options.playerId,
            commitments: {},
            undoMeta: { canUndo: false, canRedo: false },
        },
        {},
        scheduler,
        context,
    );

    const brain = new AIBrain(stateMachine, scheduler, context, {});
    return new AIPlayerAgent(options.playerId, brain, { omniscient: options.omniscient ?? false });
}

function createAutoEndTurnState(playerIdToAdvance: PlayerId): AIState {
    return {
        name: DEFAULT_AI_STATE,
        onEnter: () => undefined,
        onTick: () => undefined,
        onIdle: (snapshot, _tick, _params, _scheduler, context) => {
            const turnClock = readTurnClock(snapshot);
            if (turnClock?.activePlayerId !== playerIdToAdvance) {
                return;
            }
            context.dispatch({
                type: 'engine:end_turn',
                playerId: playerIdToAdvance,
                tick: snapshot.tick,
                payload: {},
            });
        },
        onExit: () => undefined,
    };
}

function readTurnClock(snapshot: { readonly tick: number }): BaseGameSnapshot['turnClock'] {
    const withTurnClock = snapshot as { readonly turnClock?: BaseGameSnapshot['turnClock'] };
    return withTurnClock.turnClock;
}
