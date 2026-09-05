/**
 * simulation/engine/AnimationWindow.test.ts
 *
 * Type-level and runtime unit tests for the host-only animation-window layer:
 * the vocabulary (`AnimationWindowId`, `AnimationWindowRecord`,
 * `AnimationWindowRegistry`, `WindowCloseReason`, `ClosedAnimationWindow`) and
 * the pure verbs that write it (`AnimationWindowManager.open` / `interrupt` /
 * `advance`). These are the shapes `BaseGameSnapshot.animationWindows` is built
 * from.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   `AnimationWindowId` is a BRANDED string: a bare `string` is not assignable
 *     to it, so a raw literal cannot silently become a window id.
 *   `WindowCloseReason` is exactly the four reasons — a fifth is rejected.
 *   `AnimationWindowRegistry` is keyed by `AnimationWindowId`.
 *   Each of the four close reasons is produced by a case constructed so the
 *     other three cannot fire.
 *   A window opened for N beats is present on exactly N consecutive `advance`
 *     results and reported `expired` on the next one.
 *   `advance` on an empty registry returns the INPUT reference and a frozen,
 *     shared empty closed-list, and builds no key or entry array on the way.
 *   `isEmpty` is true for an empty registry, false once a window is open, and
 *     stays true for an empty registry under a polluted `Object.prototype`.
 *   `open` refuses a non-integer or non-positive duration and a float payload.
 *   Every verb is pure: a deep-frozen input throws nothing and still equals a
 *     pre-call clone.
 *
 * Written test-first. For the type-level assertions the meaningful red is at
 * the type layer, not the runtime one: the `expectTypeOf`/`@ts-expect-error`
 * lines below fail `tsc -p simulation/tsconfig.json` when the source types are
 * missing or wrong, while vitest alone cannot see them, because `import type`
 * is erased and `expectTypeOf(...)` is a runtime no-op.
 *
 * The whole-module property the earlier revision pinned — that this file
 * bundles to the empty string, i.e. carries no runtime value at all — is
 * deliberately gone: the module now exports `AnimationWindowManager`. What that
 * pin protected on the CONSUMER side, that a contract import never pulls the
 * engine runtime graph (Invariant #1), is held by
 * `simulation/__tests__/contract-barrel-side-effects.test.ts`, which bundles
 * `simulation/index.ts` and `simulation/contracts/index.ts`.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';

import type {
    AnimationWindowId,
    AnimationWindowRecord,
    AnimationWindowRegistry,
    ClosedAnimationWindow,
    WindowCloseReason,
} from './AnimationWindow.js';
import { AnimationWindowManager } from './AnimationWindow.js';
import type { BaseGameSnapshot, EntityId } from './types.js';
import { entityId, gamePhase } from './types.js';
import type { FixedPoint } from './FixedPoint.js';
import { fromInt } from './FixedPoint.js';

const WINDOW_ID = 'sword-hit#1' as AnimationWindowId;
const OTHER_WINDOW_ID = 'shield-block#1' as AnimationWindowId;
const OWNER = entityId('unit-7');
const OTHER_OWNER = entityId('unit-8');

// ─── AnimationWindowId ────────────────────────────────────────────────────────

describe('AnimationWindowId', () => {
    it('is a branded string — a bare string is not assignable', () => {
        expectTypeOf<AnimationWindowId>().toExtend<string>();

        // @ts-expect-error a raw string literal must not become a window id
        //                  without passing through an explicit cast site.
        const unbranded: AnimationWindowId = 'sword-hit#1';

        expect(unbranded).toBe(WINDOW_ID);
    });
});

// ─── AnimationWindowRecord ────────────────────────────────────────────────────

describe('AnimationWindowRecord', () => {
    it('carries the id, the owning entity, the beat countdown and the payload', () => {
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 3,
            payload: { damage: 12 },
        };

        expectTypeOf<AnimationWindowRecord['id']>().toEqualTypeOf<AnimationWindowId>();
        expectTypeOf<AnimationWindowRecord['ownerId']>().toEqualTypeOf<EntityId>();
        expectTypeOf<AnimationWindowRecord['remainingBeats']>().toEqualTypeOf<number>();

        expect(record.remainingBeats).toBe(3);
    });

    it('accepts a FixedPoint payload value alongside an integer one', () => {
        const reach: FixedPoint = fromInt(2);
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 1,
            payload: { damage: 12, reach },
        };

        expect(record.payload['reach']).toBe(reach);
    });

    it('rejects a string payload value — the payload is numeric only', () => {
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 1,
            // @ts-expect-error payload values are integers or FixedPoint (#44/#75);
            //                  a string is not snapshot-resident numeric state.
            payload: { damageType: 'slashing' },
        };

        expect(record.payload['damageType']).toBe('slashing');
    });
});

// ─── AnimationWindowRegistry ──────────────────────────────────────────────────

describe('AnimationWindowRegistry', () => {
    it('is a record keyed by window id, mirroring TimerRegistry', () => {
        const registry: AnimationWindowRegistry = {
            [WINDOW_ID]: { id: WINDOW_ID, ownerId: OWNER, remainingBeats: 2, payload: {} },
        };

        expectTypeOf<AnimationWindowRegistry>().toEqualTypeOf<
            Record<AnimationWindowId, AnimationWindowRecord>
        >();

        expect(Object.keys(registry)).toEqual([WINDOW_ID]);
    });
});

// ─── WindowCloseReason ────────────────────────────────────────────────────────

describe('WindowCloseReason', () => {
    it('pins exactly the four close reasons', () => {
        expectTypeOf<WindowCloseReason>().toEqualTypeOf<
            'expired' | 'owner-gone' | 'replaced' | 'interrupted'
        >();

        const reasons: readonly WindowCloseReason[] = [
            'expired',
            'owner-gone',
            'replaced',
            'interrupted',
        ];

        expect(reasons).toHaveLength(4);
    });

    it('rejects a reason outside the four', () => {
        // @ts-expect-error 'cancelled' is not one of the four close reasons.
        const reason: WindowCloseReason = 'cancelled';

        expect(reason).toBe('cancelled');
    });
});

// ─── ClosedAnimationWindow ────────────────────────────────────────────────────

describe('ClosedAnimationWindow', () => {
    it('reports the closed record together with why it closed', () => {
        const closed: ClosedAnimationWindow = {
            id: WINDOW_ID,
            ownerId: OWNER,
            payload: { damage: 12 },
            reason: 'expired',
        };

        expectTypeOf<ClosedAnimationWindow['reason']>().toEqualTypeOf<WindowCloseReason>();
        expectTypeOf<ClosedAnimationWindow['payload']>().toEqualTypeOf<
            AnimationWindowRecord['payload']
        >();

        expect(closed.reason).toBe('expired');
    });

    it('carries no beat countdown — a closed window has none left to report', () => {
        const closed: ClosedAnimationWindow = {
            id: WINDOW_ID,
            ownerId: OWNER,
            payload: {},
            // @ts-expect-error a closed window reports no remaining beats.
            remainingBeats: 0,
            reason: 'owner-gone',
        };

        expect(closed.reason).toBe('owner-gone');
    });
});

// ─── Fixtures for the manager ─────────────────────────────────────────────────

function makeState(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 1,
        players: {},
        entities: {
            [OWNER]: { id: OWNER },
            [OTHER_OWNER]: { id: OTHER_OWNER },
        },
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        ...overrides,
    };
}

/** The live-entity set `engine:tick.reduce` would hand `advance`. */
function liveIds(state: BaseGameSnapshot): ReadonlySet<EntityId> {
    return new Set(Object.keys(state.entities) as EntityId[]);
}

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const member of Object.values(value)) deepFreeze(member);
        Object.freeze(value);
    }
    return value;
}

