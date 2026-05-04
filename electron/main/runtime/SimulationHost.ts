/**
 * electron/main/runtime/SimulationHost.ts
 *
 * AgentManager wiring layer for a hosted game session.
 *
 * `SimulationHost` drives the `AgentManager` lifecycle from the simulation
 * tick loop:
 *   - `registerAgent()`  — call before the first tick for every player slot.
 *   - `afterTick()`      — call synchronously after each simulation tick.
 *   - `onGameStart()`    — call once when the game transitions out of lobby.
 *   - `onGameEnd()`      — call once when the session closes.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Issue: #414
 *
 * Invariants upheld:
 *   #16 — No direct dispatch channel to agents; all routing goes through
 *          `AgentManager`, which in turn calls only agent lifecycle methods.
 *   #17 — `tickAll()` receives the `StateProjector`; honest agents receive
 *          `PlayerSnapshot`, while explicit omniscient AI agents may receive
 *          raw state through the host-only AgentManager exception.
 */

import type { AgentManager } from '@chimera/ai/engine/AgentManager.js';
import type { StateProjector } from '@chimera/simulation/projection/StateProjector.js';
import type { PlayerAgent, GameResult } from '@chimera/ai/engine/PlayerAgent.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';

/**
 * Drives the `AgentManager` lifecycle from the simulation tick loop.
 *
 * Owned by the hosted-session callback in `electron/main/index.ts`.
 * One `SimulationHost` is created per session and discarded when the session
 * closes.
 *
 * The `StateProjector` passed at construction is reused for every lifecycle
 * call so the same projection policy is applied uniformly across all events.
 * Invariant #17: honest agents receive projected snapshots by default; only
 * explicit omniscient AI agents may bypass projection inside AgentManager.
 */
export class SimulationHost {
    private readonly agentManager: AgentManager;
    private readonly projector: StateProjector;

    constructor(agentManager: AgentManager, projector: StateProjector) {
        this.agentManager = agentManager;
        this.projector = projector;
    }

    /**
     * Register a player agent.
     *
     * Must be called for every player slot (human and AI) before the first
     * tick fires. Delegates to `AgentManager.registerAgent()`; duplicate
     * registration for the same `playerId` is silently ignored.
     */
    public registerAgent(agent: PlayerAgent): void {
        this.agentManager.registerAgent(agent);
    }

    /**
     * Fan-out the per-tick event to all registered agents.
     *
     * Call this synchronously after each simulation tick completes (i.e.
     * after `SessionRuntime.applyAction()` returns), before the broadcaster
     * snapshot is sent.
     *
     * The snapshot's `.tick` field is used as the canonical tick number
     * passed to each agent's `onTick()` call.
     *
     * Invariant #17: honest agents receive `projector.project(fullSnapshot)`.
     * Explicit omniscient AI agents may receive raw state inside AgentManager.
     */
    public afterTick(fullSnapshot: BaseGameSnapshot): void {
        this.agentManager.tickAll(fullSnapshot, fullSnapshot.tick, this.projector);
    }

    /**
     * Notify all registered agents that the game has started.
     *
     * Call once after the initial snapshot is created and agents have been
     * registered, immediately before the tick loop starts accepting actions.
     */
    public onGameStart(fullSnapshot: BaseGameSnapshot): void {
        this.agentManager.onGameStart(fullSnapshot, this.projector);
    }

    /**
     * Notify all registered agents that the game has ended.
     *
     * Call in the session teardown path. `result.winner` is `null` for
     * draws, disconnects, or abandoned sessions.
     */
    public onGameEnd(fullSnapshot: BaseGameSnapshot, result: GameResult): void {
        this.agentManager.onGameEnd(fullSnapshot, result, this.projector);
    }
}
