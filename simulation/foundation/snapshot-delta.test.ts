/**
 * simulation/foundation/snapshot-delta.test.ts
 *
 * Tests for the after-only form of a snapshot diff and for applying it.
 *
 * Written RED before `snapshot-delta.ts` exists. The suite is built around one
 * property — `applySnapshotDelta(from, toSnapshotDelta(diffSnapshots(from, to)))`
 * reproduces `to` — plus the applicability rejections that make a desynced
 * receiver ask for a keyframe instead of diverging silently.
 */

import { describe, it, expect } from 'vitest';
import { diffSnapshots } from './snapshot-diff.js';
import { applySnapshotDelta, toSnapshotDelta } from './snapshot-delta.js';
import type { SnapshotDelta } from './snapshot-delta.js';
import type { EntityId, GamePhase, PlayerId } from './engine-contract.js';
import type { ObservedEntityState, PlayerSnapshot } from './snapshot-contract.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const entityId = (raw: string): EntityId => raw as EntityId;
const playerId = (raw: string): PlayerId => raw as PlayerId;
const gamePhase = (raw: string): GamePhase => raw as GamePhase;

const u1 = entityId('unit-1');
const u2 = entityId('unit-2');
const p1 = playerId('p1');

/** A game's own projected entity — `ObservedEntityState` plus gameplay fields. */
interface TestObservedEntity extends ObservedEntityState {
    readonly cell: { readonly x: number; readonly y: number };
    readonly hp?: number;
}

interface TestPlayerSnapshot extends PlayerSnapshot {
    readonly entities: Readonly<Record<EntityId, TestObservedEntity>>;
}

const makeEntity = (id: EntityId, x: number, y: number): TestObservedEntity => ({
    id,
    cell: { x, y },
});

const makeSnapshot = (overrides: Partial<TestPlayerSnapshot> = {}): TestPlayerSnapshot => ({
    tick: 0,
    viewerId: p1,
    players: { [p1]: { id: p1 } },
    entities: {},
    phase: gamePhase('play'),
    events: [],
    gameResult: null,
    commitments: {},
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
    ...overrides,
});

/** `diff → wire delta → apply`, the whole outbound/inbound path in one call. */
const roundTrip = (from: TestPlayerSnapshot, to: TestPlayerSnapshot): TestPlayerSnapshot | null =>
    applySnapshotDelta(from, toSnapshotDelta(diffSnapshots(from, to)));

// ─── The after-only wire form ─────────────────────────────────────────────────

describe('toSnapshotDelta', () => {
    it('never carries before on any entry of a mixed diff', () => {
        const from = makeSnapshot({
            tick: 4,
            entities: { [u1]: makeEntity(u1, 1, 1), [u2]: makeEntity(u2, 5, 5) },
        });
        const to = makeSnapshot({
            tick: 5,
            entities: { [u1]: makeEntity(u1, 2, 1) },
        });
        const diff = diffSnapshots(from, to);
        // The diff this is a projection of does carry `before` — otherwise the
        // assertion below would hold for a differ that never produced one.
        expect(diff.entries.some((entry) => 'before' in entry)).toBe(true);

        const delta = toSnapshotDelta(diff);
        expect(delta.entries.length).toBeGreaterThan(0);
        for (const entry of delta.entries) {
            expect(entry).not.toHaveProperty('before');
        }
    });

    it('keeps the path, kind and after of an added entry', () => {
        const from = makeSnapshot();
        const to = makeSnapshot({ entities: { [u1]: makeEntity(u1, 3, 4) } });
        expect(toSnapshotDelta(diffSnapshots(from, to)).entries).toEqual([
            { path: 'entities.unit-1', kind: 'added', after: { id: u1, cell: { x: 3, y: 4 } } },
        ]);
    });

    it('keeps the path, kind and after of a changed entry', () => {
        const from = makeSnapshot({ entities: { [u1]: makeEntity(u1, 3, 4) } });
        const to = makeSnapshot({ entities: { [u1]: makeEntity(u1, 3, 5) } });
        expect(toSnapshotDelta(diffSnapshots(from, to)).entries).toEqual([
            { path: 'entities.unit-1.cell.y', kind: 'changed', after: 5 },
        ]);
    });

    it('omits after entirely on a removed entry rather than sending undefined', () => {
        const from = makeSnapshot({ entities: { [u1]: makeEntity(u1, 3, 4) } });
        const to = makeSnapshot();
        const [entry] = toSnapshotDelta(diffSnapshots(from, to)).entries;
        expect(entry).toEqual({ path: 'entities.unit-1', kind: 'removed' });
        expect(entry).not.toHaveProperty('after');
        // JSON is what actually crosses the wire: an explicit `after: undefined`
        // would vanish there and read identically, so assert the serialised form.
        expect(JSON.stringify(entry)).toBe('{"path":"entities.unit-1","kind":"removed"}');
    });

    it('carries the diff header ticks through unchanged', () => {
        const from = makeSnapshot({ tick: 11 });
        const to = makeSnapshot({ tick: 12 });
        const delta = toSnapshotDelta(diffSnapshots(from, to));
        expect(delta.fromTick).toBe(11);
        expect(delta.toTick).toBe(12);
    });
});

