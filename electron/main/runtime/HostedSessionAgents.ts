/**
 * electron/main/runtime/HostedSessionAgents.ts
 *
 * Host-session AI composition helpers. This module lives in Electron main
 * because it wires concrete AI engine objects to the host ActionPipeline.
 *
 * Architecture reference: §4.6 / §4.9
 *
 * Invariants upheld:
 *   #17 — the snapshot an honest agent is SEEDED with is projected through
 *          `StateProjector.project()`, exactly like every per-tick delivery in
 *          `AgentManager`. Agent construction is a state-delivery path: the
 *          seed reaches game code as `AIState.onEnter`'s argument. Only an
 *          agent whose slot declares `omniscient` may seed from the full
 *          `GameSnapshot`.
 */

import {
    AIBrain,
    AIStateMachineImpl,
    CommandContextImpl,
    CommandSchedulerImpl,
    AIPlayerAgent,
} from '@chimera-engine/ai/engine';
import type { AIState, PlayerAgent } from '@chimera-engine/ai';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    GamePhase,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId, sceneId } from '@chimera-engine/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera-engine/simulation/projection/StateProjector.js';
import type { LobbyAgentSlot } from '@chimera-engine/networking';
import type { ReplayPlayerMetadata } from '@chimera-engine/simulation/replay/ReplayFile.js';

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
    /**
     * The session's projector — the SAME instance that projects every outbound
     * broadcast and every per-tick agent delivery.
     *
     * Required, not optional: an omitted-and-defaulted projector would compile
     * everywhere while silently seeding an honest agent from raw host state,
     * which is exactly the Invariant #17 hole this parameter closes.
     */
    readonly projector: StateProjector;
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
/** The one phase the engine itself owns — every other value is the game's to choose. */
const LOBBY_PHASE = gamePhase('lobby');

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
 * Derive the synthetic AI player slots for a match start from the LIVE lobby
 * `agentSlots`.
 *
 * Unlike {@link collectInitialPlayerSlots} — which runs at host time off the
 * host-time `metadata.agentSlots` and includes the host seat — this is called at
 * game-start with the current lobby roster, so AI seats added *after* hosting
 * (the only way the UI adds them) are picked up. Order-preserving; human slots
 * are ignored. The host (slot 0) and joined humans are seated separately from the
 * live `players` roster, so this returns AI seats only.
 */