const clone = <T>(value: T): T => structuredClone(value);

const ALL_LIVE = new Set([OWNER, OTHER_OWNER]);
const NONE_LIVE: ReadonlySet<EntityId> = new Set();

// ─── open ─────────────────────────────────────────────────────────────────────

describe('AnimationWindowManager.open', () => {
    it('writes the record onto a snapshot that has never opened a window', () => {
        const { next, closed } = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 3,
            payload: { damage: 12 },
        });

        expect(next.animationWindows?.[WINDOW_ID]).toEqual({
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 3,
            payload: { damage: 12 },
        });
        expect(closed).toEqual([]);
    });

    it('defaults the payload to an empty object', () => {
        const { next } = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
        });

        expect(next.animationWindows?.[WINDOW_ID]?.payload).toEqual({});
    });

    it('leaves a window opened under a different id alone', () => {
        const first = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 3,
        }).next;

        const { next, closed } = AnimationWindowManager.open(first, {
            id: OTHER_WINDOW_ID,
            ownerId: OTHER_OWNER,
            durationBeats: 2,
        });

        expect(Object.keys(next.animationWindows ?? {}).sort()).toEqual(
            [WINDOW_ID, OTHER_WINDOW_ID].sort(),
        );
        expect(closed).toEqual([]);
    });

    it('accepts a FixedPoint payload value', () => {
        const reach: FixedPoint = fromInt(2);

        const { next } = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
            payload: { reach },
        });

        expect(next.animationWindows?.[WINDOW_ID]?.payload['reach']).toBe(reach);
    });

    it.each([
        ['zero beats', 0],
        ['a negative duration', -1],
        ['a fractional duration', 1.5],
    ])('throws RangeError on %s', (_label, durationBeats) => {
        expect(() =>
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats,
            }),
        ).toThrow(RangeError);
    });

    it('accepts a duration of one beat (boundary, positive control)', () => {
        const { next } = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
        });

        expect(next.animationWindows?.[WINDOW_ID]?.remainingBeats).toBe(1);
    });

    it('throws RangeError on a payload carrying a float', () => {
        expect(() =>
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 1,
                // A float in a snapshot-resident payload makes two machines
                // disagree (Invariants #44/#75), so it is refused at the write.
                payload: { damageMultiplier: 1.5 },
            }),
        ).toThrow(RangeError);
    });

    it('names the offending payload field in the RangeError', () => {
        expect(() =>
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 1,
                payload: { damage: 12, damageMultiplier: 1.5 },
            }),
        ).toThrow(/damageMultiplier/);
    });
});

