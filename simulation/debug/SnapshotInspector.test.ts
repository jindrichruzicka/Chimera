/**
 * simulation/debug/SnapshotInspector.test.ts
 *
 * TDD tests for SnapshotInspector — the query facade over the snapshot ring
 * buffer, action history, turn mementos, and state projector backing the
 * Debug Inspector panels.
 *
 * Architecture reference: §4.12 (runtime-debug-layer.md)
 * Task: F47 / T3 (issue #692)
 *
 * Tests are written FIRST (red) before SnapshotInspector.ts exists. They
 * express the acceptance criteria from issue #692 and the §10.1 scenario:
 * "In-buffer snapshot returned directly; outside-buffer reconstructed via
 * memento+replay; `diff()` entries correct."
 *
 * Scenario used throughout: initial state at tick 0, ten actions with
 * `tickApplied` 0..9 producing states at ticks 1..10, turn mementos at tick 0
 * (turn 0) and tick 5 (turn 1), ring buffer capacity 4 so only the states for
 * ticks 7..10 stay resident.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_PERF_SAMPLE_CAPACITY,
    SnapshotInspector,
    TickNotAvailableError,
} from './SnapshotInspector.js';
import type { InspectorMemento } from './SnapshotInspector.js';
import { SnapshotRingBuffer } from './SnapshotRingBuffer.js';
import { diffSnapshots } from './SnapshotDiff.js';
import { gamePhase, playerId } from '../engine/types.js';
import type { BaseGameSnapshot, PlayerId } from '../engine/types.js';
import type { ActionHistoryEntry } from '../engine/UndoManager.js';
import type { PlayerSnapshot, StateProjector } from '../projection/StateProjector.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

interface TestSnapshot extends BaseGameSnapshot {
    readonly counters: Readonly<Record<string, number>>;
}

const p1 = playerId('p1');

const makeSnapshot = (overrides: Partial<TestSnapshot> = {}): TestSnapshot => ({
    tick: 0,
    seed: 1,
    players: {},
    entities: {},
    phase: gamePhase('test'),
    events: [],
    turnNumber: 0,
    timers: {},
    gameResult: null,
    counters: {},
    ...overrides,
});

const makeEntry = (
    tickApplied: number,
    turnNumber: number,
    key: string,
    amount: number,
): ActionHistoryEntry => ({
    tickApplied,
    turnNumber,
    action: { type: 'test:add', playerId: p1, tick: tickApplied, payload: { key, amount } },
});

/**
 * Pure, deterministic replay double mirroring the host-supplied callback
 * contract from InMemoryUndoManager: folds each entry onto the state,
 * advancing the tick by exactly 1 per applied action.
 */
const fakeReplay = (
    state: Readonly<TestSnapshot>,
    entries: readonly ActionHistoryEntry[],
): Readonly<TestSnapshot> =>
    entries.reduce<Readonly<TestSnapshot>>((acc, entry) => {
        const { key, amount } = entry.action.payload as { key: string; amount: number };
        return {
            ...acc,
            tick: acc.tick + 1,
            counters: { ...acc.counters, [key]: (acc.counters[key] ?? 0) + amount },
        };
    }, state);

const deepFreeze = <T>(value: T): T => {
    if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
};

/** Pure projector double: derives a minimal PlayerSnapshot and records calls. */
const makeFakeProjector = (): {
    projector: StateProjector<TestSnapshot>;
    calls: { fullState: Readonly<TestSnapshot>; viewerId: PlayerId }[];
} => {
    const calls: { fullState: Readonly<TestSnapshot>; viewerId: PlayerId }[] = [];
    const projector: StateProjector<TestSnapshot> = {
        project(fullState, viewerId): PlayerSnapshot {
            calls.push({ fullState, viewerId });
            return {
                tick: fullState.tick,
                viewerId,
                phase: fullState.phase,
                players: {},
                entities: {},
                events: [],
                gameResult: fullState.gameResult,
                commitments: {},
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            };
        },
    };
    return { projector, calls };
};