// ─── Round trip ───────────────────────────────────────────────────────────────

describe('applySnapshotDelta — reproduces the new snapshot', () => {
    it('reproduces a snapshot whose entity moved', () => {
        const from = makeSnapshot({ tick: 1, entities: { [u1]: makeEntity(u1, 1, 1) } });
        const to = makeSnapshot({ tick: 2, entities: { [u1]: makeEntity(u1, 2, 1) } });
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('reproduces a snapshot an entity entered', () => {
        const from = makeSnapshot({ tick: 1, entities: { [u1]: makeEntity(u1, 1, 1) } });
        const to = makeSnapshot({
            tick: 2,
            entities: { [u1]: makeEntity(u1, 1, 1), [u2]: makeEntity(u2, 9, 9) },
        });
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('reproduces a snapshot an entity left — removal is not a null', () => {
        const from = makeSnapshot({
            tick: 1,
            entities: { [u1]: makeEntity(u1, 1, 1), [u2]: makeEntity(u2, 9, 9) },
        });
        const to = makeSnapshot({ tick: 2, entities: { [u1]: makeEntity(u1, 1, 1) } });
        const applied = roundTrip(from, to);
        expect(applied).toEqual(to);
        expect(Object.keys(applied?.entities ?? {})).toEqual([u1]);
    });

    it('reproduces a snapshot whose baseline holds an own key valued undefined', () => {
        // The differ reads a key present with value `undefined` as ABSENT and
        // emits `added` for it (`snapshot-diff.test.ts`: "reports
        // undefined-to-value as added, not changed"). The receiver therefore has
        // to read it as absent too: an applicability check on key PRESENCE alone
        // would refuse this round trip and send the viewer back for a keyframe
        // it does not need. Unrepresentable under exactOptionalPropertyTypes, so
        // the runtime shape is modelled through a cast.
        const from = {
            ...makeSnapshot({ tick: 1 }),
            matchId: undefined,
        } as unknown as TestPlayerSnapshot;
        const to = makeSnapshot({ tick: 2, matchId: 'm-1' });
        expect(Object.hasOwn(from, 'matchId')).toBe(true);
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('reproduces a snapshot whose optional field was dropped', () => {
        const from = makeSnapshot({ tick: 1, matchId: 'm-1' });
        const to = makeSnapshot({ tick: 2 });
        const applied = roundTrip(from, to);
        expect(applied).toEqual(to);
        expect(Object.keys(applied ?? {})).not.toContain('matchId');
    });

    it('reproduces an appended and a truncated event array', () => {
        const one = makeSnapshot({ tick: 1, events: [{ type: 'a' }] });
        const three = makeSnapshot({
            tick: 2,
            events: [{ type: 'a' }, { type: 'b' }, { type: 'c' }],
        });
        expect(roundTrip(one, three)).toEqual(three);
        const back = makeSnapshot({ tick: 3, events: [{ type: 'a' }] });
        expect(roundTrip(three, back)).toEqual(back);
    });

    it('truncates rather than leaving holes when several trailing elements go', () => {
        const from = makeSnapshot({
            tick: 1,
            events: [{ type: 'a' }, { type: 'b' }, { type: 'c' }],
        });
        const to = makeSnapshot({ tick: 2, events: [{ type: 'a' }] });
        const applied = roundTrip(from, to);
        expect(applied?.events).toHaveLength(1);
        // A hole reads as `undefined` through an index but survives JSON as
        // `null`, so the serialised form is what proves the array was truncated.
        expect(JSON.stringify(applied?.events)).toBe('[{"type":"a"}]');
    });

    it('reproduces a clock-only beat, where only the tick differs', () => {
        const from = makeSnapshot({ tick: 1, entities: { [u1]: makeEntity(u1, 1, 1) } });
        const to = makeSnapshot({ tick: 2, entities: { [u1]: makeEntity(u1, 1, 1) } });
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('reproduces the source snapshot when nothing at all changed', () => {
        const from = makeSnapshot({ tick: 7, entities: { [u1]: makeEntity(u1, 1, 1) } });
        const to = makeSnapshot({ tick: 7, entities: { [u1]: makeEntity(u1, 1, 1) } });
        expect(toSnapshotDelta(diffSnapshots(from, to)).entries).toEqual([]);
        expect(roundTrip(from, to)).toEqual(to);
    });
});

// ─── Immutability and structural sharing ──────────────────────────────────────

describe('applySnapshotDelta — immutability', () => {
    it('leaves the source snapshot untouched', () => {
        const from = makeSnapshot({
            tick: 1,
            entities: { [u1]: makeEntity(u1, 1, 1), [u2]: makeEntity(u2, 9, 9) },
            events: [{ type: 'a' }, { type: 'b' }],
        });
        const to = makeSnapshot({
            tick: 2,
            entities: { [u1]: makeEntity(u1, 4, 1) },
            events: [{ type: 'a' }],
        });
        const before = structuredClone(from);
        roundTrip(from, to);
        expect(from).toEqual(before);
    });

    it('applies onto a deep-frozen snapshot without throwing', () => {
        const deepFreeze = <T>(value: T): T => {
            if (typeof value === 'object' && value !== null) {
                for (const key of Object.keys(value)) {
                    deepFreeze((value as Record<string, unknown>)[key]);
                }
                Object.freeze(value);
            }
            return value;
        };
        const from = deepFreeze(
            makeSnapshot({ tick: 1, entities: { [u1]: makeEntity(u1, 1, 1) } }),
        );
        const to = makeSnapshot({ tick: 2, entities: { [u1]: makeEntity(u1, 2, 1) } });
        expect(roundTrip(from, to)).toEqual(to);
    });

    it('returns a new root object', () => {
        const from = makeSnapshot({ tick: 1 });
        const to = makeSnapshot({ tick: 2 });
        expect(roundTrip(from, to)).not.toBe(from);
    });

    it('shares every subtree the delta did not touch by reference', () => {
        const from = makeSnapshot({
            tick: 1,
            entities: { [u1]: makeEntity(u1, 1, 1), [u2]: makeEntity(u2, 9, 9) },
        });
        const to = makeSnapshot({
            tick: 2,
            entities: { [u1]: makeEntity(u1, 2, 1), [u2]: from.entities[u2]! },
        });
        const applied = roundTrip(from, to);
        // Untouched: same object, not a structural copy.
        expect(applied?.entities[u2]).toBe(from.entities[u2]);
        expect(applied?.players).toBe(from.players);
        // Touched: copied, so the frozen source can never be written through.
        expect(applied?.entities).not.toBe(from.entities);
        expect(applied?.entities[u1]).not.toBe(from.entities[u1]);
        expect(applied?.entities[u1]?.cell).not.toBe(from.entities[u1]?.cell);
    });
});

// ─── Applicability ────────────────────────────────────────────────────────────

describe('applySnapshotDelta — rejects a delta it cannot apply', () => {
    const base = makeSnapshot({ tick: 5, entities: { [u1]: makeEntity(u1, 1, 1) } });

    /**
     * A hand-made delta advancing one beat. The `tick` entry is ALWAYS present,
     * so a delta carrying nothing else applies cleanly — which is what makes
     * every rejection below attributable to the entry under test rather than to
     * the header checks. The control directly beneath keeps that true.
     */
    const delta = (entries: SnapshotDelta['entries'], fromTick = 5): SnapshotDelta => ({
        fromTick,
        toTick: fromTick + 1,
        entries: [{ path: 'tick', kind: 'changed', after: fromTick + 1 }, ...entries],
    });

    it('applies a delta carrying only the tick change', () => {
        expect(applySnapshotDelta(base, delta([]))).toEqual({ ...base, tick: 6 });
    });

    it('rejects a delta whose baseline tick is not the held snapshot tick', () => {
        expect(applySnapshotDelta(base, delta([], 6))).toBeNull();
    });

    it('rejects a changed entry whose key is absent from the baseline', () => {
        expect(
            applySnapshotDelta(
                base,
                delta([{ path: 'entities.unit-2.hp', kind: 'changed', after: 1 }]),
            ),
        ).toBeNull();
    });

    it('rejects an added entry whose key already holds a value', () => {
        expect(
            applySnapshotDelta(
                base,
                delta([{ path: 'entities.unit-1', kind: 'added', after: {} }]),
            ),
        ).toBeNull();
    });

    it('rejects a removed entry whose key is absent from the baseline', () => {
        expect(
            applySnapshotDelta(base, delta([{ path: 'entities.unit-2', kind: 'removed' }])),
        ).toBeNull();
    });

    it('rejects a path that traverses a primitive', () => {
        expect(
            applySnapshotDelta(base, delta([{ path: 'tick.nope', kind: 'changed', after: 1 }])),
        ).toBeNull();
    });

    it('rejects an empty path and an empty path segment', () => {
        expect(applySnapshotDelta(base, delta([{ path: '', kind: 'added', after: 1 }]))).toBeNull();
        expect(
            applySnapshotDelta(base, delta([{ path: 'entities..hp', kind: 'changed', after: 1 }])),
        ).toBeNull();
    });

    it('rejects an array index one past the end — the first index that would hole', () => {
        // Index 1 on this array is the append the round-trip block exercises;
        // index 2 is the first that has to be refused. A fixture further out
        // leaves `index > length + 1` accepting an entry that punches a hole
        // JSON turns into a `null` the sender never had.
        const withEvents = makeSnapshot({ tick: 5, events: [{ type: 'a' }] });
        expect(
            applySnapshotDelta(
                withEvents,
                delta([{ path: 'events.2', kind: 'added', after: { type: 'z' } }]),
            ),
        ).toBeNull();
    });

    it('rejects a removal that would leave a hole in the middle of an array', () => {
        const withEvents = makeSnapshot({
            tick: 5,
            events: [{ type: 'a' }, { type: 'b' }, { type: 'c' }],
        });
        expect(
            applySnapshotDelta(withEvents, delta([{ path: 'events.1', kind: 'removed' }])),
        ).toBeNull();
    });

    it('rejects a numeric-looking segment that is not the canonical index string', () => {
        const withEvents = makeSnapshot({ tick: 5, events: [{ type: 'a' }, { type: 'b' }] });
        // Each of these coerces to an index an array would accept — '01' and
        // '+1' to 1, '-0' to 0 — while naming an element the delta did not.
        // ('1.0' is not here: `split('.')` makes it two segments, so the index
        // rule is never consulted and the case measures nothing about it.)
        for (const segment of ['01', '+1', '-0']) {
            expect(
                applySnapshotDelta(
                    withEvents,
                    delta([{ path: `events.${segment}`, kind: 'changed', after: { type: 'z' } }]),
                ),
            ).toBeNull();
        }
    });

    it('rejects a negative array index, which no in-range check would catch', () => {
        // Separate from the loop above and `added` rather than `changed`, because
        // a negative index is absent from the array either way: under `changed`
        // the absence guard rejects it and the index rule is never consulted.
        // Under `added` the index rule is the ONLY thing between `events.-1` and
        // a plain `-1` property on the receiver's array — an in-range test cannot
        // help, since -1 is below every length.
        const withEvents = makeSnapshot({ tick: 5, events: [{ type: 'a' }] });
        expect(
            applySnapshotDelta(
                withEvents,
                delta([{ path: 'events.-1', kind: 'added', after: { type: 'z' } }]),
            ),
        ).toBeNull();
    });

    it('rejects a changed or removed entry naming an inherited key', () => {
        // `base.toString` is defined — it is Object.prototype's — so a check on
        // the VALUE would let both of these through, and the removal would then
        // delete nothing while reporting success: the receiver would keep a
        // snapshot the sender does not have.
        expect(applySnapshotDelta(base, delta([{ path: 'toString', kind: 'removed' }]))).toBeNull();
        expect(
            applySnapshotDelta(
                base,
                delta([{ path: 'entities.unit-1.toString', kind: 'removed' }]),
            ),
        ).toBeNull();
        expect(
            applySnapshotDelta(base, delta([{ path: 'toString', kind: 'changed', after: 1 }])),
        ).toBeNull();
    });

    it('adds an inherited key as an OWN key rather than rejecting it', () => {
        // The mirror of the case above: `added` means "this key was absent", and
        // absent means not-own. The differ would only emit it for a snapshot that
        // really does carry an own `toString`, so applying it must produce one.
        const applied = applySnapshotDelta(
            base,
            delta([{ path: 'toString', kind: 'added', after: 1 }]),
        );
        expect(applied).not.toBeNull();
        expect(Object.hasOwn(applied as object, 'toString')).toBe(true);
    });

    it('rejects any path segment naming the prototype key', () => {
        expect(
            applySnapshotDelta(base, delta([{ path: '__proto__.x', kind: 'added', after: 1 }])),
        ).toBeNull();
        expect(
            applySnapshotDelta(base, delta([{ path: '__proto__', kind: 'added', after: {} }])),
        ).toBeNull();
    });

    it('rejects a delta whose entries do not land on the tick its header announces', () => {
        // Built without the helper, so it carries NO `tick` entry: `fromTick`
        // matches and the one entry applies, but nothing moves `tick` to 6.
        // Accepting it would hand the receiver a snapshot stamped 5 that it
        // believes is 6, and the divergence would surface only on the next delta.
        expect(
            applySnapshotDelta(base, {
                fromTick: 5,
                toTick: 6,
                entries: [{ path: 'entities.unit-1.cell.x', kind: 'changed', after: 9 }],
            }),
        ).toBeNull();
    });

    it('rejects a delta that claims the same array index for removal twice', () => {
        // Removals are collected and settled at the end, so nothing DELETES an
        // element as the entries are read and a repeated index would otherwise
        // be absorbed by the set. No diff of two snapshots emits one, so a delta
        // that does was not computed against this baseline.
        const withEvents = makeSnapshot({
            tick: 5,
            events: [{ type: 'a' }, { type: 'b' }, { type: 'c' }],
        });
        expect(
            applySnapshotDelta(
                withEvents,
                delta([
                    { path: 'events.2', kind: 'removed' },
                    { path: 'events.2', kind: 'removed' },
                ]),
            ),
        ).toBeNull();
    });

    it('rejects an array that the same delta both appends to and truncates', () => {
        // No diff of two snapshots emits this pair, but the delta is otherwise
        // well-formed: without the check, the truncation settles last and drops
        // the element the append just wrote, returning a snapshot that is
        // neither the baseline nor what the delta describes.
        const withEvents = makeSnapshot({ tick: 5, events: [{ type: 'a' }] });
        expect(
            applySnapshotDelta(
                withEvents,
                delta([
                    { path: 'events.1', kind: 'added', after: { type: 'b' } },
                    { path: 'events.0', kind: 'removed' },
                ]),
            ),
        ).toBeNull();
    });

    it('leaves the baseline untouched when it rejects part-way through', () => {
        const before = structuredClone(base);
        const applied = applySnapshotDelta(
            base,
            delta([
                { path: 'entities.unit-1.cell.x', kind: 'changed', after: 99 },
                { path: 'entities.unit-2', kind: 'removed' },
            ]),
        );
        expect(applied).toBeNull();
        expect(base).toEqual(before);
    });
});