// ─── The four close reasons, each in isolation ────────────────────────────────

describe('the four close reasons', () => {
    it('reports `replaced` when the same id is opened a second time', () => {
        // Only `open` runs, so no countdown reaches its end, no entity is
        // removed and nothing is interrupted.
        const first = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 5,
            payload: { damage: 12 },
        }).next;

        const { next, closed } = AnimationWindowManager.open(first, {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 5,
            payload: { damage: 99 },
        });

        expect(closed).toEqual([
            { id: WINDOW_ID, ownerId: OWNER, payload: { damage: 12 }, reason: 'replaced' },
        ]);
        // The report carries the REPLACED record, not the replacement.
        expect(next.animationWindows?.[WINDOW_ID]?.payload).toEqual({ damage: 99 });
    });

    it('reports `interrupted` for a live owner with beats still remaining', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 5,
            payload: { damage: 12 },
        }).next;

        // The owner is still an entity and the countdown is far from its end,
        // so neither `owner-gone` nor `expired` can fire.
        expect(opened.entities[OWNER]).toBeDefined();
        expect(opened.animationWindows?.[WINDOW_ID]?.remainingBeats).toBe(5);

        const { next, closed } = AnimationWindowManager.interrupt(opened, WINDOW_ID);

        expect(closed).toEqual([
            { id: WINDOW_ID, ownerId: OWNER, payload: { damage: 12 }, reason: 'interrupted' },
        ]);
        expect(next.animationWindows?.[WINDOW_ID]).toBeUndefined();
    });

    it('reports `owner-gone` while beats still remain', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 5,
            payload: { damage: 12 },
        }).next;

        // Beats remain, so `expired` cannot fire; nothing replaced or
        // interrupted it.
        expect(opened.animationWindows?.[WINDOW_ID]?.remainingBeats).toBe(5);

        const { next, closed } = AnimationWindowManager.advance(
            opened.animationWindows ?? {},
            NONE_LIVE,
        );

        expect(closed).toEqual([
            { id: WINDOW_ID, ownerId: OWNER, payload: { damage: 12 }, reason: 'owner-gone' },
        ]);
        expect(next[WINDOW_ID]).toBeUndefined();
    });

    it('prefers `owner-gone` on the beat the countdown would also have ended', () => {
        // The tie-break the comment on `advance` claims: both conditions hold at
        // once. Move the owner check below the countdown check and this reads
        // `expired`. The other two reasons need an `open` or an `interrupt`,
        // neither of which runs here.
        const registry: AnimationWindowRegistry = {
            [WINDOW_ID]: {
                id: WINDOW_ID,
                ownerId: OWNER,
                remainingBeats: 0,
                payload: { damage: 12 },
            },
        };

        const { closed } = AnimationWindowManager.advance(registry, NONE_LIVE);

        expect(closed).toEqual([
            { id: WINDOW_ID, ownerId: OWNER, payload: { damage: 12 }, reason: 'owner-gone' },
        ]);
    });

    it('reports `expired` on the same countdown when the owner IS live (control)', () => {
        // Opposite polarity for the tie-break above: the only difference is the
        // live-entity set, so the assertion there is about the owner check and
        // not about `remainingBeats: 0` always reading `owner-gone`.
        const registry: AnimationWindowRegistry = {
            [WINDOW_ID]: {
                id: WINDOW_ID,
                ownerId: OWNER,
                remainingBeats: 0,
                payload: { damage: 12 },
            },
        };

        const { closed } = AnimationWindowManager.advance(registry, ALL_LIVE);

        expect(closed[0]?.reason).toBe('expired');
    });

    it('reports `expired` for an owner alive throughout and never re-opened', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
            payload: { damage: 12 },
        }).next;

        const afterOne = AnimationWindowManager.advance(opened.animationWindows ?? {}, ALL_LIVE);
        expect(afterOne.closed).toEqual([]);

        const afterTwo = AnimationWindowManager.advance(afterOne.next, ALL_LIVE);

        expect(afterTwo.closed).toEqual([
            { id: WINDOW_ID, ownerId: OWNER, payload: { damage: 12 }, reason: 'expired' },
        ]);
        expect(afterTwo.next[WINDOW_ID]).toBeUndefined();
    });
});