interface ScenarioOptions {
    /** Post-action state ticks recorded into the ring buffer (default 1..10). */
    readonly recordTicks?: readonly number[];
    /** Selects the subset of the 10 entries exposed by the log provider (default all). */
    readonly log?: (entries: readonly ActionHistoryEntry[]) => readonly ActionHistoryEntry[];
    /** Mementos exposed by the provider (default ticks 0 and 5). */
    readonly mementos?: readonly InspectorMemento<TestSnapshot>[];
    readonly perfSampleCapacity?: number;
}

const makeScenario = (options: ScenarioOptions = {}) => {
    // entries[i] applies at tick i and yields states[i + 1].
    const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry(i, i < 5 ? 0 : 1, `k${i % 2}`, i + 1),
    );
    // states[i] = authoritative state at tick i, precomputed by the same fold
    // the live pipeline would have produced.
    const states: Readonly<TestSnapshot>[] = [makeSnapshot()];
    for (const entry of entries) {
        states.push(fakeReplay(states[states.length - 1]!, [entry]));
    }
    const mementos = options.mementos ?? [
        { tickAtTurnStart: 0, snapshotAtTurnStart: states[0]! },
        { tickAtTurnStart: 5, snapshotAtTurnStart: states[5]! },
    ];
    const log = options.log === undefined ? entries : options.log(entries);
    deepFreeze(states);
    deepFreeze(entries);
    deepFreeze(mementos);

    const ringBuffer = new SnapshotRingBuffer<TestSnapshot>(4);
    for (const tick of options.recordTicks ?? states.slice(1).map((s) => s.tick)) {
        ringBuffer.record(tick, states[tick]!);
    }

    const replayCalls: {
        base: Readonly<TestSnapshot>;
        entries: readonly ActionHistoryEntry[];
    }[] = [];
    let mementoProviderCalls = 0;
    const { projector, calls: projectorCalls } = makeFakeProjector();

    const inspector = new SnapshotInspector<TestSnapshot>({
        ringBuffer,
        projector,
        getActionLog: () => log,
        getMementos: () => {
            mementoProviderCalls++;
            return mementos;
        },
        replay: (state, replayEntries) => {
            replayCalls.push({ base: state, entries: replayEntries });
            return fakeReplay(state, replayEntries);
        },
        ...(options.perfSampleCapacity !== undefined
            ? { perfSampleCapacity: options.perfSampleCapacity }
            : {}),
    });

    return {
        inspector,
        ringBuffer,
        states,
        entries,
        mementos,
        replayCalls,
        projectorCalls,
        mementoProviderCalls: () => mementoProviderCalls,
    };
};

// ─── listTicks() ──────────────────────────────────────────────────────────────