export function collectGameStartAiPlayerSlots(
    agentSlots: readonly LobbyAgentSlot[] | undefined,
): readonly HostedSessionPlayerSlot[] {
    const slots: HostedSessionPlayerSlot[] = [];
    for (const slot of agentSlots ?? []) {
        if (slot.kind === 'ai') {
            slots.push({
                slotIndex: slot.slotIndex,
                playerId: createSyntheticAIPlayerId(slot.slotIndex),
            });
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
    const createState =
        options.createState ?? ((pid: PlayerId) => createAutoEndTurnState(pid, options.logger));
    const initialState = createState(options.playerId);
    stateMachine.registerState(initialState);
    // The seed reaches game code verbatim as `AIState.onEnter`'s snapshot, so
    // it is a state delivery and must pass the same gate every tick does
    // (Invariant #17). An honest agent is projected; an omniscient agent keeps
    // its declared full-state access. The omniscient arm's hardcoded
    // `isMyTurn: true` is preserved behaviour, not a derivation — `onEnter`
    // runs synchronously on this object, so a game reading `isMyTurn` there
    // reads that literal. Deriving it would be the better value, but changing
    // what a declared-omniscient agent is seeded with is out of scope here.
    const seed: PlayerSnapshot =
        options.omniscient === true
            ? {
                  ...options.initialSnapshot,
                  viewerId: options.playerId,
                  commitments: {},
                  undoMeta: { canUndo: false, canRedo: false },
                  isMyTurn: true,
              }
            : options.projector.project(options.initialSnapshot, options.playerId);
    stateMachine.setInitialState(initialState.name, seed, {}, scheduler, context);

    const brain = new AIBrain(stateMachine, scheduler, context, {});
    return new AIPlayerAgent(options.playerId, brain, { omniscient: options.omniscient ?? false });
}

function createAutoEndTurnState(playerIdToAdvance: PlayerId, logger: Logger): AIState {
    // True while this policy's own `context.dispatch` is on the stack. The host
    // re-ticks every agent from INSIDE that dispatch (`runHostAction` →
    // `afterTick` → `tickAll`), which is the mechanism that lets a policy spend
    // a whole turn in one go — and, for a policy that re-asks unconditionally,
    // the mechanism that recurses to the drive-depth cap. Suppressing the
    // re-entrant asks bounds this policy at one request per pump for EVERY
    // reduction, including the two where the tick DOES advance while the seat
    // stays active: a game contributing `mayEndTurn` (simultaneous turns) whose
    // seat is still `isMyTurn` afterwards, and a round-robin over a one-seat
    // roster, which hands the turn straight back.
    let dispatching = false;
    // Highest tick already asked to end. The re-entrancy guard covers a single
    // pump; this covers repeat pumps at an UNCHANGED tick — a game with no
    // `turnClock` projects `isMyTurn: true` for every viewer while
    // `engine:end_turn` reduces to the identity, so every subsequent tick of
    // the agent would re-issue a request that cannot make progress, each one
    // costing a replay record, a broadcast and an autosave write.
    //
    // Both are per-agent and live as long as the agent object — a fresh object
    // on a return-to-lobby restart, on a restore from the menu, AND on an
    // in-session `saves:load`: that path now rebuilds the agent roster alongside
    // the snapshot swap (index.ts `rebuildAgentsAgainstRestoredSnapshot`), so a
    // latch set at a later tick cannot outlive a rewind to an earlier one.
    let lastRequestedTick: number | null = null;
    return {
        name: DEFAULT_AI_STATE,
        onEnter: () => undefined,
        onTick: () => undefined,
        // `isMyTurn` is the projected turn gate — the only turn signal a
        // `PlayerSnapshot` carries. `turnClock` is host-local and absent from
        // every projected snapshot, so reading it here made this policy inert
        // for exactly the honest agents it is the default for. Reading the
        // projected field also means a game's `resolveIsMyTurn` override
        // (simultaneous turns) reaches the policy.
        onIdle: (snapshot, _tick, _params, _scheduler, context) => {
            if (dispatching) {
                return;
            }
            // Only a live match. A snapshot with no `turnClock` projects
            // `isMyTurn: true` for every viewer, and `engine:return_to_lobby`
            // drops the turn clock — so without this the policy ends turns in
            // the lobby, rewriting the autosave slot with a lobby-phase file
            // over the abandoned match's. A resolved match rejects `end_turn`
            // outright (`match_already_resolved`). Both facts are engine-owned;
            // a game's own phase vocabulary is open, so this must not be
            // written as an allow-list of "playing" or the policy goes inert
            // again for any game that names its phases differently.
            if (snapshot.phase === LOBBY_PHASE || snapshot.gameResult !== null) {
                return;
            }
            if (!snapshot.isMyTurn || lastRequestedTick === snapshot.tick) {
                return;
            }
            lastRequestedTick = snapshot.tick;
            dispatching = true;
            try {
                context.dispatch({
                    type: 'engine:end_turn',
                    playerId: playerIdToAdvance,
                    tick: snapshot.tick,
                    payload: {},
                });
            } catch (error) {
                // `ActionPipeline` signals a rejected action by throwing, and
                // nothing between here and the host action that drove the
                // fan-out catches it — an escaping error would fail a human's
                // action, or the realtime ticker's callback, on account of the
                // AI. A game can supply `resolveIsMyTurn` (projection) without
                // `mayEndTurn` (authorisation); they are separate seams, so a
                // seat this policy believes is active can still be refused.
                // Contained and logged, not silenced: the tick latch means the
                // next tick retries, so a guard that rejects only temporarily
                // (a commitment mode awaiting the other seats) still resolves.
                logger.warn('hosted-session-agents:auto-end-turn-rejected', {
                    playerId: playerIdToAdvance,
                    tick: snapshot.tick,
                    error: error instanceof Error ? error.message : String(error),
                });
            } finally {
                dispatching = false;
            }
        },
        onExit: () => undefined,
    };
}
