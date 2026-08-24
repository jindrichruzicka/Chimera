/**
 * tacticsSfxJitter.test.ts
 *
 * Two claims: the draw-to-interval MAPPING covers exactly the authored band, and
 * the per-turn SEQUENCE varies within a turn while repeating for the same turn.
 *
 * The band ends are pinned as literals rather than derived from
 * `TACTICS_SFX_JITTER_SEMITONES`, so a widened band is a failure here and not a
 * silently-tracked constant; the sequence tests read the constant instead,
 * because what they claim is membership, not the width.
 */

import { describe, expect, it } from 'vitest';

import {
    TACTICS_SFX_JITTER_SEMITONES,
    createTacticsSfxJitter,
    tacticsSfxJitterSemitones,
} from './tacticsSfxJitter.js';

/** Draws taken from one turn's sequence, enough that a collision would be news. */
function drawSequence(tick: number, count: number): readonly number[] {
    const nextInterval = createTacticsSfxJitter(tick);
    return Array.from({ length: count }, () => nextInterval());
}

describe('tacticsSfxJitterSemitones', () => {
    it('maps the two ends of the draw range onto the two ends of the band', () => {
        // `1` is not a draw `float()` can return — the band is half-open at the top —
        // but the mapping is total, and pinning both ends is what fixes the width.
        expect(tacticsSfxJitterSemitones(0)).toBe(-1.5);
        expect(tacticsSfxJitterSemitones(1)).toBe(1.5);
    });

    it('leaves the middle draw at the clip authored pitch', () => {
        // The band is centred on the authored pitch, not offset from it: at rate 1
        // a clip plays as recorded. 0.5 is exact in binary, so this is an equality
        // rather than a tolerance.
        expect(tacticsSfxJitterSemitones(0.5)).toBe(0);
    });

    it('spaces the band evenly across the draw range', () => {
        // Interior literals, because the two ends and the middle are satisfied by a
        // three-valued step mapping (`draw < 0.5 ? -1.5 : draw > 0.5 ? 1.5 : 0`),
        // which would make three pitches reachable instead of a band. Quarter draws
        // are exact in binary, so these are equalities.
        expect(tacticsSfxJitterSemitones(0.25)).toBe(-0.75);
        expect(tacticsSfxJitterSemitones(0.75)).toBe(0.75);
    });
});

describe('createTacticsSfxJitter', () => {
    it('gives every play in one turn its own interval', () => {
        // The defect the jitter exists for: a burst of steps at one pitch reads as
        // a machine gun. Two units moving in one revealed turn draw twice.
        const intervals = drawSequence(8, 8);
        expect(new Set(intervals).size).toBe(intervals.length);
    });

    it('re-pitches the same play on the next turn', () => {
        // Kills the stream hoisted out of the turn: a factory built once would
        // hand every turn's first step the same interval.
        expect(drawSequence(9, 1)[0]).not.toBe(drawSequence(8, 1)[0]);
    });

    it('draws the same sequence for the same turn', () => {
        // What makes a turn's pitches reproducible at all, and the reason the stream
        // is seeded rather than drawn from `Math.random`. Measured here is one
        // process drawing the turn twice; that a second process draws the same
        // sequence follows from the stream taking no input but the tick, and is not
        // something a same-process comparison can pin.
        expect(drawSequence(8, 4)).toEqual(drawSequence(8, 4));
    });

    it('keeps every drawn interval inside the authored band', () => {
        for (const tick of [0, 1, 7, 8, 512, 65_537]) {
            for (const interval of drawSequence(tick, 16)) {
                expect(Math.abs(interval)).toBeLessThanOrEqual(TACTICS_SFX_JITTER_SEMITONES);
            }
        }
    });
});
