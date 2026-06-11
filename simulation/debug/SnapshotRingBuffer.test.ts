/**
 * simulation/debug/SnapshotRingBuffer.test.ts
 *
 * TDD tests for SnapshotRingBuffer — fixed-capacity ring buffer of historical
 * snapshots backing the Debug Inspector timeline.
 *
 * Architecture reference: §4.12 (runtime-debug-layer.md)
 * Task: F47 / T1 (issue #690)
 *
 * Tests are written FIRST (red) before SnapshotRingBuffer.ts exists.
 * They express the acceptance criteria from issue #690 and the §10.1 test
 * scenario: "250 entries into capacity-200 buffer; last 200 retrievable;
 * onRecord callback fires."
 *
 * Invariant #30: fixed, explicitly set capacity — never grows unboundedly;
 * oldest entries are overwritten silently.
 */

import { describe, it, expect, vi } from 'vitest';
import { SnapshotRingBuffer } from './SnapshotRingBuffer.js';
import type { RingBufferEntry } from './SnapshotRingBuffer.js';
import { gamePhase } from '../engine/types.js';
import type { BaseGameSnapshot } from '../engine/types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

const makeSnapshot = (tick = 0): BaseGameSnapshot => ({
    tick,
    seed: 1,
    players: {},
    entities: {},
    phase: gamePhase('test'),
    events: [],
    turnNumber: 0,
    timers: {},
    gameResult: null,
});

// ─── Constructor / capacity ───────────────────────────────────────────────────

describe('SnapshotRingBuffer — constructor', () => {
    it('defaults to capacity 200 (~10s at 20Hz)', () => {
        const buffer = new SnapshotRingBuffer();
        for (let tick = 1; tick <= 250; tick++) {
            buffer.record(tick, makeSnapshot(tick));
        }
        expect(buffer.allTicks()).toHaveLength(200);
    });

    it('respects an explicitly set capacity', () => {
        const buffer = new SnapshotRingBuffer(3);
        for (let tick = 1; tick <= 5; tick++) {
            buffer.record(tick, makeSnapshot(tick));
        }
        expect(buffer.allTicks()).toEqual([5, 4, 3]);
    });

    it('throws RangeError for a zero capacity', () => {
        expect(() => new SnapshotRingBuffer(0)).toThrow(RangeError);
    });

    it('throws RangeError for a negative capacity', () => {
        expect(() => new SnapshotRingBuffer(-1)).toThrow(RangeError);
    });

    it('throws RangeError for a non-integer capacity', () => {
        expect(() => new SnapshotRingBuffer(2.5)).toThrow(RangeError);
    });
});

// ─── record / get round-trip ──────────────────────────────────────────────────

describe('SnapshotRingBuffer — record/get round-trip', () => {
    it('returns the recorded entry with tick and the same snapshot reference', () => {
        const buffer = new SnapshotRingBuffer();
        const snapshot = makeSnapshot(7);

        buffer.record(7, snapshot);

        const entry = buffer.get(7);
        expect(entry).toBeDefined();
        expect(entry?.tick).toBe(7);
        expect(entry?.snapshot).toBe(snapshot);
    });

    it('returns undefined for a tick that was never recorded', () => {
        const buffer = new SnapshotRingBuffer();
        buffer.record(1, makeSnapshot(1));
        expect(buffer.get(99)).toBeUndefined();
    });

    it('returns undefined from an empty buffer', () => {
        const buffer = new SnapshotRingBuffer();
        expect(buffer.get(0)).toBeUndefined();
    });

    it('does not mutate the recorded snapshot', () => {
        const buffer = new SnapshotRingBuffer();
        const snapshot = Object.freeze(makeSnapshot(3));

        expect(() => buffer.record(3, snapshot)).not.toThrow();
        expect(snapshot.tick).toBe(3);
    });
});

// ─── Overwrite at capacity (Invariant #30, §10.1 scenario) ────────────────────

describe('SnapshotRingBuffer — overwrite at capacity (Invariant #30)', () => {
    it('250 entries into a capacity-200 buffer: last 200 retrievable, first 50 evicted', () => {
        const buffer = new SnapshotRingBuffer(200);
        for (let tick = 1; tick <= 250; tick++) {
            buffer.record(tick, makeSnapshot(tick));
        }

        for (let tick = 51; tick <= 250; tick++) {
            expect(buffer.get(tick)?.tick).toBe(tick);
        }
        for (let tick = 1; tick <= 50; tick++) {
            expect(buffer.get(tick)).toBeUndefined();
        }
    });

    it('never exceeds capacity at any point while recording', () => {
        const buffer = new SnapshotRingBuffer(10);
        for (let tick = 1; tick <= 100; tick++) {
            buffer.record(tick, makeSnapshot(tick));
            expect(buffer.allTicks().length).toBeLessThanOrEqual(10);
        }
    });

    it('overwrites the oldest entry silently (no throw, no growth)', () => {
        const buffer = new SnapshotRingBuffer(2);
        buffer.record(1, makeSnapshot(1));
        buffer.record(2, makeSnapshot(2));

        expect(() => buffer.record(3, makeSnapshot(3))).not.toThrow();
        expect(buffer.get(1)).toBeUndefined();
        expect(buffer.allTicks()).toEqual([3, 2]);
    });
});

