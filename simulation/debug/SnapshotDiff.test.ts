/**
 * simulation/debug/SnapshotDiff.test.ts
 *
 * TDD tests for diffSnapshots — pure structural differ over two
 * GameSnapshots backing the Debug Inspector Diff View.
 *
 * Architecture reference: §4.12 (runtime-debug-layer.md)
 * Task: F47 / T2 (issue #691)
 *
 * Tests are written FIRST (red) before SnapshotDiff.ts exists.
 * They express the acceptance criteria from issue #691 and the §10.1 test
 * scenario: "Identical → empty; added entity → one `added` entry; changed
 * HP → one `changed` entry with before/after."
 */

import { describe, it, expect } from 'vitest';
import { diffSnapshots } from './SnapshotDiff.js';
import type { DiffEntry } from './SnapshotDiff.js';
import { entityId, gamePhase, playerId } from '../engine/types.js';
import type { BaseEntityState, BaseGameSnapshot, EntityId, GameEvent } from '../engine/types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

interface TestEntity extends BaseEntityState {
    readonly hp?: number;
    readonly shield?: number;
}

interface TestEvent extends GameEvent {
    readonly payload?: { readonly x: number };
}

interface TestSnapshot extends BaseGameSnapshot {
    readonly entities: Record<EntityId, TestEntity>;
    readonly events: readonly TestEvent[];
}

const u1 = entityId('unit-1');
const u2 = entityId('unit-2');
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
    ...overrides,
});

const tally = (entries: readonly DiffEntry[]): Record<DiffEntry['kind'], number> => ({
    added: entries.filter((entry) => entry.kind === 'added').length,
    removed: entries.filter((entry) => entry.kind === 'removed').length,
    changed: entries.filter((entry) => entry.kind === 'changed').length,
});

const deepFreeze = <T>(value: T): T => {
    if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
};

// ─── Identical snapshots ──────────────────────────────────────────────────────

describe('diffSnapshots — identical snapshots', () => {
    it('returns an empty diff with zeroed summary for the same reference', () => {
        const snapshot = makeSnapshot({ tick: 4 });
        const diff = diffSnapshots(snapshot, snapshot);
        expect(diff.entries).toEqual([]);
        expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 });
        expect(diff.fromTick).toBe(4);
        expect(diff.toTick).toBe(4);
    });

    it('returns an empty diff for structurally equal but distinct snapshots', () => {
        const from = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const to = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([]);
        expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 });
    });
});

// ─── Added ────────────────────────────────────────────────────────────────────

describe('diffSnapshots — added', () => {
    it('reports an added entity as exactly one entry with the whole entity as after', () => {
        const from = makeSnapshot();
        const to = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toHaveLength(1);
        expect(diff.entries[0]).toEqual({
            path: 'entities.unit-1',
            kind: 'added',
            after: { id: u1, hp: 10 },
        });
        expect(diff.entries[0]).not.toHaveProperty('before');
    });

    it('reports an added top-level optional field as one entry with the whole object', () => {
        const from = makeSnapshot();
        const to = makeSnapshot({ turnClock: { activePlayerId: p1, deadlineMs: 1000 } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'turnClock', kind: 'added', after: { activePlayerId: p1, deadlineMs: 1000 } },
        ]);
    });

    it('reports an added nested leaf at its full dot-delimited path', () => {
        const from = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const to = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10, shield: 5 } } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([{ path: 'entities.unit-1.shield', kind: 'added', after: 5 }]);
    });
});

// ─── Removed ──────────────────────────────────────────────────────────────────

describe('diffSnapshots — removed', () => {
    it('reports a removed entity as exactly one entry with the whole entity as before', () => {
        const from = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const to = makeSnapshot();
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toHaveLength(1);
        expect(diff.entries[0]).toEqual({
            path: 'entities.unit-1',
            kind: 'removed',
            before: { id: u1, hp: 10 },
        });
        expect(diff.entries[0]).not.toHaveProperty('after');
    });

    it('reports a removed nested leaf at its full dot-delimited path', () => {
        const from = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10, shield: 5 } } });
        const to = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'entities.unit-1.shield', kind: 'removed', before: 5 },
        ]);
    });
});

// ─── Changed ──────────────────────────────────────────────────────────────────

describe('diffSnapshots — changed', () => {
    it('reports a changed entity HP as exactly one entry with before and after', () => {
        const from = makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } });
        const to = makeSnapshot({ entities: { [u1]: { id: u1, hp: 7 } } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'entities.unit-1.hp', kind: 'changed', before: 10, after: 7 },
        ]);
    });

    it('reports a changed top-level primitive', () => {
        const from = makeSnapshot({ turnNumber: 0 });
        const to = makeSnapshot({ turnNumber: 1 });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'turnNumber', kind: 'changed', before: 0, after: 1 },
        ]);
    });

    it('reports a differing tick field and derives fromTick/toTick from the snapshots', () => {
        const from = makeSnapshot({ tick: 5 });
        const to = makeSnapshot({ tick: 9 });
        const diff = diffSnapshots(from, to);
        expect(diff.fromTick).toBe(5);
        expect(diff.toTick).toBe(9);
        expect(diff.entries).toEqual([{ path: 'tick', kind: 'changed', before: 5, after: 9 }]);
    });

    it('reports a shape mismatch as one changed entry with whole values and no leaf entries', () => {
        const from = makeSnapshot();
        const to = makeSnapshot({ gameResult: { winnerIds: [p1] } });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'gameResult', kind: 'changed', before: null, after: { winnerIds: [p1] } },
        ]);
    });
});

