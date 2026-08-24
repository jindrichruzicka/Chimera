/**
 * renderer/audio/rate.test.ts
 *
 * Architecture reference: §4.25 — Audio System.
 *
 * Written test-first against a module that did not exist, so every red here is
 * "cannot resolve `./rate.js`" before it is an arithmetic failure.
 *
 * The interval cases are chosen so that no single one of them is satisfied by a
 * cheaper formula: `12 → 2` alone is also produced by `1 + n / 12`, and `0 → 1` by
 * every formula worth considering, so the octave DOWN and the single semitone are
 * what fence the exponential in.
 */

import { describe, expect, it } from 'vitest';

import { rateFromSemitones } from './rate.js';

describe('rateFromSemitones', () => {
    it('doubles the rate an octave up and halves it an octave down', () => {
        // Exact in binary — `2 ** 1` and `2 ** -1` — so no tolerance is owed here.
        expect(rateFromSemitones(12)).toBe(2);
        expect(rateFromSemitones(-12)).toBe(0.5);
    });

    it('leaves the rate at exactly 1 for no shift', () => {
        expect(rateFromSemitones(0)).toBe(1);
    });

    it('is the equal-tempered semitone, not a linear twelfth of an octave', () => {
        // A linear reading of "12 semitones is a doubling" gives 1 + 1/12 ≈ 1.0833
        // here and would still pass the octave cases; equal temperament gives this.
        expect(rateFromSemitones(1)).toBeCloseTo(1.0594630943592953, 12);
        expect(rateFromSemitones(7)).toBeCloseTo(1.4983070768766815, 12);
    });

    it('scales by 2 for every 12 semitones from any interval, not just from unison', () => {
        expect(rateFromSemitones(13)).toBeCloseTo(2 * rateFromSemitones(1), 12);
        expect(rateFromSemitones(-5)).toBeCloseTo(rateFromSemitones(7) / 2, 12);
    });

    it('normalises no interval, so each non-finite one takes its own exponential value', () => {
        // `-Infinity` is why this is not "passed through": the exponential carries it to
        // 0, which is finite and is not what went in. What the helper refuses to do is
        // NORMALISE — all three reach `normalizeRate`, the tier that warns and falls back.
        expect(rateFromSemitones(Number.NaN)).toBeNaN();
        expect(rateFromSemitones(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
        expect(rateFromSemitones(Number.NEGATIVE_INFINITY)).toBe(0);
    });
});
