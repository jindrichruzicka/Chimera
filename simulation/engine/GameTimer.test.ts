/**
 * simulation/engine/GameTimer.test.ts
 *
 * Unit tests for GameTimer, TimerRegistry, and TimerManager.
 * Architecture reference: §4.20 — Game Timers
 *
 * TDD: tests written first — red confirmed before implementation.
 *
 * Invariants upheld:
 *   #54 — GameTimer lives in GameSnapshot.timers; remainingTicks is tick-based.
 *   #44/#75 — a timer payload is JSON-persistable with integer numbers: `create()`
 *          refuses a bigint, a float and the shapes the refusal cases below
 *          list, naming the field. The type-level pins below fail
 *          `tsc -p simulation/tsconfig.json`, not vitest, when the type widens.
 *   #55 — TimerManager.advance() is pure; only engine:tick may call it.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FixedPoint } from './FixedPoint.js';
import { fromInt } from './FixedPoint.js';
import {
    TimerManager,
    type FiredTimerAction,
    type GameTimer,
    type TimerId,
    type TimerPayload,
    type TimerPayloadValue,
    type TimerRegistry,
} from './GameTimer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimer(overrides: Partial<GameTimer> = {}): GameTimer {
    return {
        id: 'timer-1' as TimerId,
        remainingTicks: 3,
        intervalTicks: 0,
        actionType: 'game:test_action',
        payload: {},
        active: true,
        ...overrides,
    };
}

function makeRegistry(timers: GameTimer[]): TimerRegistry {
    return Object.fromEntries(timers.map((t) => [t.id, t]));
}

// ─── TimerManager.create ─────────────────────────────────────────────────────

describe('TimerManager.create', () => {
    it('adds a new timer as active to an empty registry', () => {
        const registry: TimerRegistry = {};
        const next = TimerManager.create(registry, {
            id: 'timer-1' as TimerId,
            remainingTicks: 5,
            intervalTicks: 0,
            actionType: 'game:my_action',
            payload: { x: 1 },
        });

        expect(next['timer-1' as TimerId]).toBeDefined();
        expect(next['timer-1' as TimerId]?.active).toBe(true);
        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(5);
    });

    it('replaces an existing timer with the same id', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const next = TimerManager.create(registry, {
            id: 'timer-1' as TimerId,
            remainingTicks: 10,
            intervalTicks: 5,
            actionType: 'game:other_action',
            payload: {},
        });

        expect(Object.keys(next)).toHaveLength(1);
        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(10);
        expect(next['timer-1' as TimerId]?.intervalTicks).toBe(5);
    });

    it('does not mutate the input registry', () => {
        const registry: TimerRegistry = {};
        const frozen = Object.freeze({ ...registry });
        // Should not throw even though frozen (new object returned)
        const next = TimerManager.create(frozen, {
            id: 'timer-1' as TimerId,
            remainingTicks: 3,
            intervalTicks: 0,
            actionType: 'game:a',
            payload: {},
        });

        expect(frozen).toEqual({});
        expect(next).not.toBe(frozen);
    });

    it('preserves other timers when adding a new one', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-a' as TimerId })]);
        const next = TimerManager.create(registry, {
            id: 'timer-b' as TimerId,
            remainingTicks: 2,
            intervalTicks: 0,
            actionType: 'game:b',
            payload: {},
        });

        expect(Object.keys(next)).toHaveLength(2);
        expect(next['timer-a' as TimerId]).toEqual(registry['timer-a' as TimerId]);
    });
});

// ─── GameTimer.payload — the persistable shape ───────────────────────────────

describe('GameTimer.payload', () => {
    it('is the same persistable shape on the stored timer and on the fired action', () => {
        expectTypeOf<GameTimer['payload']>().toEqualTypeOf<TimerPayload>();
        expectTypeOf<FiredTimerAction['payload']>().toEqualTypeOf<TimerPayload>();
    });

    it('admits strings, integers, booleans, null, arrays and nested plain objects', () => {
        const timer: GameTimer = makeTimer({
            payload: {
                targetId: 'e-2',
                damage: 10,
                crit: false,
                note: null,
                pos: { x: 1, y: -2 },
                tags: ['burn', 'stack'],
                mixed: [1, { z: 0 }],
            },
        });

        expect(timer.payload['targetId']).toBe('e-2');
    });

    it('rejects a FixedPoint payload value — a bigint cannot be saved', () => {
        const reach: FixedPoint = fromInt(2);
        const timer: GameTimer = makeTimer({
            // @ts-expect-error payload values are JSON-persistable with integer
            //                  numbers (#44/#75): the registry is saved through
            //                  `JSON.stringify`, which throws on a bigint.
            payload: { reach },
        });

        expect(timer.payload['reach']).toBe(reach);
    });

    it('rejects a FixedPoint nested inside a payload value — the depth does not matter', () => {
        const reach: FixedPoint = fromInt(2);
        const timer: GameTimer = makeTimer({
            // @ts-expect-error a bigint is refused at any depth (#44/#75) —
            //                  `JSON.stringify` walks the whole payload.
            payload: { hit: { reach } },
        });

        expect(timer.payload['hit']).toEqual({ reach });
    });
});

// ─── TimerManager.create — payload guard ─────────────────────────────────────

describe('TimerManager.create — payload guard', () => {
    /** A payload built through the cast a stale caller would use. */
    function unchecked(payload: Record<string, unknown>): TimerPayload {
        return payload as unknown as TimerPayload;
    }

    it.each([
        ['a FixedPoint', fromInt(2), '8589934592n'],
        ['a float', 1.5, '1.5'],
        ['NaN', Number.NaN, 'NaN'],
        ['Infinity', Number.POSITIVE_INFINITY, 'Infinity'],
        ['undefined', undefined, 'undefined'],
        ['a function', () => 1, 'a function'],
        ['a symbol', Symbol('reach'), 'Symbol(reach)'],
        ['a Date', new Date(0), '[object Date]'],
        ['a Map', new Map(), '[object Map]'],
    ])(
        'throws RangeError naming the field on a payload value that is %s',
        (_label, value, rendered) => {
            // Why each shape is refused is in `assertPersistablePayload`'s doc
            // comment in GameTimer.ts; the rendered column pins what the error
            // names. A frozen registry proves nothing is written before the
            // refusal.
            const registry: TimerRegistry = Object.freeze({});

            expect(() =>
                TimerManager.create(registry, {
                    id: 'dot-e2' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 0,
                    actionType: 'game:apply_dot_damage',
                    payload: unchecked({ damage: 10, reach: value }),
                }),
            ).toThrow(RangeError);
            expect(() =>
                TimerManager.create(registry, {
                    id: 'dot-e2' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 0,
                    actionType: 'game:apply_dot_damage',
                    payload: unchecked({ damage: 10, reach: value }),
                }),
            ).toThrow(`payload field "reach" of timer "dot-e2" is ${rendered} `);
            expect(registry).toEqual({});
        },
    );

    it('names the path of a float nested in an object', () => {
        expect(() =>
            TimerManager.create(
                {},
                {
                    id: 'timer-1' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 0,
                    actionType: 'game:a',
                    payload: unchecked({ pos: { x: 1, y: 2.5 } }),
                },
            ),
        ).toThrow(/payload field "pos\.y" of timer "timer-1" is 2\.5/);
    });

    it('names the path of a bigint nested in an array', () => {
        expect(() =>
            TimerManager.create(
                {},
                {
                    id: 'timer-1' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 0,
                    actionType: 'game:a',
                    payload: unchecked({ hits: [1, fromInt(3)] }),
                },
            ),
        ).toThrow(/payload field "hits\[1\]" of timer "timer-1" is 12884901888n /);
    });

    it('accepts every persistable value shape and stores the payload as given', () => {
        const payload: TimerPayload = {
            targetId: 'e-2',
            zero: 0,
            negative: -7,
            largest: Number.MAX_SAFE_INTEGER,
            crit: false,
            note: null,
            pos: { x: 1, y: -2 },
            tags: ['burn', 'stack'],
            mixed: [1, { z: 0 }, [true, null]],
            empty: {},
            none: [],
        };
        const next = TimerManager.create(
            {},
            {
                id: 'timer-1' as TimerId,
                remainingTicks: 3,
                intervalTicks: 0,
                actionType: 'game:a',
                payload,
            },
        );

        expect(next['timer-1' as TimerId]?.payload).toBe(payload);
    });

    it('accepts a null-prototype object — JSON.stringify serialises it like any plain object', () => {
        const bare: Record<string, TimerPayloadValue> = Object.create(null) as Record<
            string,
            TimerPayloadValue
        >;
        bare['x'] = 1;
        const next = TimerManager.create(
            {},
            {
                id: 'timer-1' as TimerId,
                remainingTicks: 3,
                intervalTicks: 0,
                actionType: 'game:a',
                payload: { bare },
            },
        );

        expect(JSON.stringify(next['timer-1' as TimerId]?.payload)).toBe('{"bare":{"x":1}}');
    });
});

