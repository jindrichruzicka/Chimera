/**
 * simulation/foundation/snapshot-diff.test.ts
 *
 * Tests for `diffSnapshots` — the pure structural differ behind the Debug
 * Inspector Diff View.
 *
 * Architecture reference: §4.12 (runtime-debug-layer.md)
 *
 * Fixtures are declared HERE rather than imported from `simulation/engine`,
 * for two reasons that are the point of this module rather than style:
 * `simulation/foundation` is the contract leaf and imports nothing above it,
 * and the differ's contract is `{ tick: number }` — a suite that could only
 * build authoritative-shaped state would stay green if the constraint were
 * tightened back to `BaseGameSnapshot`.
 */

import { describe, it, expect } from 'vitest';
import { diffSnapshots } from './snapshot-diff.js';
import type { DiffEntry } from './snapshot-diff.js';
import type { EntityId, GamePhase, GameResult, PlayerId } from './engine-contract.js';
import type { ObservedEntityState, PlayerSnapshot } from './snapshot-contract.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

const entityId = (raw: string): EntityId => raw as EntityId;
const playerId = (raw: string): PlayerId => raw as PlayerId;
const gamePhase = (raw: string): GamePhase => raw as GamePhase;

interface TestEntity {
    readonly id: EntityId;
    readonly hp?: number;
    readonly shield?: number;
}

interface TestEvent {
    readonly type: string;
    readonly payload?: { readonly x: number };
}

/**
 * Authoritative-shaped state — what the Inspector diffs. Mirrors
 * `BaseGameSnapshot`'s fields (`seed` and `timers` included) without importing
 * it, so this suite stays inside the contract leaf.
 */
interface TestSnapshot {
    readonly tick: number;
    readonly seed: number;
    readonly players: Readonly<Record<string, { readonly id: PlayerId }>>;
    readonly entities: Readonly<Record<string, TestEntity>>;
    readonly phase: GamePhase;
    readonly events: readonly TestEvent[];
    readonly turnClock?: { readonly activePlayerId: PlayerId; readonly deadlineMs: number };
    readonly turnNumber: number;
    readonly hostPlayerId?: PlayerId;
    readonly timers: Readonly<Record<string, unknown>>;
    readonly gameResult: GameResult | null;
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

/** A game's own projected entity — `ObservedEntityState` plus gameplay fields. */
interface TestObservedEntity extends ObservedEntityState {
    readonly x: number;
}

/**
 * Projected, viewer-facing state. It is NOT a `BaseGameSnapshot`: no `seed`,
 * no `timers` (Invariant #3).
 */
interface TestPlayerSnapshot extends PlayerSnapshot {
    readonly entities: Readonly<Record<EntityId, TestObservedEntity>>;
}

const makePlayerSnapshot = (overrides: Partial<TestPlayerSnapshot> = {}): TestPlayerSnapshot => ({
    tick: 0,
    viewerId: p1,
    players: { [p1]: { id: p1 } },
    entities: {},
    phase: gamePhase('test'),
    events: [],
    gameResult: null,
    commitments: {},
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
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

// ─── Projected player snapshots ───────────────────────────────────────────────

describe('diffSnapshots — projected player snapshots', () => {
    // A `PlayerSnapshot` carries no `seed` and no `timers` (Invariant #3), so
    // every case here fails to COMPILE under a `BaseGameSnapshot` constraint —
    // no cast is used, deliberately, because a cast is exactly what would hide
    // that.
    it('reports no entries for two structurally equal projections', () => {
        const diff = diffSnapshots(
            makePlayerSnapshot({ tick: 3 }),
            makePlayerSnapshot({ tick: 3 }),
        );
        expect(diff.entries).toEqual([]);
        expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 });
    });

    it('reports an entity that entered the projection as one added entry', () => {
        const from = makePlayerSnapshot();
        const to = makePlayerSnapshot({ entities: { [u1]: { id: u1, x: 1 } } });
        expect(diffSnapshots(from, to).entries).toEqual([
            { path: 'entities.unit-1', kind: 'added', after: { id: u1, x: 1 } },
        ]);
    });

    it('reports an entity that left the projection as one removed entry', () => {
        // A fog-hidden entity is ABSENT from a projection, never null — so
        // "gone" has to be a `removed` entry rather than a `changed` one to
        // `null`, or the viewer could never be told to drop it.
        const from = makePlayerSnapshot({ entities: { [u1]: { id: u1, x: 1 } } });
        const to = makePlayerSnapshot();
        expect(diffSnapshots(from, to).entries).toEqual([
            { path: 'entities.unit-1', kind: 'removed', before: { id: u1, x: 1 } },
        ]);
    });

    it('reports a changed entity field at its full path', () => {
        const from = makePlayerSnapshot({ entities: { [u1]: { id: u1, x: 1 } } });
        const to = makePlayerSnapshot({ entities: { [u1]: { id: u1, x: 2 } } });
        expect(diffSnapshots(from, to).entries).toEqual([
            { path: 'entities.unit-1.x', kind: 'changed', before: 1, after: 2 },
        ]);
    });

    it('derives fromTick/toTick from the projections themselves', () => {
        const diff = diffSnapshots(
            makePlayerSnapshot({ tick: 4 }),
            makePlayerSnapshot({ tick: 5 }),
        );
        expect(diff.fromTick).toBe(4);
        expect(diff.toTick).toBe(5);
    });
});