// ─── Arrays ───────────────────────────────────────────────────────────────────

describe('diffSnapshots — arrays', () => {
    it('reports a changed array element at its numeric path segment', () => {
        const from = makeSnapshot({ events: [{ type: 'a' }, { type: 'b' }] });
        const to = makeSnapshot({ events: [{ type: 'a' }, { type: 'c' }] });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'events.1.type', kind: 'changed', before: 'b', after: 'c' },
        ]);
    });

    it('reports a nested change inside an array element', () => {
        const from = makeSnapshot({ events: [{ type: 'a', payload: { x: 1 } }] });
        const to = makeSnapshot({ events: [{ type: 'a', payload: { x: 2 } }] });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'events.0.payload.x', kind: 'changed', before: 1, after: 2 },
        ]);
    });

    it('reports an appended element as added at its index', () => {
        const from = makeSnapshot({ events: [{ type: 'a' }] });
        const to = makeSnapshot({ events: [{ type: 'a' }, { type: 'b' }] });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([{ path: 'events.1', kind: 'added', after: { type: 'b' } }]);
    });

    it('reports a removed trailing element as removed at its index', () => {
        const from = makeSnapshot({ events: [{ type: 'a' }, { type: 'b' }] });
        const to = makeSnapshot({ events: [{ type: 'a' }] });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'events.1', kind: 'removed', before: { type: 'b' } },
        ]);
    });
});

// ─── Explicit undefined vs missing key ────────────────────────────────────────

describe('diffSnapshots — undefined-valued keys', () => {
    // A key present with value `undefined` is unrepresentable under
    // exactOptionalPropertyTypes, so these fixtures model the runtime shape
    // via a cast.
    const withExplicitUndefinedHost = (base: TestSnapshot): TestSnapshot =>
        ({ ...base, hostPlayerId: undefined }) as unknown as TestSnapshot;

    it('treats an explicitly undefined key the same as a missing key', () => {
        const from = makeSnapshot();
        const to = withExplicitUndefinedHost(makeSnapshot());
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([]);
    });

    it('reports undefined-to-value as added, not changed', () => {
        const from = withExplicitUndefinedHost(makeSnapshot());
        const to = makeSnapshot({ hostPlayerId: p1 });
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([{ path: 'hostPlayerId', kind: 'added', after: p1 }]);
    });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

describe('diffSnapshots — summary', () => {
    it('counts entries per kind for a mixed diff', () => {
        const from = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 10 }, [u2]: { id: u2 } },
            turnNumber: 0,
        });
        const to = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 7 } },
            turnNumber: 1,
            hostPlayerId: p1,
        });
        const diff = diffSnapshots(from, to);
        expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 2 });
        expect(diff.summary).toEqual(tally(diff.entries));
    });
});

// ─── Purity and determinism ───────────────────────────────────────────────────

describe('diffSnapshots — purity and determinism', () => {
    it('does not throw on deep-frozen inputs and still produces the diff', () => {
        const from = deepFreeze(makeSnapshot({ entities: { [u1]: { id: u1, hp: 10 } } }));
        const to = deepFreeze(makeSnapshot({ entities: { [u1]: { id: u1, hp: 7 } } }));
        const diff = diffSnapshots(from, to);
        expect(diff.entries).toEqual([
            { path: 'entities.unit-1.hp', kind: 'changed', before: 10, after: 7 },
        ]);
    });

    it('does not mutate either input snapshot', () => {
        const from = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 10 }, [u2]: { id: u2 } },
            events: [{ type: 'a', payload: { x: 1 } }],
        });
        const to = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 7 } },
            events: [{ type: 'a', payload: { x: 2 } }, { type: 'b' }],
        });
        const fromClone = structuredClone(from);
        const toClone = structuredClone(to);
        diffSnapshots(from, to);
        expect(from).toEqual(fromClone);
        expect(to).toEqual(toClone);
    });

    it('produces identical results when called twice with the same inputs', () => {
        const from = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 10 }, [u2]: { id: u2 } },
            turnNumber: 0,
        });
        const to = makeSnapshot({
            entities: { [u1]: { id: u1, hp: 7 } },
            turnNumber: 1,
        });
        expect(diffSnapshots(from, to)).toEqual(diffSnapshots(from, to));
    });
});
