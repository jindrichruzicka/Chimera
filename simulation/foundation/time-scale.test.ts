/**
 * simulation/foundation/time-scale.test.ts
 *
 * Unit tests for the shared time-dilation arithmetic: the three permille
 * constants, `clampTimeScalePermille()`, and the reciprocal pair
 * `timeScaleMultiplier()` (the renderer's clip playback multiplier) and
 * `dilatedBeatPeriodMs()` (the host's declared beat period). Both halves of a
 * dilated hit read the SAME two helpers rather than re-deriving the arithmetic,
 * so a sign or reciprocal error is one visible edit.
 *
 * Feature reference: F82 — Animation System (time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Invariants upheld:
 *   #75/#76 — permille is a host pacing divisor, not a fractional gameplay
 *     quantity: nothing here calls `fromFloat()` and no result is snapshot state.
 *   #1 — `simulation/foundation/` is the zero-dependency engine leaf; this
 *     module imports nothing.
 */

import { describe, expect, it } from 'vitest';
import {
    clampTimeScalePermille,
    dilatedBeatPeriodMs,
    MAX_TIME_SCALE_PERMILLE,
    MIN_TIME_SCALE_PERMILLE,
    NORMAL_TIME_SCALE_PERMILLE,
    timeScaleMultiplier,
} from './time-scale.js';

describe('permille constants', () => {
    it('pin real time, the slowest and the fastest supported scale', () => {
        expect(NORMAL_TIME_SCALE_PERMILLE).toBe(1000);
        expect(MIN_TIME_SCALE_PERMILLE).toBe(50);
        expect(MAX_TIME_SCALE_PERMILLE).toBe(4000);
    });

    it('are integers', () => {
        for (const value of [
            NORMAL_TIME_SCALE_PERMILLE,
            MIN_TIME_SCALE_PERMILLE,
            MAX_TIME_SCALE_PERMILLE,
        ]) {
            expect(Number.isInteger(value)).toBe(true);
        }
    });
});

describe('clampTimeScalePermille', () => {
    // An exhaustive table: anything that is not a finite INTEGER falls back to
    // real time; a finite integer is clamped into [MIN, MAX]. The two rules are
    // distinct — 2.5 becomes 1000 rather than 50, which a plain
    // `Math.min(MAX, Math.max(MIN, value))` cannot produce.
    const table: readonly (readonly [string, number | undefined, number])[] = [
        ['undefined → real time', undefined, 1000],
        ['NaN → real time', Number.NaN, 1000],
        ['+Infinity → real time', Number.POSITIVE_INFINITY, 1000],
        ['-Infinity → real time', Number.NEGATIVE_INFINITY, 1000],
        ['a fractional permille → real time, never a clamp', 2.5, 1000],
        ['zero → the slowest scale', 0, 50],
        ['negative → the slowest scale', -1, 50],
        ['just under the floor → the slowest scale', 49, 50],
        ['the floor itself is kept', 50, 50],
        ['real time is kept', 1000, 1000],
        ['the ceiling itself is kept', 4000, 4000],
        ['above the ceiling → the fastest scale', 9999, 4000],
    ];

    it.each(table)('%s', (_label, input, expected) => {
        expect(clampTimeScalePermille(input)).toBe(expected);
    });
});

describe('timeScaleMultiplier / dilatedBeatPeriodMs', () => {
    // 1000 is real time; 250 is quarter speed; 2000 is double speed. All three
    // are load-bearing: an inverted helper is INDISTINGUISHABLE at 1000 and
    // fails at 250 and 2000 in OPPOSITE directions, so a single off-scale case
    // could be satisfied by the wrong formula.
    const SCALES = [1000, 250, 2000] as const;
    const BASE_PERIOD_MS = 50;

    it('reports the renderer multiplier as permille over one thousand', () => {
        expect(timeScaleMultiplier(1000)).toBe(1);
        expect(timeScaleMultiplier(250)).toBe(0.25);
        expect(timeScaleMultiplier(2000)).toBe(2);
    });

    it('reports the host beat period as the base period divided by the scale', () => {
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, 1000)).toBe(50);
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, 250)).toBe(200);
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, 2000)).toBe(25);
    });

    it.each(SCALES)('the two helpers are exact reciprocals at permille %i', (permille: number) => {
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, permille) * timeScaleMultiplier(permille)).toBe(
            BASE_PERIOD_MS,
        );
    });

    it('normalises through the one clamp — both helpers agree on an illegal scale', () => {
        expect(timeScaleMultiplier(9999)).toBe(timeScaleMultiplier(MAX_TIME_SCALE_PERMILLE));
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, 9999)).toBe(
            dilatedBeatPeriodMs(BASE_PERIOD_MS, MAX_TIME_SCALE_PERMILLE),
        );
        expect(timeScaleMultiplier(undefined)).toBe(1);
        expect(dilatedBeatPeriodMs(BASE_PERIOD_MS, undefined)).toBe(BASE_PERIOD_MS);
    });
});
