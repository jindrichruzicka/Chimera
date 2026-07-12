/**
 * Per-tick fan-out coordinator: holds a PlayerId → PlayerAgent map and drives
 * all registered agents through the game lifecycle.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #17 — tickAll() calls projector.project() for each agent before calling
 *          onTick(), so AI players receive a PlayerSnapshot, never the raw
 *          GameSnapshot. Human agents are included in the uniform fan-out
 *          (HumanPlayerAgent.onTick is a no-op).
 */

import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import type {
    StateProjector,
    PlayerSnapshot,
} from '@chimera-engine/simulation/projection/StateProjector.js';
import type { AgentCoordinator } from '@chimera-engine/simulation/host';
import type { PlayerAgent, GameResult } from './PlayerAgent.js';

/**
 * Holds a `PlayerId → PlayerAgent` map and drives all registered agents
 * through the game lifecycle.
 *
 * Owned by `simulation-host.ts` in Electron main. Called after every
 * simulation tick.
 *
 * Registration:
 *   - `registerAgent(agent)` stores the agent keyed by `agent.playerId`.
 *   - Duplicate registration of the same `playerId` is a no-op; a warning is
 *     logged and the original entry is kept.
 *
 * Lifecycle fan-out (uniform for all agent kinds):
 *   - `tickAll` / `onGameStart` / `onGameEnd` each call `projector.project()`
 *     for every registered agent to obtain a `PlayerSnapshot`, then forward
 *     the projected snapshot to the corresponding agent lifecycle method.
 *   - `HumanPlayerAgent` lifecycle methods are no-ops, so the uniform path
 *     adds no observable behaviour for human slots.
 */
export class AgentManager implements AgentCoordinator<PlayerAgent> {
    private readonly agents = new Map<PlayerId, PlayerAgent>();
    private readonly logger: Logger;

    constructor(options: { readonly logger: Logger }) {
        this.logger = options.logger;
    }

    /**
     * Register a player agent.
     *
     * Duplicate registration (same `playerId`) is a no-op.  A `console.warn`
     * is emitted so callers can detect accidental double-registration during
     * development.
     */
    public registerAgent(agent: PlayerAgent): void {
        if (this.agents.has(agent.playerId)) {
            this.logger.warn('agent-manager:duplicate-registration', {
                playerId: agent.playerId,
            });
            return;
        }
        this.agents.set(agent.playerId, agent);
    }

    /**
     * Drop every registered agent.
     *
     * Used by the host when abandoning a match back to the lobby
     * (`engine:return_to_lobby`): the per-session agents carry state-machine
     * and scheduler state that must not bleed into the next match, and
     * {@link registerAgent} dedups by `playerId`, so a clean restart requires
     * clearing first and then re-registering fresh agents.
     */
    public clear(): void {
        this.agents.clear();
    }

    /**
     * Compute isMyTurn for a given player based on turn clock state.
     * This matches the logic in StateProjector.project().
     */
    private computeIsMyTurn(state: BaseGameSnapshot, playerId: PlayerId): boolean {
        return state.turnClock === undefined || state.turnClock.activePlayerId === playerId;
    }

    /**
     * Fan-out the per-tick lifecycle to all registered agents.
     *
     * For each agent: projects `fullState` through `projector.project()` to
     * obtain the agent's `PlayerSnapshot`, then calls `agent.onTick(snapshot, tick)`.
     *
     * Invariant #17: honest agents receive a `PlayerSnapshot` from the projector.
     * Omniscient agents receive a `PlayerSnapshot` built from the full state via spread
     * (viewerId, commitments, undoMeta added with safe defaults), bypassing the projector
     * (as permitted by Invariant #17).
     */
    public tickAll(fullState: BaseGameSnapshot, tick: number, projector: StateProjector): void {
        for (const agent of this.agents.values()) {
            const isMyTurn = this.computeIsMyTurn(fullState, agent.playerId);
            const snapshot: PlayerSnapshot = agent.omniscient
                ? {
                      ...fullState,
                      viewerId: agent.playerId,
                      commitments: {},
                      undoMeta: { canUndo: false, canRedo: false },
                      isMyTurn,
                  }
                : projector.project(fullState, agent.playerId);
            agent.onTick(snapshot, tick);
        }
    }

    /**
     * Fan-out the game-start event to all registered agents.
     *
     * For each agent: projects `fullState` and calls `agent.onGameStart(snapshot)`.
     * Omniscient agents receive a `PlayerSnapshot` built from the full state via spread
     * and trigger an audit-trail `warn` log entry (Invariant #17).
     */
    public onGameStart(fullState: BaseGameSnapshot, projector: StateProjector): void {
        for (const agent of this.agents.values()) {
            const isMyTurn = this.computeIsMyTurn(fullState, agent.playerId);
            const snapshot: PlayerSnapshot = agent.omniscient
                ? {
                      ...fullState,
                      viewerId: agent.playerId,
                      commitments: {},
                      undoMeta: { canUndo: false, canRedo: false },
                      isMyTurn,
                  }
                : projector.project(fullState, agent.playerId);
            if (agent.omniscient) {
                this.logger.warn('agent-manager:omniscient-agent', {
                    playerId: agent.playerId,
                });
            }
            agent.onGameStart(snapshot);
        }
    }

    /**
     * Fan-out the game-end event to all registered agents.
     *
     * For each agent: projects `fullState` and calls
     * `agent.onGameEnd(snapshot, result)`. Omniscient agents receive a `PlayerSnapshot`
     * built from the full state via spread (per Invariant #17).
     */
    public onGameEnd(
        fullState: BaseGameSnapshot,
        result: GameResult,
        projector: StateProjector,
    ): void {
        for (const agent of this.agents.values()) {
            const isMyTurn = this.computeIsMyTurn(fullState, agent.playerId);
            const snapshot: PlayerSnapshot = agent.omniscient
                ? {
                      ...fullState,
                      viewerId: agent.playerId,
                      commitments: {},
                      undoMeta: { canUndo: false, canRedo: false },
                      isMyTurn,
                  }
                : projector.project(fullState, agent.playerId);
            agent.onGameEnd(snapshot, result);
        }
    }
}
