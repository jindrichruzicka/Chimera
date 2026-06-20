/**
 * simulation/host/SimulationHost.test.ts
 *
 * Unit tests for the composable `SimulationHost`.
 *
 * The host is exercised against an in-file stub `AgentCoordinator` only — no
 * `@chimera/ai`, Electron, DOM, or IPC import appears in this file. This both
 * satisfies the zero-dependency leaf boundary (Invariant #1) and proves
 * acceptance criterion #1 of issue #760: the host instantiates and drives a
 * full register → start → tick → end cycle in a plain Node/test context.
 *
 * The host's own behaviour is pure delegation to the `AgentCoordinator` port,
 * so these tests assert exactly that contract:
 *   - `registerAgent(a)`  → `coordinator.registerAgent(a)`
 *   - `afterTick(s)`      → `coordinator.tickAll(s, s.tick, projector)`
 *   - `onGameStart(s)`    → `coordinator.onGameStart(s, projector)`
 *   - `onGameEnd(s, r)`   → `coordinator.onGameEnd(s, r, projector)`
 *
 * The coordinator's own fan-out / projection / omniscient behaviour is covered
 * by its concrete implementation's tests (`ai/engine/AgentManager.test.ts`).
 *
 * Architecture reference: Appendix C.3 / §C.4 — Composable SimulationHost
 * Issue: #760 (feature F58)
 */

import { describe, it, expect } from 'vitest';
import { SimulationHost } from './SimulationHost.js';
import type { AgentCoordinator } from './AgentCoordinator.js';
import type { StateProjector } from '../projection/StateProjector.js';
import { makeStubPlayerSnapshot } from '../engine/__test-support__/stubs.js';
import type { BaseGameSnapshot, GameResult, PlayerId } from '../engine/types.js';
import { playerId as toPlayerId } from '../engine/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

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
        gameResult: null,
    };
}

/** Identity projector — viewer-agnostic stub snapshot keyed by tick. */
const projector: StateProjector = {
    project: (snap) => makeStubPlayerSnapshot(snap.tick),
};

/** Minimal opaque agent — the host forwards it without inspecting it. */
interface TestAgent {
    readonly id: string;
}

interface TickCall {
    readonly state: BaseGameSnapshot;
    readonly tick: number;
    readonly projector: StateProjector;
}
interface StartCall {
    readonly state: BaseGameSnapshot;
    readonly projector: StateProjector;
}
interface EndCall {
    readonly state: BaseGameSnapshot;
    readonly result: GameResult;
    readonly projector: StateProjector;
}

/**
 * Records every port call so tests can assert the host forwards arguments
 * faithfully and in order.
 */
class RecordingCoordinator implements AgentCoordinator<TestAgent> {
    readonly order: string[] = [];
    readonly registered: TestAgent[] = [];
    readonly tickCalls: TickCall[] = [];
    readonly startCalls: StartCall[] = [];
    readonly endCalls: EndCall[] = [];

    registerAgent(agent: TestAgent): void {
        this.order.push('register');
        this.registered.push(agent);
    }
    tickAll(state: BaseGameSnapshot, tick: number, p: StateProjector): void {
        this.order.push('tick');
        this.tickCalls.push({ state, tick, projector: p });
    }
    onGameStart(state: BaseGameSnapshot, p: StateProjector): void {
        this.order.push('start');
        this.startCalls.push({ state, projector: p });
    }
    onGameEnd(state: BaseGameSnapshot, result: GameResult, p: StateProjector): void {
        this.order.push('end');
        this.endCalls.push({ state, result, projector: p });
    }
}

// ─── registerAgent ────────────────────────────────────────────────────────────

describe('SimulationHost.registerAgent', () => {
    it('forwards the agent to the coordinator', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);
        const agent: TestAgent = { id: 'a' };

        host.registerAgent(agent);

        expect(coordinator.registered).toEqual([agent]);
    });
});

// ─── afterTick ────────────────────────────────────────────────────────────────

describe('SimulationHost.afterTick', () => {
    it('calls tickAll with the snapshot, its tick, and the construction projector', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);
        const snap = makeSnapshot(5);

        host.afterTick(snap);

        expect(coordinator.tickCalls).toHaveLength(1);
        expect(coordinator.tickCalls[0]).toEqual({ state: snap, tick: 5, projector });
    });

    it('uses the canonical tick number from each snapshot on subsequent calls', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);

        host.afterTick(makeSnapshot(3));
        host.afterTick(makeSnapshot(7));

        expect(coordinator.tickCalls.map((c) => c.tick)).toEqual([3, 7]);
    });
});

// ─── onGameStart ──────────────────────────────────────────────────────────────

describe('SimulationHost.onGameStart', () => {
    it('forwards the snapshot and projector to the coordinator', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);
        const snap = makeSnapshot(0);

        host.onGameStart(snap);

        expect(coordinator.startCalls).toEqual([{ state: snap, projector }]);
    });
});

// ─── onGameEnd ────────────────────────────────────────────────────────────────

describe('SimulationHost.onGameEnd', () => {
    it('forwards the snapshot, result, and projector to the coordinator', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);
        const snap = makeSnapshot(10);
        const result: GameResult = { winnerIds: [P1] };

        host.onGameEnd(snap, result);

        expect(coordinator.endCalls).toEqual([{ state: snap, result, projector }]);
    });

    it('passes an empty winnerIds list through for a draw', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);
        const result: GameResult = { winnerIds: [] };

        host.onGameEnd(makeSnapshot(10), result);

        expect(coordinator.endCalls[0]?.result).toEqual({ winnerIds: [] });
    });
});

// ─── full lifecycle (plain Node, no AI/Electron) ──────────────────────────────

describe('SimulationHost full lifecycle', () => {
    it('drives register → start → tick → tick → end in order against the coordinator', () => {
        const coordinator = new RecordingCoordinator();
        const host = new SimulationHost(coordinator, projector);

        host.registerAgent({ id: 'a' });
        host.onGameStart(makeSnapshot(0));
        host.afterTick(makeSnapshot(1));
        host.afterTick(makeSnapshot(2));
        host.onGameEnd(makeSnapshot(3), { winnerIds: [P1] });

        expect(coordinator.order).toEqual(['register', 'start', 'tick', 'tick', 'end']);
    });
});