describe('SnapshotInspector — listTicks()', () => {
    it('returns the union of action-log and ring-buffer ticks, ascending and deduped', () => {
        const { inspector } = makeScenario();
        expect(inspector.listTicks().map((entry) => entry.tick)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
    });

    it('flags resident ticks with inRingBuffer true and evicted ones false', () => {
        const { inspector } = makeScenario();
        const byTick = new Map(inspector.listTicks().map((entry) => [entry.tick, entry]));
        expect(byTick.get(3)?.inRingBuffer).toBe(false);
        expect(byTick.get(6)?.inRingBuffer).toBe(false);
        expect(byTick.get(7)?.inRingBuffer).toBe(true);
        expect(byTick.get(10)?.inRingBuffer).toBe(true);
    });

    it('attaches actionType, playerId, and turnNumber from log-backed ticks', () => {
        const { inspector } = makeScenario();
        const byTick = new Map(inspector.listTicks().map((entry) => [entry.tick, entry]));
        expect(byTick.get(3)).toEqual({
            tick: 3,
            inRingBuffer: false,
            actionType: 'test:add',
            playerId: p1,
            turnNumber: 0,
        });
        expect(byTick.get(7)).toEqual({
            tick: 7,
            inRingBuffer: true,
            actionType: 'test:add',
            playerId: p1,
            turnNumber: 1,
        });
    });

    it('omits action fields entirely for ring-buffer-only ticks', () => {
        const { inspector } = makeScenario();
        // Tick 10 is the post-state of entry 9 — no log entry has tickApplied 10.
        const last = inspector.listTicks().at(-1);
        expect(last).toEqual({ tick: 10, inRingBuffer: true });
        expect(last).not.toHaveProperty('actionType');
        expect(last).not.toHaveProperty('playerId');
        expect(last).not.toHaveProperty('turnNumber');
    });

    it('covers buffer-resident ticks even when the log has been pruned', () => {
        const { inspector } = makeScenario({ log: (all) => all.slice(8) });
        const ticks = inspector.listTicks();
        expect(ticks.map((entry) => entry.tick)).toEqual([7, 8, 9, 10]);
        expect(ticks[0]).toEqual({ tick: 7, inRingBuffer: true });
        expect(ticks[1]?.actionType).toBe('test:add');
    });

    it('returns [] when both the log and the buffer are empty', () => {
        const { inspector } = makeScenario({ recordTicks: [], log: () => [], mementos: [] });
        expect(inspector.listTicks()).toEqual([]);
    });

    it('returns a fresh, equal array on every call', () => {
        const { inspector } = makeScenario();
        const first = inspector.listTicks();
        const second = inspector.listTicks();
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });
});

// ─── getSnapshot(): ring-buffer hit (O(1) path) ───────────────────────────────

describe('SnapshotInspector — getSnapshot(): ring-buffer hit', () => {
    it('returns the exact buffered snapshot reference', () => {
        const { inspector, states } = makeScenario();
        expect(inspector.getSnapshot(8)).toBe(states[8]);
    });

    it('touches neither the replay callback nor the memento provider on a hit', () => {
        const { inspector, replayCalls, mementoProviderCalls } = makeScenario();
        inspector.getSnapshot(8);
        expect(replayCalls).toHaveLength(0);
        expect(mementoProviderCalls()).toBe(0);
    });
});

// ─── getSnapshot(): memento reconstruction ────────────────────────────────────

describe('SnapshotInspector — getSnapshot(): memento reconstruction', () => {
    it('reconstructs an evicted tick by replaying from the nearest memento', () => {
        const { inspector, states, replayCalls, entries } = makeScenario();
        const reconstructed = inspector.getSnapshot(3);
        expect(reconstructed).toEqual(states[3]);
        expect(replayCalls).toHaveLength(1);
        expect(replayCalls[0]?.base).toBe(states[0]);
        expect(replayCalls[0]?.entries).toEqual(entries.slice(0, 3));
    });

    it('picks the nearest memento at-or-before the tick, not the first', () => {
        const { inspector, states, replayCalls, entries } = makeScenario({ recordTicks: [] });
        const reconstructed = inspector.getSnapshot(7);
        expect(reconstructed).toEqual(states[7]);
        expect(replayCalls).toHaveLength(1);
        expect(replayCalls[0]?.base).toBe(states[5]);
        // Bounded by turn length: only entries 5 and 6, never 0..4.
        expect(replayCalls[0]?.entries).toEqual(entries.slice(5, 7));
    });

    it('returns the memento snapshot itself without replay for an exact memento tick', () => {
        const { inspector, states, replayCalls } = makeScenario({ recordTicks: [] });
        expect(inspector.getSnapshot(5)).toBe(states[5]);
        expect(replayCalls).toHaveLength(0);
    });

    it('reconstructs deterministically: repeated calls are deeply equal', () => {
        const { inspector } = makeScenario();
        expect(inspector.getSnapshot(3)).toEqual(inspector.getSnapshot(3));
    });

    it('reconstruction matches the state the live pipeline produced at that tick', () => {
        const { inspector, states } = makeScenario();
        for (const tick of [1, 2, 3, 4, 6]) {
            expect(inspector.getSnapshot(tick)).toEqual(states[tick]);
        }
    });
});

// ─── getSnapshot(): errors ────────────────────────────────────────────────────

describe('SnapshotInspector — getSnapshot(): errors', () => {
    it('throws TickNotAvailableError when no memento exists at or before the tick', () => {
        const { inspector } = makeScenario();
        expect(() => inspector.getSnapshot(-1)).toThrow(TickNotAvailableError);
        try {
            inspector.getSnapshot(-1);
            expect.unreachable('getSnapshot(-1) must throw');
        } catch (error) {
            const tickError = error as TickNotAvailableError;
            expect(tickError.code).toBe('TICK_NOT_AVAILABLE');
            expect(tickError.reason).toBe('no_memento_at_or_before_tick');
            expect(tickError.tick).toBe(-1);
        }
    });

    it('throws when the tick is newer than the latest reconstructable state', () => {
        const { inspector } = makeScenario();
        expect(() => inspector.getSnapshot(11)).toThrow(TickNotAvailableError);
        try {
            inspector.getSnapshot(11);
            expect.unreachable('getSnapshot(11) must throw');
        } catch (error) {
            expect((error as TickNotAvailableError).reason).toBe('reconstruction_tick_mismatch');
        }
    });

    it('throws on an intermediate tick the outer-dispatch replay cannot reach', () => {
        // Variant replay where each action advances the tick by 2 — tick 1
        // falls inside the gap and reconstruction lands on tick 2 instead.
        const base = deepFreeze(makeSnapshot());
        const entry = deepFreeze(makeEntry(0, 0, 'k0', 1));
        const ringBuffer = new SnapshotRingBuffer<TestSnapshot>(4);
        const { projector } = makeFakeProjector();
        const inspector = new SnapshotInspector<TestSnapshot>({
            ringBuffer,
            projector,
            getActionLog: () => [entry],
            getMementos: () => [{ tickAtTurnStart: 0, snapshotAtTurnStart: base }],
            replay: (state, replayEntries) => ({
                ...state,
                tick: state.tick + 2 * replayEntries.length,
            }),
        });
        expect(() => inspector.getSnapshot(1)).toThrow(TickNotAvailableError);
        try {
            inspector.getSnapshot(1);
            expect.unreachable('getSnapshot(1) must throw');
        } catch (error) {
            expect((error as TickNotAvailableError).reason).toBe('reconstruction_tick_mismatch');
        }
    });

    it('throws on a non-integer tick before touching any provider', () => {
        const { inspector, mementoProviderCalls } = makeScenario();
        expect(() => inspector.getSnapshot(1.5)).toThrow(TickNotAvailableError);
        try {
            inspector.getSnapshot(1.5);
            expect.unreachable('getSnapshot(1.5) must throw');
        } catch (error) {
            expect((error as TickNotAvailableError).reason).toBe('invalid_tick');
        }
        expect(mementoProviderCalls()).toBe(0);
    });

    it('supports instanceof checks across the throw boundary', () => {
        const { inspector } = makeScenario();
        try {
            inspector.getSnapshot(-1);
            expect.unreachable('getSnapshot(-1) must throw');
        } catch (error) {
            expect(error instanceof TickNotAvailableError).toBe(true);
            expect(error instanceof Error).toBe(true);
            expect((error as Error).name).toBe('TickNotAvailableError');
        }
    });
});

// ─── getProjection() ──────────────────────────────────────────────────────────

describe('SnapshotInspector — getProjection()', () => {
    it('equals StateProjector.project() output for a buffered tick', () => {
        const { inspector, projectorCalls } = makeScenario();
        const projection = inspector.getProjection(8, p1);
        const direct = makeFakeProjector().projector.project(inspector.getSnapshot(8), p1);
        expect(projection).toEqual(direct);
        expect(projectorCalls).toHaveLength(1);
    });

    it('passes the exact resolved snapshot reference and viewerId to the projector', () => {
        const { inspector, states, projectorCalls } = makeScenario();
        inspector.getProjection(8, p1);
        expect(projectorCalls[0]?.fullState).toBe(states[8]);
        expect(projectorCalls[0]?.viewerId).toBe(p1);
    });

    it('projects a reconstructed (out-of-buffer) tick', () => {
        const { inspector } = makeScenario();
        const projection = inspector.getProjection(3, p1);
        expect(projection.tick).toBe(3);
        expect(projection.viewerId).toBe(p1);
    });

    it('propagates TickNotAvailableError for an unknown tick', () => {
        const { inspector, projectorCalls } = makeScenario();
        expect(() => inspector.getProjection(-1, p1)).toThrow(TickNotAvailableError);
        expect(projectorCalls).toHaveLength(0);
    });
});

// ─── diff() ───────────────────────────────────────────────────────────────────

describe('SnapshotInspector — diff()', () => {
    it('equals diffSnapshots() of the two resolved snapshots for buffered ticks', () => {
        const { inspector } = makeScenario();
        const diff = inspector.diff(7, 8);
        expect(diff).toEqual(diffSnapshots(inspector.getSnapshot(7), inspector.getSnapshot(8)));
        expect(diff.fromTick).toBe(7);
        expect(diff.toTick).toBe(8);
        expect(diff.entries.length).toBeGreaterThan(0);
    });

    it('diffs a reconstructed tick against a buffered one', () => {
        const { inspector, states } = makeScenario();
        const diff = inspector.diff(3, 8);
        expect(diff).toEqual(diffSnapshots(states[3]!, states[8]!));
        expect(diff.fromTick).toBe(3);
        expect(diff.toTick).toBe(8);
    });

    it('returns an empty diff for the same tick on both sides', () => {
        const { inspector } = makeScenario();
        const diff = inspector.diff(8, 8);
        expect(diff.entries).toEqual([]);
        expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 });
    });

    it('throws TickNotAvailableError when either side is unknown', () => {
        const { inspector } = makeScenario();
        expect(() => inspector.diff(-1, 8)).toThrow(TickNotAvailableError);
        expect(() => inspector.diff(8, 11)).toThrow(TickNotAvailableError);
    });
});

