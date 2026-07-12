/**
 * simulation/host/SimulationHost.ts
 *
 * Agent-coordinator wiring layer for a hosted game session.
 *
 * `SimulationHost` drives an {@link AgentCoordinator} lifecycle from the
 * simulation tick loop:
 *   - `registerAgent()`  — call before the first tick for every player slot.
 *   - `afterTick()`      — call synchronously after each simulation tick.
 *   - `onGameStart()`    — call once when the game transitions out of lobby.
 *   - `onGameEnd()`      — call once when the session closes.
 *
 * The host is deliberately free of any Electron, DOM, IPC, AI, or networking
 * dependency: it talks to its agent collaborator only through the
 * {@link AgentCoordinator} port (dependency inversion), so it instantiates and
 * runs in a plain Node/test context. `@chimera-engine/ai`'s `AgentManager` is the
 * production implementation of that port.
 *
 * Architecture reference: Appendix C.3 / §C.4 — Composable SimulationHost;
 *                         §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #1  — the host adds no React/DOM/networking/AI dependency to the
 *          zero-dependency `@chimera-engine/simulation` leaf.
 *   #16 — No direct dispatch channel to agents; all routing goes through the
 *          `AgentCoordinator`, which in turn calls only agent lifecycle methods.
 *   #17 — fan-out calls receive the `StateProjector`; honest agents receive a
 *          `PlayerSnapshot`, while explicit omniscient AI agents may receive
 *          raw state through the coordinator's host-only exception.
 */

import type { AgentCoordinator } from './AgentCoordinator.js';
import type { StateProjector } from '../projection/StateProjector.js';
import type { BaseGameSnapshot, GameResult } from '../engine/types.js';

/**
 * Drives the {@link AgentCoordinator} lifecycle from the simulation tick loop.
 *
 * Owned by the hosted-session callback in `electron/main/index.ts` (or any
 * other host shell). One `SimulationHost` is created per session and discarded
 * when the session closes.
 *
 * The `StateProjector` passed at construction is reused for every lifecycle
 * call so the same projection policy is applied uniformly across all events.
 * Invariant #17: honest agents receive projected snapshots by default; only
 * explicit omniscient AI agents may bypass projection inside the coordinator.
 *
 * Generic over `TAgent` — the agent value is forwarded to the coordinator and
 * never inspected by the host. Electron binds `TAgent` to `PlayerAgent`.
 */
export class SimulationHost<TAgent = unknown> {
    private readonly agentManager: AgentCoordinator<TAgent>;
    private readonly projector: StateProjector;

    constructor(agentManager: AgentCoordinator<TAgent>, projector: StateProjector) {
        this.agentManager = agentManager;
        this.projector = projector;
    }

    /**
     * Register a player agent.
     *
     * Must be called for every player slot (human and AI) before the first
     * tick fires. Delegates to `AgentCoordinator.registerAgent()`; duplicate
     * registration for the same `playerId` is silently ignored by the
     * coordinator.
     */
    public registerAgent(agent: TAgent): void {
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
     * Explicit omniscient AI agents may receive raw state inside the coordinator.
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
     * Call when the pipeline resolves a match result. `result.winnerIds` is
     * empty for draws, disconnects, or abandoned sessions.
     */
    public onGameEnd(fullSnapshot: BaseGameSnapshot, result: GameResult): void {
        this.agentManager.onGameEnd(fullSnapshot, result, this.projector);
    }
}
