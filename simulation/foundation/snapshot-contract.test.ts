/**
 * simulation/foundation/snapshot-contract.test.ts
 *
 * Type-level and runtime unit tests for `PlayerSnapshot.timeScalePermille` and
 * its `WirePlayerSnapshot` twin — the ONE dilation field that crosses a
 * boundary.
 *
 * The two shapes are deliberately NOT unified (see the module header), so the
 * field is declared twice. Two declarations of one field can disagree silently:
 * a required declaration on one side and an optional one on the other compiles
 * everywhere until a snapshot without the field reaches the required side.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   The two `timeScalePermille` declarations are the SAME type, optionality
 *     included — asserted by a `Pick`-to-`Pick` type equality with an
 *     opposite-polarity control that a required declaration would fail it.
 *   Both declarations are OPTIONAL: a snapshot literal omitting the field
 *     satisfies both, which is what keeps every existing `createInitialState`
 *     and fixture compiling untouched.
 *
 * Written test-first: for a type-only module the meaningful red is at the type
 * layer. The `expectTypeOf`/`@ts-expect-error` assertions below fail
 * `tsc -p simulation/tsconfig.json` when the declarations are missing or
 * disagree; vitest alone cannot see them, because `import type` is erased and
 * `expectTypeOf(...)` is a runtime no-op.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';

import type { PlayerId } from './engine-contract.js';
import type { PlayerSnapshot, WirePlayerSnapshot } from './snapshot-contract.js';

// simulation/foundation/ is the foundation leaf, so its tests construct branded
// ids locally rather than importing the `playerId` factory from
// simulation/engine/types.ts.
const toPlayerId = (raw: string): PlayerId => raw as PlayerId;

const VIEWER = toPlayerId('p1');

/** The rich projection minus every optional field. */
const baseRich = {
    tick: 7,
    viewerId: VIEWER,
    players: {},
    entities: {},
    phase: 'playing' as PlayerSnapshot['phase'],
    events: [],
    gameResult: null,
    commitments: {},
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
} as const satisfies PlayerSnapshot;

/** The wire projection minus every optional field. */
const baseWire = {
    tick: 7,
    viewerId: VIEWER,
    players: {},
    entities: {},
    phase: 'playing',
    events: [],
    gameResult: null,
    undoMeta: { canUndo: false, canRedo: false },
    isMyTurn: true,
} as const satisfies WirePlayerSnapshot;

// ─── The two declarations agree ───────────────────────────────────────────────

describe('timeScalePermille is declared identically on both projected shapes', () => {
    it('the two declarations are the same type, optionality included', () => {
        expectTypeOf<Pick<PlayerSnapshot, 'timeScalePermille'>>().toEqualTypeOf<
            Pick<WirePlayerSnapshot, 'timeScalePermille'>
        >();
    });

    it('a REQUIRED declaration would not satisfy that equality (control)', () => {
        // Opposite polarity: without this, the assertion above would also pass
        // if BOTH declarations were required — "agree" is not "agree and
        // optional". This line reacts to the `PlayerSnapshot` side; the wire
        // side is held by the equality above and by the literals below.
        expectTypeOf<
            Pick<PlayerSnapshot, 'timeScalePermille'>
            // @ts-expect-error a required declaration is a different type.
        >().toEqualTypeOf<{ readonly timeScalePermille: number }>();

        expect(true).toBe(true);
    });

    it('reads as an optional integer permille on both shapes', () => {
        expectTypeOf<PlayerSnapshot['timeScalePermille']>().toEqualTypeOf<number | undefined>();
        expectTypeOf<WirePlayerSnapshot['timeScalePermille']>().toEqualTypeOf<number | undefined>();
    });
});

// ─── Optionality is what keeps existing snapshots compiling ───────────────────

describe('timeScalePermille is optional on both projected shapes', () => {
    it('a snapshot literal omitting the field satisfies both declarations', () => {
        const rich: PlayerSnapshot = baseRich;
        const wire: WirePlayerSnapshot = baseWire;

        expect(Object.hasOwn(rich, 'timeScalePermille')).toBe(false);
        expect(Object.hasOwn(wire, 'timeScalePermille')).toBe(false);
    });

    it('a snapshot literal carrying the field satisfies both declarations', () => {
        const rich: PlayerSnapshot = { ...baseRich, timeScalePermille: 250 };
        const wire: WirePlayerSnapshot = { ...baseWire, timeScalePermille: 250 };

        expect(rich.timeScalePermille).toBe(250);
        expect(wire.timeScalePermille).toBe(250);
    });

    it('rejects a non-numeric permille on both declarations', () => {
        const rich: PlayerSnapshot = {
            ...baseRich,
            // @ts-expect-error the permille is a number, not a string.
            timeScalePermille: '250',
        };
        const wire: WirePlayerSnapshot = {
            ...baseWire,
            // @ts-expect-error the permille is a number, not a string.
            timeScalePermille: '250',
        };

        expect(rich.timeScalePermille).toBe('250');
        expect(wire.timeScalePermille).toBe('250');
    });
});

// ─── The host-only fields never reach a projected shape ───────────────────────

describe('the host-only dilation state is absent from both projected shapes', () => {
    it('neither shape declares animationWindows or timeScaleRestoreBeats', () => {
        expectTypeOf<PlayerSnapshot>().not.toHaveProperty('animationWindows');
        expectTypeOf<PlayerSnapshot>().not.toHaveProperty('timeScaleRestoreBeats');
        expectTypeOf<WirePlayerSnapshot>().not.toHaveProperty('animationWindows');
        expectTypeOf<WirePlayerSnapshot>().not.toHaveProperty('timeScaleRestoreBeats');

        // Control: the projected twin IS declared, so `not.toHaveProperty`
        // above is discriminating rather than true of every name.
        expectTypeOf<PlayerSnapshot>().toHaveProperty('timeScalePermille');
        expectTypeOf<WirePlayerSnapshot>().toHaveProperty('timeScalePermille');
    });
});