// ─── TimerManager.cancel ─────────────────────────────────────────────────────

describe('TimerManager.cancel', () => {
    it('marks an existing active timer as inactive', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, active: true })]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(next['timer-1' as TimerId]?.active).toBe(false);
    });

    it('does not mutate the input registry', () => {
        const timer = makeTimer({ id: 'timer-1' as TimerId, active: true });
        const registry = makeRegistry([timer]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(registry['timer-1' as TimerId]?.active).toBe(true);
        expect(next).not.toBe(registry);
    });

    it('is a no-op if the timer id does not exist', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId })]);
        const next = TimerManager.cancel(registry, 'nonexistent' as TimerId);

        expect(next).toEqual(registry);
    });

    it('leaves other timers unchanged', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, active: true }),
            makeTimer({ id: 'timer-2' as TimerId, active: true }),
        ]);
        const next = TimerManager.cancel(registry, 'timer-1' as TimerId);

        expect(next['timer-2' as TimerId]?.active).toBe(true);
    });
});

// ─── TimerManager.advance ────────────────────────────────────────────────────

describe('TimerManager.advance', () => {
    it('returns empty fired list when no timers are in registry', () => {
        const { next, fired } = TimerManager.advance({});

        expect(fired).toHaveLength(0);
        expect(next).toEqual({});
    });

    it('decrements remainingTicks of active timers by 1', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(2);
    });

    it('does not decrement inactive timers', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3, active: false }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(3);
    });

    it('fires a one-shot timer when remainingTicks reaches 0', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-1' as TimerId,
                remainingTicks: 1,
                intervalTicks: 0,
                actionType: 'game:heal',
                payload: { amount: 5 },
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(1);
        expect(fired[0]).toEqual({
            timerId: 'timer-1',
            actionType: 'game:heal',
            payload: { amount: 5 },
        });
    });

    it('REMOVES a fired one-shot timer from the registry rather than tombstoning it', () => {
        // The registry is snapshot-resident: an inactive entry left behind
        // would sit in every later save checkpoint for the rest of the
        // session. Asserted by KEY ABSENCE, not by `?.active` being falsy,
        // which a tombstone also satisfies.
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, intervalTicks: 0 }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect('timer-1' in next).toBe(false);
        expect(Object.keys(next)).toEqual([]);
    });

    it("keeps the fired one-shot's siblings, active and inactive alike", () => {
        // Removal is by identity of the FIRED entry: a sibling still counting
        // down keeps its slot, and a pre-existing inactive entry (a cancelled
        // timer, or a tombstone loaded from an older save) is passed through
        // untouched rather than swept.
        const registry = makeRegistry([
            makeTimer({ id: 'fires' as TimerId, remainingTicks: 1, intervalTicks: 0 }),
            makeTimer({ id: 'counting' as TimerId, remainingTicks: 4, intervalTicks: 0 }),
            makeTimer({ id: 'cancelled' as TimerId, remainingTicks: 2, active: false }),
        ]);
        const { next, fired } = TimerManager.advance(registry);

        expect(fired.map((f) => f.timerId)).toEqual(['fires']);
        expect(Object.keys(next)).toEqual(['counting', 'cancelled']);
        expect(next['counting' as TimerId]?.remainingTicks).toBe(3);
        expect(next['cancelled' as TimerId]).toBe(registry['cancelled' as TimerId]);
    });

    it('returns the input reference on the beat AFTER a one-shot fired, the registry being empty', () => {
        // What removal buys the clock-only broadcast path: with the fired
        // entry gone the registry is `{}`, so the next beat is the fast path
        // and `engine:tick` keeps `snapshot.timers` by reference. A tombstone
        // would also be skipped, but only because it is inactive; removal is
        // what keeps the registry from growing by one dead entry per fire.
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, intervalTicks: 0 }),
        ]);
        const { next: afterFire } = TimerManager.advance(registry);
        const { next: afterIdle, fired } = TimerManager.advance(afterFire);

        expect(afterFire).toEqual({});
        expect(afterIdle).toBe(afterFire);
        expect(fired).toHaveLength(0);
    });

    it('resets remainingTicks to intervalTicks for an interval timer after firing', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, intervalTicks: 3 }),
        ]);
        const { next } = TimerManager.advance(registry);

        expect(next['timer-1' as TimerId]?.remainingTicks).toBe(3);
        expect(next['timer-1' as TimerId]?.active).toBe(true);
    });

    it('fires an interval timer and keeps it active', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-1' as TimerId,
                remainingTicks: 1,
                intervalTicks: 5,
                actionType: 'game:dot',
                payload: { dmg: 10 },
            }),
        ]);
        const { fired, next } = TimerManager.advance(registry);

        expect(fired).toHaveLength(1);
        expect(fired[0]).toEqual({
            timerId: 'timer-1',
            actionType: 'game:dot',
            payload: { dmg: 10 },
        });
        expect(next['timer-1' as TimerId]?.active).toBe(true);
    });

    it('does not fire a timer that still has remainingTicks > 0 after decrement', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 2 })]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(0);
    });

    it('does not mutate the input registry', () => {
        const timer = makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 });
        const registry = makeRegistry([timer]);
        TimerManager.advance(registry);

        expect(registry['timer-1' as TimerId]?.remainingTicks).toBe(3);
    });

    it('returns a new registry object (no mutation)', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 3 })]);
        const { next } = TimerManager.advance(registry);

        expect(next).not.toBe(registry);
    });

    it('fires multiple timers in the same advance step', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-a' as TimerId,
                remainingTicks: 1,
                actionType: 'game:a',
                payload: {},
            }),
            makeTimer({
                id: 'timer-b' as TimerId,
                remainingTicks: 1,
                actionType: 'game:b',
                payload: {},
            }),
            makeTimer({
                id: 'timer-c' as TimerId,
                remainingTicks: 2,
                actionType: 'game:c',
                payload: {},
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(2);
        const types = fired.map((f) => f.actionType).sort();
        expect(types).toEqual(['game:a', 'game:b']);
    });

    it('does not fire an inactive timer even when remainingTicks would reach 0', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, remainingTicks: 1, active: false }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(0);
    });

    it('includes timerId in each fired action (invariant #54 traceability)', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-trace' as TimerId,
                remainingTicks: 1,
                actionType: 'game:heal',
                payload: { amount: 5 },
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(1);
        expect(fired[0]?.timerId).toBe('timer-trace');
    });

    it('includes correct timerId for each of multiple fired actions', () => {
        const registry = makeRegistry([
            makeTimer({
                id: 'timer-a' as TimerId,
                remainingTicks: 1,
                actionType: 'game:a',
                payload: {},
            }),
            makeTimer({
                id: 'timer-b' as TimerId,
                remainingTicks: 1,
                actionType: 'game:b',
                payload: {},
            }),
        ]);
        const { fired } = TimerManager.advance(registry);

        expect(fired).toHaveLength(2);
        const timerIds = fired.map((f) => f.timerId).sort();
        expect(timerIds).toEqual(['timer-a', 'timer-b']);
    });

    it('returns same registry reference when all timers are inactive (fast path)', () => {
        const registry = makeRegistry([
            makeTimer({ id: 'timer-1' as TimerId, active: false }),
            makeTimer({ id: 'timer-2' as TimerId, active: false }),
        ]);
        const { next } = TimerManager.advance(registry);

        // Identity check: should be the same object reference (no allocation)
        expect(next).toBe(registry);
    });

    it('returns stable frozen fired array reference when all timers are inactive', () => {
        const registry = makeRegistry([makeTimer({ id: 'timer-1' as TimerId, active: false })]);
        const { fired: fired1 } = TimerManager.advance(registry);
        const { fired: fired2 } = TimerManager.advance(registry);

        // Both should be the exact same reference (not just equal)
        expect(fired1).toBe(fired2);
        expect(fired1).toHaveLength(0);
    });

    it('returns same registry reference for empty registry (fast path)', () => {
        const registry: TimerRegistry = {};
        const { next } = TimerManager.advance(registry);

        // Identity check: should be the same empty object reference
        expect(next).toBe(registry);
    });
});
