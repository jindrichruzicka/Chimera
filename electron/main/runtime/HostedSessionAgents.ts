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
import { playerId, sceneId } from '@chimera/simulation/engine/types.js';
import type { LobbyAgentSlot } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ReplayPlayerMetadata } from '@chimera/simulation/replay/ReplayFile.js';

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
    readonly firstPlayer?: PlayerId;
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
    /**
     * Optional factory for the AI's initial state. Defaults to the generic
     * `engine:auto-end-turn` policy; a game (via its {@link MainGameContribution})
     * supplies a move/attack brain here. The factory comes from the pure `ai/`
     * policy package — this composition seam never imports a game directly.
     */
    readonly createState?: ((playerId: PlayerId) => AIState) | undefined;
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

/**
 * Maps the resolved player slots to replay `players` metadata, sourcing each
 * display name from `resolveDisplayName` (typically the host `PlayerDirectory`).
 *
 * Pure and order-preserving. When no display name is known for a slot — e.g.
 * synthetic AI players, or a client whose profile has not reached the directory
 * yet — it falls back to the stringified `playerId` so the field is never empty.
 * This is non-gameplay metadata only (it is never read back into the snapshot),
 * so the fallback cannot affect replay determinism.
 */
export function buildReplayPlayers(
    slots: readonly HostedSessionPlayerSlot[],
    resolveDisplayName: (id: PlayerId) => string | undefined,
): readonly ReplayPlayerMetadata[] {
    return slots.map((slot) => ({
        playerId: slot.playerId,
        displayName: resolveDisplayName(slot.playerId) ?? String(slot.playerId),
    }));
}

export function buildInitialHostedSessionSnapshot(
    options: BuildInitialHostedSessionSnapshotOptions,
): BaseGameSnapshot {
    const players: BaseGameSnapshot['players'] = {};
    for (const slot of options.playerSlots) {
        players[slot.playerId] = { id: slot.playerId };
    }

    const firstPlayer = options.firstPlayer ?? options.playerSlots[0]?.playerId;
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
        gameResult: null,
        sceneId: options.phase === 'playing' ? sceneId('engine:game') : sceneId('engine:lobby'),
        sceneTransition: null,
    };
}

export function buildDefaultAIPlayerAgent(options: BuildDefaultAIPlayerAgentOptions): PlayerAgent {
    const stateMachine = new AIStateMachineImpl({ logger: options.logger });
    const scheduler = new CommandSchedulerImpl();
    const context = new CommandContextImpl(options.dispatch, () => undefined, options.logger);
    const createState = options.createState ?? createAutoEndTurnState;
    const initialState = createState(options.playerId);
    stateMachine.registerState(initialState);
    stateMachine.setInitialState(
        initialState.name,
        {
            ...options.initialSnapshot,
            viewerId: options.playerId,
            commitments: {},
            undoMeta: { canUndo: false, canRedo: false },
            isMyTurn: true,
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