// ─── getActionLog() ───────────────────────────────────────────────────────────

describe('SnapshotInspector — getActionLog()', () => {
    it('returns the full log in append order when called without bounds', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog()).toEqual([...entries]);
    });

    it('returns a fresh array, not the provider array, and is isolation-safe', () => {
        const { inspector, entries } = makeScenario();
        const first = inspector.getActionLog();
        expect(first).not.toBe(entries);
        first.pop();
        expect(inspector.getActionLog()).toHaveLength(10);
    });

    it('shares the entries themselves by reference (no cloning)', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog()[0]).toBe(entries[0]);
    });

    it('treats fromTick as an inclusive lower bound on tickApplied', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog(7)).toEqual(entries.slice(7));
    });

    it('treats toTick as an inclusive upper bound on tickApplied', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog(undefined, 2)).toEqual(entries.slice(0, 3));
    });

    it('applies both bounds inclusively', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog(3, 5)).toEqual(entries.slice(3, 6));
    });

    it('returns everything when bounds lie outside the recorded range', () => {
        const { inspector, entries } = makeScenario();
        expect(inspector.getActionLog(-100, 100)).toEqual([...entries]);
    });

    it('returns [] for an inverted range', () => {
        const { inspector } = makeScenario();
        expect(inspector.getActionLog(7, 3)).toEqual([]);
    });
});

