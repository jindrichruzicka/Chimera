/**
 * electron/main/runtime/SimulationHost.test.ts
 *
 * Unit tests for SimulationHost — the AgentManager wiring layer that sits
 * between the simulation tick loop and the AI/human player agents.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Issue: #414
 *
 * Tests written FIRST (red confirmed before implementation).
 *
 * Invariants verified:
 *   #16 — No direct dispatch channel to agents; routing goes through AgentManager.
 *   #17 — honest agents receive projected PlayerSnapshot values; explicit
 *          omniscient AI agents may receive raw state through AgentManager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationHost } from './SimulationHost.js';
import { AgentManager } from '@chimera/ai/engine/AgentManager.js';
import type { StateProjector } from '@chimera/ai/engine/AgentManager.js';
import type { PlayerAgent, PlayerSnapshot, GameResult } from '@chimera/ai/engine/PlayerAgent.js';
import type { Logger } from '@chimera/shared/logging.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

function makeSnapshot(tick: number, ids: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(ids.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: tick,
        timers: {},
    };
}

/**
 * Identity projector — returns the full snapshot cast to PlayerSnapshot.
 * Pre-F26 placeholder: no fog-of-war projection is applied yet.
 */
const identityProjector: StateProjector = {
    project: (snap) => snap,
};

/**
 * Create a mock PlayerAgent that satisfies the interface.
 * `PlayerAgent` is an interface so object literals work without casting.
 */
function makeMockAgent(id: PlayerId, kind: 'human' | 'ai' = 'human'): PlayerAgent {
    return {
        playerId: id,
        kind,
        omniscient: false,
        onTick: vi.fn(),
        onGameStart: vi.fn(),
        onGameEnd: vi.fn(),
    };
}

const makeNoopLogger = (): Logger => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis() as Logger['child'],
});

function makeAgentManager(): AgentManager {
    return new AgentManager({ logger: makeNoopLogger() });
}

// ─── SimulationHost.afterTick ─────────────────────────────────────────────────

describe('SimulationHost.afterTick', () => {
    let manager: AgentManager;

    beforeEach(() => {
        manager = makeAgentManager();
    });

    it('calls onTick on a registered agent with the projected snapshot and tick number', () => {
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        host.afterTick(makeSnapshot(5));

        expect(agent.onTick).toHaveBeenCalledOnce();
        expect(agent.onTick).toHaveBeenCalledWith(expect.objectContaining({ tick: 5 }), 5);
    });

    it('calls onTick once per afterTick call', () => {
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        host.afterTick(makeSnapshot(1));
        host.afterTick(makeSnapshot(2));

        expect(agent.onTick).toHaveBeenCalledTimes(2);
    });

    it('passes the correct tick number on each subsequent call', () => {
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        host.afterTick(makeSnapshot(3));
        host.afterTick(makeSnapshot(7));

        expect(agent.onTick).toHaveBeenNthCalledWith(1, expect.objectContaining({ tick: 3 }), 3);
        expect(agent.onTick).toHaveBeenNthCalledWith(2, expect.objectContaining({ tick: 7 }), 7);
    });

    it('fans out to all registered agents on every tick', () => {
        const agent1 = makeMockAgent(P1);
        const agent2 = makeMockAgent(P2);
        manager.registerAgent(agent1);
        manager.registerAgent(agent2);
        const host = new SimulationHost(manager, identityProjector);

        host.afterTick(makeSnapshot(1, [P1, P2]));

        expect(agent1.onTick).toHaveBeenCalledOnce();
        expect(agent2.onTick).toHaveBeenCalledOnce();
    });

    it('does not call onTick when no agents are registered', () => {
        const unregisteredAgent = makeMockAgent(P1);
        const host = new SimulationHost(manager, identityProjector);

        host.afterTick(makeSnapshot(1));

        expect(unregisteredAgent.onTick).not.toHaveBeenCalled();
    });

    it('passes snapshot through projector — projected snapshot is forwarded to agent', () => {
        const projectedSnapshot: PlayerSnapshot = { tick: 99 };
        const trackingProjector: StateProjector = {
            project: vi.fn(() => projectedSnapshot),
        };
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, trackingProjector);

        // fullSnapshot has tick=5; projector returns { tick: 99 }.
        // The canonical tick number forwarded to onTick is from fullSnapshot (5),
        // but the snapshot reference forwarded is the projector's output.
        host.afterTick(makeSnapshot(5));

        expect(trackingProjector.project).toHaveBeenCalledOnce();
        expect(agent.onTick).toHaveBeenCalledWith(projectedSnapshot, 5);
    });
});

// ─── SimulationHost.onGameStart ───────────────────────────────────────────────