// ─── allTicks ordering ────────────────────────────────────────────────────────

describe('SnapshotRingBuffer — allTicks()', () => {
    it('returns an empty array for an empty buffer', () => {
        expect(new SnapshotRingBuffer().allTicks()).toEqual([]);
    });

    it('returns ticks sorted newest first', () => {
        const buffer = new SnapshotRingBuffer();
        buffer.record(1, makeSnapshot(1));
        buffer.record(2, makeSnapshot(2));
        buffer.record(3, makeSnapshot(3));
        expect(buffer.allTicks()).toEqual([3, 2, 1]);
    });

    it('sorts newest first even when ticks are recorded out of order', () => {
        const buffer = new SnapshotRingBuffer();
        buffer.record(5, makeSnapshot(5));
        buffer.record(2, makeSnapshot(2));
        buffer.record(9, makeSnapshot(9));
        expect(buffer.allTicks()).toEqual([9, 5, 2]);
    });
});

// ─── Same-tick re-record ──────────────────────────────────────────────────────

describe('SnapshotRingBuffer — same-tick re-record', () => {
    it('replaces the entry in place — get() returns the latest snapshot', () => {
        const buffer = new SnapshotRingBuffer();
        const first = makeSnapshot(4);
        const second = makeSnapshot(4);

        buffer.record(4, first);
        buffer.record(4, second);

        expect(buffer.get(4)?.snapshot).toBe(second);
    });

    it('does not produce duplicate ticks in allTicks()', () => {
        const buffer = new SnapshotRingBuffer();
        buffer.record(4, makeSnapshot(4));
        buffer.record(4, makeSnapshot(4));
        expect(buffer.allTicks()).toEqual([4]);
    });

    it('does not consume an extra slot (re-played tick after undo)', () => {
        const buffer = new SnapshotRingBuffer(3);
        buffer.record(1, makeSnapshot(1));
        buffer.record(1, makeSnapshot(1));
        buffer.record(2, makeSnapshot(2));
        buffer.record(3, makeSnapshot(3));
        expect(buffer.allTicks()).toEqual([3, 2, 1]);
    });

    it('re-recording an evicted tick claims a fresh slot, not its stale one', () => {
        const buffer = new SnapshotRingBuffer(2);
        buffer.record(1, makeSnapshot(1));
        buffer.record(2, makeSnapshot(2));
        buffer.record(3, makeSnapshot(3)); // evicts tick 1

        const replayed = makeSnapshot(1);
        buffer.record(1, replayed); // evicts tick 2, must not touch tick 3's slot

        expect(buffer.allTicks()).toEqual([3, 1]);
        expect(buffer.get(1)?.snapshot).toBe(replayed);
        expect(buffer.get(2)).toBeUndefined();
        expect(buffer.get(3)?.tick).toBe(3);
    });
});

// ─── onRecord live-push hook ──────────────────────────────────────────────────

describe('SnapshotRingBuffer — onRecord hook', () => {
    it('fires once per record() with the stored entry', () => {
        const buffer = new SnapshotRingBuffer();
        const onRecord = vi.fn();
        buffer.onRecord = onRecord;
        const snapshot = makeSnapshot(6);

        buffer.record(6, snapshot);

        expect(onRecord).toHaveBeenCalledOnce();
        const entry = onRecord.mock.calls[0]?.[0] as RingBufferEntry;
        expect(entry.tick).toBe(6);
        expect(entry.snapshot).toBe(snapshot);
    });

    it('fires for every record call, including same-tick replacements', () => {
        const buffer = new SnapshotRingBuffer();
        const onRecord = vi.fn();
        buffer.onRecord = onRecord;

        buffer.record(1, makeSnapshot(1));
        buffer.record(2, makeSnapshot(2));
        buffer.record(2, makeSnapshot(2));

        expect(onRecord).toHaveBeenCalledTimes(3);
    });

    it('is optional — record() works without a hook assigned', () => {
        const buffer = new SnapshotRingBuffer();
        expect(() => buffer.record(1, makeSnapshot(1))).not.toThrow();
    });
});