// ─── The beat countdown ───────────────────────────────────────────────────────

describe('AnimationWindowManager.advance — the beat countdown', () => {
    it('keeps a 3-beat window on exactly three consecutive results, expiring on the fourth', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 3,
        }).next;

        let registry: AnimationWindowRegistry = opened.animationWindows ?? {};
        const presence: boolean[] = [];
        const collected: (readonly ClosedAnimationWindow[])[] = [];

        for (let beat = 0; beat < 4; beat += 1) {
            const result = AnimationWindowManager.advance(registry, ALL_LIVE);
            registry = result.next;
            presence.push(registry[WINDOW_ID] !== undefined);
            collected.push(result.closed);
        }

        // Off-by-one in either direction reds: a short countdown drops the third
        // `true`, a long one adds a fourth.
        expect(presence).toEqual([true, true, true, false]);
        expect(collected.map((list) => list.length)).toEqual([0, 0, 0, 1]);
        expect(collected[3]?.[0]?.reason).toBe('expired');
    });

    it('decrements the remaining beats by exactly one per advance', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 3,
        }).next;

        const first = AnimationWindowManager.advance(opened.animationWindows ?? {}, ALL_LIVE);
        const second = AnimationWindowManager.advance(first.next, ALL_LIVE);

        expect(first.next[WINDOW_ID]?.remainingBeats).toBe(2);
        expect(second.next[WINDOW_ID]?.remainingBeats).toBe(1);
    });

    it('advances every open window in the same sweep', () => {
        const both = AnimationWindowManager.open(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 2,
            }).next,
            { id: OTHER_WINDOW_ID, ownerId: OTHER_OWNER, durationBeats: 3 },
        ).next;

        const { next } = AnimationWindowManager.advance(both.animationWindows ?? {}, ALL_LIVE);

        expect(next[WINDOW_ID]?.remainingBeats).toBe(1);
        expect(next[OTHER_WINDOW_ID]?.remainingBeats).toBe(2);
    });
});