describe('SimulationHost.onGameStart', () => {
    it('calls onGameStart on all registered agents', () => {
        const manager = makeAgentManager();
        const agent1 = makeMockAgent(P1);
        const agent2 = makeMockAgent(P2);
        manager.registerAgent(agent1);
        manager.registerAgent(agent2);
        const host = new SimulationHost(manager, identityProjector);

        host.onGameStart(makeSnapshot(0, [P1, P2]));

        expect(agent1.onGameStart).toHaveBeenCalledOnce();
        expect(agent2.onGameStart).toHaveBeenCalledOnce();
    });

    it('passes projected snapshot to onGameStart', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        const snap = makeSnapshot(0);
        host.onGameStart(snap);

        expect(agent.onGameStart).toHaveBeenCalledWith(expect.objectContaining({ tick: 0 }));
    });

    it('requires agents to be registered before calling onGameStart (API contract)', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        const host = new SimulationHost(manager, identityProjector);

        // Call onGameStart with no agents registered (violates API contract)
        host.onGameStart(makeSnapshot(0, [P1]));

        // Register an agent AFTER onGameStart fires
        manager.registerAgent(agent);

        // Per the API contract (line 82-85 in SimulationHost.ts),
        // onGameStart must be called AFTER agents are registered.
        // This agent was registered after the event, so it should NOT receive it.
        expect(agent.onGameStart).not.toHaveBeenCalled();
    });
});

// ─── SimulationHost.onGameEnd ─────────────────────────────────────────────────

describe('SimulationHost.onGameEnd', () => {
    it('calls onGameEnd on all registered agents with the result', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        const result: GameResult = { winner: P1 };
        host.onGameEnd(makeSnapshot(10), result);

        expect(agent.onGameEnd).toHaveBeenCalledOnce();
        expect(agent.onGameEnd).toHaveBeenCalledWith(expect.objectContaining({ tick: 10 }), result);
    });

    it('passes winner: null for a draw result', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        manager.registerAgent(agent);
        const host = new SimulationHost(manager, identityProjector);

        const result: GameResult = { winner: null };
        host.onGameEnd(makeSnapshot(10), result);

        expect(agent.onGameEnd).toHaveBeenCalledWith(expect.objectContaining({ tick: 10 }), {
            winner: null,
        });
    });
});

// ─── SimulationHost.registerAgent ────────────────────────────────────────────

describe('SimulationHost.registerAgent', () => {
    it('delegates registration to the AgentManager (agent receives afterTick calls)', () => {
        const manager = makeAgentManager();
        const host = new SimulationHost(manager, identityProjector);
        const agent = makeMockAgent(P1);

        host.registerAgent(agent);
        host.afterTick(makeSnapshot(1));

        expect(agent.onTick).toHaveBeenCalledOnce();
    });

    it('silently ignores duplicate registration for the same playerId', () => {
        const manager = makeAgentManager();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = new SimulationHost(manager, identityProjector);
        const agent = makeMockAgent(P1);

        host.registerAgent(agent);
        host.registerAgent(agent); // duplicate

        host.afterTick(makeSnapshot(1));
        // Agent should only be called once (not twice for two registrations)
        expect(agent.onTick).toHaveBeenCalledOnce();
        warnSpy.mockRestore();
    });
});

// ─── SimulationHost ordering contract ────────────────────────────────────────
//
// Verifies the required call sequence: registerAgent → onGameStart → afterTick.
// Callers (electron/main/index.ts onSessionHosted) must honour this ordering so
// AI agents receive onGameStart before any tick events.
//
// Acceptance criterion: Issue #416 — "Unit tests for SimulationHost cover the
// ordering: register agents → call onGameStart → begin tick loop".

describe('SimulationHost ordering contract: register → onGameStart → afterTick', () => {
    it('agent registered before onGameStart receives both onGameStart and subsequent afterTick events', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        const host = new SimulationHost(manager, identityProjector);

        // Correct order mandated by the API contract (SimulationHost.ts line 82–85):
        host.registerAgent(agent);
        host.onGameStart(makeSnapshot(0));
        host.afterTick(makeSnapshot(1));
        host.afterTick(makeSnapshot(2));

        expect(agent.onGameStart).toHaveBeenCalledOnce();
        expect(agent.onTick).toHaveBeenCalledTimes(2);
    });

    it('onGameStart is called before any afterTick — call order is preserved', () => {
        const manager = makeAgentManager();
        const agent = makeMockAgent(P1);
        const host = new SimulationHost(manager, identityProjector);
        const callOrder: string[] = [];

        (agent.onGameStart as ReturnType<typeof vi.fn>).mockImplementation(() => {
            callOrder.push('onGameStart');
        });
        (agent.onTick as ReturnType<typeof vi.fn>).mockImplementation(() => {
            callOrder.push('onTick');
        });

        host.registerAgent(agent);
        host.onGameStart(makeSnapshot(0));
        host.afterTick(makeSnapshot(1));

        expect(callOrder).toEqual(['onGameStart', 'onTick']);
    });

    it('two agents registered before onGameStart both receive all lifecycle events', () => {
        const manager = makeAgentManager();
        const agent1 = makeMockAgent(P1);
        const agent2 = makeMockAgent(P2);
        const host = new SimulationHost(manager, identityProjector);

        host.registerAgent(agent1);
        host.registerAgent(agent2);
        host.onGameStart(makeSnapshot(0, [P1, P2]));
        host.afterTick(makeSnapshot(1, [P1, P2]));

        expect(agent1.onGameStart).toHaveBeenCalledOnce();
        expect(agent2.onGameStart).toHaveBeenCalledOnce();
        expect(agent1.onTick).toHaveBeenCalledOnce();
        expect(agent2.onTick).toHaveBeenCalledOnce();
    });
});
