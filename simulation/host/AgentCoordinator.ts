/**
 * simulation/host/AgentCoordinator.ts
 *
 * Host-facing port for the per-tick agent fan-out coordinator.
 *
 * `SimulationHost` drives a hosted session's player agents through this port,
 * never against a concrete implementation. This is the dependency-inversion
 * seam that keeps `@chimera-engine/simulation` the zero-dependency engine leaf
 * (Invariant #1): the leaf OWNS the contract, while `@chimera-engine/ai`'s
 * `AgentManager` IMPLEMENTS it — the dependency edge therefore points inward
 * (`ai → simulation`) and the host stays composable outside both Electron and
 * the AI framework.
 *
 * Architecture reference: Appendix C.3 / §C.4 — Composable SimulationHost;
 *                         §4.9 — AI Framework and Agent System
 *
 * The port is generic over `TAgent` because the host only ever forwards the
 * agent value to `registerAgent`; it never inspects it. Concrete consumers
 * (Electron main) bind `TAgent` to `@chimera-engine/ai`'s `PlayerAgent`.
 */

import type { StateProjector } from '../projection/StateProjector.js';
import type { BaseGameSnapshot, GameResult } from '../engine/types.js';

/**
 * Holds the per-session player agents and drives them through the game
 * lifecycle. The `StateProjector` is threaded into every fan-out call so the
 * coordinator can project the full host state down to each agent's
 * `PlayerSnapshot` before delivery (Invariant #17). Agents arrive already
 * constructed, so the snapshot they were SEEDED with is outside this port's
 * reach — the host shell that builds them applies the same gate.
 */
export interface AgentCoordinator<TAgent> {
    /** Register a player agent before the first tick. */
    registerAgent(agent: TAgent): void;
    /** Fan-out the per-tick event to all registered agents. */
    tickAll(state: BaseGameSnapshot, tick: number, projector: StateProjector): void;
    /** Fan-out the game-start event to all registered agents. */
    onGameStart(state: BaseGameSnapshot, projector: StateProjector): void;
    /** Fan-out the game-end event to all registered agents. */
    onGameEnd(state: BaseGameSnapshot, result: GameResult, projector: StateProjector): void;
}