// ─── recordTickDuration() / getPerfStats() ────────────────────────────────────

describe('SnapshotInspector — recordTickDuration() / getPerfStats()', () => {
    it('exports DEFAULT_PERF_SAMPLE_CAPACITY mirroring the ring-buffer default', () => {
        expect(DEFAULT_PERF_SAMPLE_CAPACITY).toBe(200);
    });

    it('reports zeroed durations and live fill/log counts before any sample', () => {
        const { inspector } = makeScenario();
        expect(inspector.getPerfStats()).toEqual({
            avgTickDurationMs: 0,
            maxTickDurationMs: 0,
            sampleCount: 0,
            recentSamples: [],
            ringBufferFill: { used: 4, capacity: 4 },
            totalActionCount: 10,
        });
    });

    it('reports full zeros on an empty scenario', () => {
        const { inspector } = makeScenario({ recordTicks: [], log: () => [], mementos: [] });
        expect(inspector.getPerfStats()).toEqual({
            avgTickDurationMs: 0,
            maxTickDurationMs: 0,
            sampleCount: 0,
            recentSamples: [],
            ringBufferFill: { used: 0, capacity: 4 },
            totalActionCount: 0,
        });
    });

    it('aggregates avg/max/count over recorded samples, oldest first', () => {
        const { inspector } = makeScenario();
        inspector.recordTickDuration(1, 4);
        inspector.recordTickDuration(2, 10);
        inspector.recordTickDuration(3, 1);
        const stats = inspector.getPerfStats();
        expect(stats.avgTickDurationMs).toBe(5);
        expect(stats.maxTickDurationMs).toBe(10);
        expect(stats.sampleCount).toBe(3);
        expect(stats.recentSamples).toEqual([
            { tick: 1, durationMs: 4 },
            { tick: 2, durationMs: 10 },
            { tick: 3, durationMs: 1 },
        ]);
    });

    it('bounds recentSamples to perfSampleCapacity while keeping cumulative aggregates', () => {
        const { inspector } = makeScenario({ perfSampleCapacity: 2 });
        inspector.recordTickDuration(1, 4);
        inspector.recordTickDuration(2, 10);
        inspector.recordTickDuration(3, 1);
        const stats = inspector.getPerfStats();
        expect(stats.recentSamples).toEqual([
            { tick: 2, durationMs: 10 },
            { tick: 3, durationMs: 1 },
        ]);
        expect(stats.sampleCount).toBe(3);
        expect(stats.avgTickDurationMs).toBe(5);
        expect(stats.maxTickDurationMs).toBe(10);
    });

    it('tracks the live ring-buffer fill level', () => {
        const { inspector, ringBuffer, states } = makeScenario({ recordTicks: [] });
        expect(inspector.getPerfStats().ringBufferFill).toEqual({ used: 0, capacity: 4 });
        ringBuffer.record(1, states[1]!);
        expect(inspector.getPerfStats().ringBufferFill).toEqual({ used: 1, capacity: 4 });
    });

    it('rejects negative, NaN, and infinite durations with RangeError', () => {
        const { inspector } = makeScenario();
        expect(() => inspector.recordTickDuration(1, -1)).toThrow(RangeError);
        expect(() => inspector.recordTickDuration(1, Number.NaN)).toThrow(RangeError);
        expect(() => inspector.recordTickDuration(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('rejects a non-integer tick with RangeError', () => {
        const { inspector } = makeScenario();
        expect(() => inspector.recordTickDuration(1.5, 2)).toThrow(RangeError);
    });

    it('rejects a non-positive or non-integer perfSampleCapacity at construction', () => {
        expect(() => makeScenario({ perfSampleCapacity: 0 })).toThrow(RangeError);
        expect(() => makeScenario({ perfSampleCapacity: 2.5 })).toThrow(RangeError);
    });

    it('returns fresh stats and samples objects on every call', () => {
        const { inspector } = makeScenario();
        inspector.recordTickDuration(1, 4);
        const first = inspector.getPerfStats();
        const second = inspector.getPerfStats();
        expect(first).not.toBe(second);
        expect(first.recentSamples).not.toBe(second.recentSamples);
        expect(first).toEqual(second);
    });
});

// ─── Purity / no input mutation / determinism ─────────────────────────────────

describe('SnapshotInspector — purity and determinism', () => {
    it('operates on deep-frozen provider data without throwing', () => {
        // makeScenario deep-freezes every state, entry, and memento — any
        // mutation attempt would throw under strict mode.
        const { inspector } = makeScenario();
        expect(() => {
            inspector.listTicks();
            inspector.getSnapshot(3);
            inspector.getProjection(3, p1);
            inspector.diff(3, 8);
            inspector.getActionLog(2, 6);
            inspector.getPerfStats();
        }).not.toThrow();
    });

    it('does not mutate the memento snapshot or log entries during reconstruction', () => {
        const { inspector, mementos, entries } = makeScenario();
        const mementoClone = structuredClone(mementos[0]);
        const entriesClone = structuredClone(entries);
        inspector.getSnapshot(3);
        expect(mementos[0]).toEqual(mementoClone);
        expect(entries).toEqual(entriesClone);
    });

    it('produces identical results across repeated calls of every query', () => {
        const { inspector } = makeScenario();
        inspector.recordTickDuration(1, 4);
        expect(inspector.listTicks()).toEqual(inspector.listTicks());
        expect(inspector.getSnapshot(3)).toEqual(inspector.getSnapshot(3));
        expect(inspector.diff(3, 8)).toEqual(inspector.diff(3, 8));
        expect(inspector.getActionLog()).toEqual(inspector.getActionLog());
        expect(inspector.getPerfStats()).toEqual(inspector.getPerfStats());
    });
});
