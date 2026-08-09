/**
 * renderer/animation/__tests__/dilation-coherence.test.ts
 *
 * The two clocks meet here, once, and only to be compared.
 *
 * One passage is authored twice: as clip-relative positions the renderer plays
 * (`from`/`to`), and as beat integers the simulation opens (`beatWindow`).
 * `compileAnimationWindows` verifies the pair at content load; this case then
 * runs a REAL {@link ClipPlayer} over the same sheet at three time scales and
 * checks the two halves stay coherent.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **What is asserted, and what was deleted.** The design once claimed the two
 * spans were "identical, for every scale, automatically". They are not, and the
 * claim is gone rather than narrowed. Measured here at `tickRateMs = 50` with an
 * authored `0.11 / 0.53` window on a one-second clip, the mechanical spans are
 * 450, 1800 and 225 ms at 1000, 250 and 2000 permille, against visual spans of
 * 406.25, 1671.875 and 203.125 ms — the ideal 420 / 1680 / 210 ms rounded up to a
 * whole `DELTA_SECONDS` at each end by the sampling below.
 *
 * What the three cases assert instead is that the mechanical window covers the
 * visual one and exceeds it by less than two dilated beat periods, one per
 * outwardly rounded end. That is what a game may rely on: a hit that is visible
 * is inside the beats that can score it.
 */

import { describe, expect, it, vi } from 'vitest';

import { compileAnimationWindows } from '@chimera-engine/simulation/content/animationWindows.js';
import {
    dilatedBeatPeriodMs,
    timeScaleMultiplier,
} from '@chimera-engine/simulation/foundation/time-scale.js';
import type { AnimationTrackSheet } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { createFakeClipBackend } from '../__test-support__/fakeClipBackend.js';
import { ClipPlayer } from '../ClipPlayer.js';

/** The game's undilated beat period — `DEFAULT_TICK_RATE_MS`, i.e. 20 Hz. */
const TICK_RATE_MS = 50;

/** The clip's real, loaded length. */
const CLIP_DURATION_SECONDS = 1;

/**
 * The frame delta the player is fed, uniformly. A negative power of two so every
 * phase the fake backend accumulates is exact and the measured spans below are
 * decided by the rules under test rather than by float drift.
 */
const DELTA_SECONDS = 1 / 64;

/** Where the passage sits, as the content author wrote it. */
const FROM_PHASE = 0.11;
const TO_PHASE = 0.53;

/** The visual span in seconds, at real time. */
const VISUAL_SPAN_SECONDS = (TO_PHASE - FROM_PHASE) * CLIP_DURATION_SECONDS;

const SHEET: { readonly clips: Readonly<Record<string, AnimationTrackSheet>> } = {
    clips: {
        swing: {
            durationSeconds: CLIP_DURATION_SECONDS,
            loop: 'loop',
            passages: {
                strike: {
                    from: FROM_PHASE,
                    to: TO_PHASE,
                    // floor(0.11 x 1000 / 50) = 2; ceil(0.53 x 1000 / 50) = 11.
                    beatWindow: [2, 11],
                    window: 'melee-hit',
                },
            },
        },
    },
};

/** Enough ticks for the slowest scale under test to cross the passage twice over. */
const TICK_LIMIT = 1000;

/**
 * The wall-clock seconds a real player consumes between `passage-start` and the
 * `passage-end('reached-end')` that answers it.
 *
 * Counted as raw deltas fed AFTER the tick that opened the passage, up to and
 * including the tick that closed it — so the result is the true span rounded up
 * to a whole delta at each end, and is within one delta of it.
 */
function measureVisualSpanSeconds(permille: number): number {
    const backend = createFakeClipBackend({
        swing: { durationSeconds: CLIP_DURATION_SECONDS, loop: 'loop' },
    });
    const report = vi.fn();
    const player = new ClipPlayer({
        backend,
        getTimeScale: () => timeScaleMultiplier(permille),
        report,
    });

    let started = false;
    let closed = false;
    player.play({
        clipName: 'swing',
        sheet: SHEET,
        handlers: {
            onPassageStart: () => {
                started = true;
            },
            onPassageEnd: (event) => {
                if (event.reason === 'reached-end') {
                    closed = true;
                }
            },
        },
    });

    let spanSeconds = 0;
    for (let tick = 0; tick < TICK_LIMIT && !closed; tick += 1) {
        const wasOpen = started;
        player.tick(DELTA_SECONDS);
        if (wasOpen) {
            spanSeconds += DELTA_SECONDS;
        }
    }
    player.dispose();

    // The sheet compiles clean, the passage opened, and the passage closed
    // because it reached its end — not because the loop ran out of ticks.
    expect(report).not.toHaveBeenCalled();
    expect(started).toBe(true);
    expect(closed).toBe(true);
    return spanSeconds;
}

describe('the authored pair is verified before either half runs', () => {
    it('accepts the sheet and returns the authored beat window verbatim', () => {
        expect(compileAnimationWindows(SHEET, 'swing', TICK_RATE_MS)).toEqual([
            { passageName: 'strike', window: 'melee-hit', beatWindow: [2, 11] },
        ]);
    });
});

describe('renderer and simulation stay coherent at every time scale', () => {
    it.each([[1000], [250], [2000]])(
        'at %i permille the mechanical window covers the visual one, by under two beats',
        (permille) => {
            const [startBeat, endBeat] = compileAnimationWindows(SHEET, 'swing', TICK_RATE_MS)[0]
                ?.beatWindow ?? [0, 0];
            const durationBeats = endBeat - startBeat;
            const beatPeriodMs = dilatedBeatPeriodMs(TICK_RATE_MS, permille);

            const visualMs = measureVisualSpanSeconds(permille) * 1000;
            const mechanicalMs = durationBeats * beatPeriodMs;

            // The renderer half is proportional to the scale: dividing the
            // undilated span by the multiplier predicts it. Returning
            // `1000 / permille` where `permille / 1000` is meant inverts this at
            // 250 and at 2000. Margins here are 1.875, 7.5 and 8.75 ms against a
            // 15.625 ms delta.
            expect(
                Math.abs(visualMs / 1000 - VISUAL_SPAN_SECONDS / timeScaleMultiplier(permille)),
            ).toBeLessThanOrEqual(DELTA_SECONDS);

            // Margins here are 43.75, 128.125 and 21.875 ms.
            expect(mechanicalMs).toBeGreaterThanOrEqual(visualMs);
            expect(mechanicalMs - visualMs).toBeLessThan(2 * beatPeriodMs);
        },
    );

    it('measures three genuinely different scales rather than three copies of one', () => {
        // The control for the loop above: every assertion in it is relative to
        // the scale, so a `timeScaleMultiplier` that ignored its argument would
        // satisfy all three rows.
        const spans = [1000, 250, 2000].map(measureVisualSpanSeconds);

        expect(new Set(spans).size).toBe(3);
        expect(spans[1]).toBeGreaterThan(spans[0] ?? 0);
        expect(spans[2]).toBeLessThan(spans[0] ?? 0);
    });

    it('would fail the coverage claim if the window had been rounded inward', () => {
        // Rule WINDOW-OUTWARD-ROUNDING is what makes the `>=` above hold. An end
        // bound taken with `floor` instead of `ceil` yields eight beats, which is
        // shorter than the span the renderer actually plays.
        const inwardMs = 8 * dilatedBeatPeriodMs(TICK_RATE_MS, 1000);

        expect(inwardMs).toBeLessThan(measureVisualSpanSeconds(1000) * 1000);
    });
});