// ─── The empty fast path ──────────────────────────────────────────────────────

describe('AnimationWindowManager.advance — empty registry', () => {
    it('returns the input registry reference', () => {
        const registry: AnimationWindowRegistry = {};

        expect(AnimationWindowManager.advance(registry, ALL_LIVE).next).toBe(registry);
    });

    it('returns a frozen, shared empty closed-list', () => {
        const first = AnimationWindowManager.advance({}, ALL_LIVE).closed;
        const second = AnimationWindowManager.advance({}, ALL_LIVE).closed;

        expect(first).toEqual([]);
        expect(Object.isFrozen(first)).toBe(true);
        expect(first).toBe(second);
    });

    it('the non-empty path is not frozen-shared (control)', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
        }).next;

        const { closed } = AnimationWindowManager.advance(opened.animationWindows ?? {}, NONE_LIVE);

        expect(closed).toHaveLength(1);
        expect(closed).not.toBe(AnimationWindowManager.advance({}, ALL_LIVE).closed);
    });

    it('enumerates nothing on the empty path — no key or entry array is built', () => {
        const registry: AnimationWindowRegistry = {};
        const entries = vi.spyOn(Object, 'entries');
        const keys = vi.spyOn(Object, 'keys');
        try {
            AnimationWindowManager.advance(registry, ALL_LIVE);

            expect(entries.mock.calls.some(([record]) => record === registry)).toBe(false);
            expect(keys.mock.calls.some(([record]) => record === registry)).toBe(false);
        } finally {
            entries.mockRestore();
            keys.mockRestore();
        }
    });
});

// ─── isEmpty — the allocation-free emptiness probe ───────────────────────────

describe('AnimationWindowManager.isEmpty', () => {
    it('is true for a registry with no windows', () => {
        expect(AnimationWindowManager.isEmpty({})).toBe(true);
    });

    it('is false for a registry holding one window', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
        }).next;

        expect(AnimationWindowManager.isEmpty(opened.animationWindows ?? {})).toBe(false);
    });

    it('stays true for an empty registry while Object.prototype carries an enumerable key', () => {
        // The registry is a plain object. A probe that read inherited keys
        // would call a polluted-but-empty registry occupied and re-arm the
        // O(entities) sweep on every beat.
        Object.defineProperty(Object.prototype, 'polluted', {
            value: { id: 'polluted', ownerId: OWNER, remainingBeats: 1, payload: {} },
            enumerable: true,
            configurable: true,
            writable: true,
        });
        let result: boolean;
        try {
            result = AnimationWindowManager.isEmpty({});
        } finally {
            Reflect.deleteProperty(Object.prototype, 'polluted');
        }

        expect(result).toBe(true);
    });
});

// ─── interrupt on an id that is not open ──────────────────────────────────────

describe('AnimationWindowManager.interrupt — no such window', () => {
    it('returns the input state reference when the snapshot has no registry', () => {
        const state = makeState();

        expect(AnimationWindowManager.interrupt(state, WINDOW_ID).next).toBe(state);
    });

    it('returns the input state reference when the id is not open', () => {
        const opened = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 2,
        }).next;

        const { next, closed } = AnimationWindowManager.interrupt(opened, OTHER_WINDOW_ID);

        expect(next).toBe(opened);
        expect(closed).toEqual([]);
    });

    it('leaves the other open windows alone', () => {
        const both = AnimationWindowManager.open(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 2,
            }).next,
            { id: OTHER_WINDOW_ID, ownerId: OTHER_OWNER, durationBeats: 3 },
        ).next;

        const { next } = AnimationWindowManager.interrupt(both, WINDOW_ID);

        expect(Object.keys(next.animationWindows ?? {})).toEqual([OTHER_WINDOW_ID]);
    });
});

// ─── Purity ───────────────────────────────────────────────────────────────────

describe('the window verbs are pure', () => {
    it('open does not touch a deep-frozen input', () => {
        const state = deepFreeze(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 3,
            }).next,
        );
        const before = clone(state);

        expect(() =>
            AnimationWindowManager.open(state, {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 1,
            }),
        ).not.toThrow();
        expect(state).toEqual(before);
    });

    it('interrupt does not touch a deep-frozen input', () => {
        const state = deepFreeze(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 3,
            }).next,
        );
        const before = clone(state);

        expect(() => AnimationWindowManager.interrupt(state, WINDOW_ID)).not.toThrow();
        expect(state).toEqual(before);
    });

    it('advance does not touch a deep-frozen registry', () => {
        const registry = deepFreeze(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 3,
            }).next.animationWindows ?? {},
        );
        const before = clone(registry);

        expect(() => AnimationWindowManager.advance(registry, ALL_LIVE)).not.toThrow();
        expect(registry).toEqual(before);
    });

    it('advance does not touch a deep-frozen registry on the closing path', () => {
        // The assertion above keeps every window, so it never reaches the branch
        // that builds a closure out of a frozen record.
        const registry = deepFreeze(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 3,
                payload: { damage: 12 },
            }).next.animationWindows ?? {},
        );
        const before = clone(registry);

        const { closed } = AnimationWindowManager.advance(registry, NONE_LIVE);

        expect(closed).toHaveLength(1);
        expect(registry).toEqual(before);
    });

    it('carries every unrelated snapshot field through untouched', () => {
        const state = makeState({ tick: 9, turnNumber: 4, seed: 77 });

        const { next } = AnimationWindowManager.open(state, {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 1,
        });

        expect(next.tick).toBe(9);
        expect(next.turnNumber).toBe(4);
        expect(next.seed).toBe(77);
    });

    it('is a frozen object, so no caller can swap a verb out', () => {
        expect(Object.isFrozen(AnimationWindowManager)).toBe(true);
    });
});

// ─── The reduce-side helper `liveIds` mirrors the tick caller ─────────────────

describe('advance reads the live-entity set it is handed', () => {
    it('keeps a window whose owner is in the set and drops one whose owner is not', () => {
        const both = AnimationWindowManager.open(
            AnimationWindowManager.open(makeState(), {
                id: WINDOW_ID,
                ownerId: OWNER,
                durationBeats: 3,
            }).next,
            { id: OTHER_WINDOW_ID, ownerId: OTHER_OWNER, durationBeats: 3 },
        ).next;

        // Exactly the shape `engine:tick.reduce` would derive from the snapshot.
        const survivorsOnly = liveIds({ ...both, entities: { [OWNER]: { id: OWNER } } });

        const { next, closed } = AnimationWindowManager.advance(
            both.animationWindows ?? {},
            survivorsOnly,
        );

        expect(next[WINDOW_ID]?.remainingBeats).toBe(2);
        expect(closed).toEqual([
            { id: OTHER_WINDOW_ID, ownerId: OTHER_OWNER, payload: {}, reason: 'owner-gone' },
        ]);
    });
});
