/**
 * simulation/content/animationWindows.test.ts
 *
 * Unit tests for the content-load window verifier. `compileAnimationWindows`
 * does NOT derive a gameplay window from a visual passage — it RECOMPUTES the
 * window the passage implies under Rule WINDOW-OUTWARD-ROUNDING and compares it
 * against the one the game authored, throwing on disagreement and returning the
 * AUTHORED integers on agreement. Deriving would let the host pacing knob
 * `tickRateMs` determine how long a gameplay window lasts.
 *
 * Feature reference: F82 — Animation System (beat-owned gameplay windows,
 * content-load verification),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   An authored `beatWindow` is a pair of non-negative integers; a fractional
 *     or negative bound is refused rather than rounded.
 *   The verifier mutates no input.
 */

import { describe, expect, it } from 'vitest';
import {
    AnimationWindowMismatchError,
    beatsForRealSeconds,
    compileAnimationWindows,
} from './animationWindows';
import type {
    AnimationMarkName,
    AnimationPassage,
    ModelAnimationMetadata,
} from '../foundation/animation-clip-sheet.js';
import { dilatedBeatPeriodMs } from '../foundation/time-scale.js';

/** The engine default beat: `DEFAULT_TICK_RATE_MS = 50` → 20 Hz. */
const TICK_RATE_MS = 50;

/** A one-clip mesh sheet: `swing`, 0.4 s over 8 frames, with the given passages. */
function sheetWith(
    passages: Readonly<Record<AnimationMarkName, AnimationPassage>>,
): ModelAnimationMetadata {
    return { clips: { swing: { durationSeconds: 0.4, frameCount: 8, passages } } };
}

describe('compileAnimationWindows — agreement', () => {
    it('returns the AUTHORED tuple, by reference, when it matches the recomputed one', () => {
        const beatWindow = [2, 4] as const;
        const sheet = sheetWith({
            hit: { from: { seconds: 0.1 }, to: { seconds: 0.2 }, beatWindow, window: 'sword' },
        });

        const windows = compileAnimationWindows(sheet, 'swing', TICK_RATE_MS);

        expect(windows).toHaveLength(1);
        expect(windows[0]?.passageName).toBe('hit');
        expect(windows[0]?.window).toBe('sword');
        // Identity, not equality: a verifier that returned its OWN recomputed
        // tuple would pass a `toEqual` while silently becoming a deriver.
        expect(windows[0]?.beatWindow).toBe(beatWindow);
    });

    it('resolves a normalized phase against the clip duration', () => {
        // 0.25 and 0.5 of a 0.4 s clip are 0.1 s and 0.2 s — the same span as above.
        const sheet = sheetWith({ hit: { from: 0.25, to: 0.5, beatWindow: [2, 4] } });

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0]?.beatWindow).toEqual([
            2, 4,
        ]);
    });

    it('snaps an END that overshoots its beat by float noise (`to` side of the epsilon)', () => {
        // frame 3 of 8 over 0.4 s is 0.15000000000000002 s, i.e. 3.0000000000000004
        // beats. A bare `Math.ceil` rounds that to 4 and reports a mismatch;
        // the beat-epsilon snap keeps it at 3 (mutation control for the guard).
        const sheet = sheetWith({
            hit: { from: { frame: 0 }, to: { frame: 3 }, beatWindow: [0, 3] },
        });

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0]?.beatWindow).toEqual([
            0, 3,
        ]);
    });

    it('snaps a START that undershoots its beat by float noise (`from` side of the epsilon)', () => {
        // The epsilon is applied at TWO sites, and the case above pins only the
        // `to` one. frame 1 of 3 over 0.6 s is 0.19999999999999998 s, i.e.
        // 3.9999999999999996 beats: `Math.floor` alone reports beat 3, the snap
        // reports 4. Dropping `+ BEAT_EPSILON` from the `startBeat` line makes
        // this passage expect [3, 8] and reds (mutation control).
        const sheet = {
            clips: {
                swing: {
                    durationSeconds: 0.6,
                    frameCount: 3,
                    passages: { hit: { from: { frame: 1 }, to: { frame: 2 }, beatWindow: [4, 8] } },
                },
            },
        } satisfies ModelAnimationMetadata;

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0]?.beatWindow).toEqual([
            4, 8,
        ]);
    });

    it('omits the `window` key entirely when the passage declares no window id', () => {
        const beatWindow = [2, 4] as const;
        const sheet = sheetWith({ hit: { from: 0.25, to: 0.5, beatWindow } });

        const compiled = compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0];

        expect(compiled).toEqual({ passageName: 'hit', beatWindow: [2, 4] });
        expect(Object.hasOwn(compiled ?? {}, 'window')).toBe(false);
        // The no-window return fork is a SEPARATE object literal from the
        // window-carrying one, so it needs its own identity pin: without this a
        // deriver on that fork alone survives.
        expect(compiled?.beatWindow).toBe(beatWindow);
    });
});

describe('compileAnimationWindows — the structural one-beat floor', () => {
    it('gives a 10 ms passage a whole beat: [0, 1], never [0, 0]', () => {
        const sheet = sheetWith({
            flash: { from: { seconds: 0 }, to: { seconds: 0.01 }, beatWindow: [0, 1] },
        });

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0]?.beatWindow).toEqual([
            0, 1,
        ]);
    });

    it('rejects [0, 0] for that same 10 ms passage, naming [0, 1] as expected', () => {
        const sheet = sheetWith({
            flash: { from: { seconds: 0 }, to: { seconds: 0.01 }, beatWindow: [0, 0] },
        });

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toThrow(
            AnimationWindowMismatchError,
        );
    });

    it('gives an INSTANT passage a whole beat — dropping the floor reds this', () => {
        // A zero-length passage on a beat boundary:
        // `max(startBeat + 1, ceil(1)) = 2`, while a bare `ceil` yields 1 and
        // turns the window into the empty span [1, 1].
        const sheet = sheetWith({
            impact: { from: { seconds: 0.05 }, to: { seconds: 0.05 }, beatWindow: [1, 2] },
        });

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)[0]?.beatWindow).toEqual([
            1, 2,
        ]);
    });

    it('rejects the empty span a bare `ceil` would have produced for that instant', () => {
        const sheet = sheetWith({
            impact: { from: { seconds: 0.05 }, to: { seconds: 0.05 }, beatWindow: [1, 1] },
        });

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toThrow(
            AnimationWindowMismatchError,
        );
    });
});

describe('compileAnimationWindows — disagreement', () => {
    it('throws AnimationWindowMismatchError carrying clip, passage, authored and expected', () => {
        const sheet = sheetWith({
            hit: { from: { seconds: 0.1 }, to: { seconds: 0.2 }, beatWindow: [2, 3] },
        });

        let thrown: unknown;
        try {
            compileAnimationWindows(sheet, 'swing', TICK_RATE_MS);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(AnimationWindowMismatchError);
        const mismatch = thrown as AnimationWindowMismatchError;
        expect(mismatch.name).toBe('AnimationWindowMismatchError');
        expect(mismatch.clipName).toBe('swing');
        expect(mismatch.passageName).toBe('hit');
        expect(mismatch.authored).toEqual([2, 3]);
        expect(mismatch.expected).toEqual([2, 4]);
        expect(mismatch.message).toContain('swing');
        expect(mismatch.message).toContain('hit');
    });

    it('is sensitive to the START bound too, not only the end', () => {
        const sheet = sheetWith({
            hit: { from: { seconds: 0.1 }, to: { seconds: 0.2 }, beatWindow: [1, 4] },
        });

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toThrow(/\[1, 4\]/);
    });
});

describe('compileAnimationWindows — refusals', () => {
    it.each([
        ['a fractional end bound', [0, 1.5]],
        ['a fractional start bound', [0.5, 2]],
        ['a negative start bound', [-1, 2]],
        ['a negative end bound', [0, -2]],
    ])('throws RangeError on %s', (_label, beatWindow) => {
        const sheet = sheetWith({
            hit: {
                from: { seconds: 0.1 },
                to: { seconds: 0.2 },
                beatWindow: beatWindow as unknown as readonly [number, number],
            },
        });

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toThrow(RangeError);
    });

    it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])(
        'throws RangeError on a tickRateMs of %s',
        (tickRateMs) => {
            const sheet = sheetWith({
                hit: { from: { seconds: 0.1 }, to: { seconds: 0.2 }, beatWindow: [2, 4] },
            });

            expect(() => compileAnimationWindows(sheet, 'swing', tickRateMs)).toThrow(RangeError);
        },
    );

    // Every position-resolution branch, each tripped on its own so that dropping
    // any single conjunct leaves a named failure behind. `from` stays well-formed
    // wherever the case is about `to`, and vice versa.
    it.each([
        [
            'a non-finite phase',
            { durationSeconds: 0.4, frameCount: 8 },
            { from: Number.NaN, to: 0.5 },
        ],
        ['a negative phase', { durationSeconds: 0.4, frameCount: 8 }, { from: -0.25, to: 0.5 }],
        ['a phase on a clip with no durationSeconds', { frameCount: 8 }, { from: 0.25, to: 0.5 }],
        [
            'a phase on a clip whose durationSeconds is zero',
            { durationSeconds: 0, frameCount: 8 },
            { from: 0.25, to: 0.5 },
        ],
        [
            'a non-finite seconds position',
            { durationSeconds: 0.4 },
            { from: { seconds: Number.NaN }, to: { seconds: 0.2 } },
        ],
        [
            'a negative seconds position',
            { durationSeconds: 0.4 },
            { from: { seconds: -0.1 }, to: { seconds: 0.2 } },
        ],
        [
            'a fractional frame index',
            { durationSeconds: 0.4, frameCount: 8 },
            { from: { frame: 0 }, to: { frame: 2.5 } },
        ],
        [
            'a negative frame index',
            { durationSeconds: 0.4, frameCount: 8 },
            { from: { frame: -1 }, to: { frame: 3 } },
        ],
        [
            'a frame on a clip with no frameCount',
            { durationSeconds: 0.4 },
            { from: { frame: 0 }, to: { frame: 3 } },
        ],
        [
            'a frame on a clip whose frameCount is zero',
            { durationSeconds: 0.4, frameCount: 0 },
            { from: { frame: 0 }, to: { frame: 3 } },
        ],
        [
            'a frame on a clip whose frameCount is fractional',
            { durationSeconds: 0.4, frameCount: 2.5 },
            { from: { frame: 0 }, to: { frame: 3 } },
        ],
        [
            'a frame on a clip with no durationSeconds',
            { frameCount: 8 },
            { from: { frame: 0 }, to: { frame: 3 } },
        ],
        [
            'a frame on a clip whose durationSeconds is zero',
            { durationSeconds: 0, frameCount: 8 },
            { from: { frame: 0 }, to: { frame: 3 } },
        ],
    ])('throws RangeError on %s', (_label, clipFields, span) => {
        const sheet = {
            clips: { swing: { ...clipFields, passages: { hit: { ...span, beatWindow: [0, 3] } } } },
        } as ModelAnimationMetadata;

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toThrow(RangeError);
    });
});

describe('compileAnimationWindows — what it does NOT compile', () => {
    it('returns an empty list for a clip the sheet does not declare', () => {
        const sheet = sheetWith({ hit: { from: 0.25, to: 0.5, beatWindow: [2, 4] } });

        expect(compileAnimationWindows(sheet, 'idle', TICK_RATE_MS)).toEqual([]);
    });

    it('returns an empty list for a sheet with no clips at all', () => {
        expect(compileAnimationWindows({}, 'swing', TICK_RATE_MS)).toEqual([]);
    });

    it('skips a presentation-only passage — no beatWindow means no gameplay window', () => {
        const sheet = sheetWith({
            anticipation: { from: 0, to: 0.25 },
            hit: { from: 0.25, to: 0.5, beatWindow: [2, 4], window: 'sword' },
        });

        const windows = compileAnimationWindows(sheet, 'swing', TICK_RATE_MS);

        expect(windows.map((entry) => entry.passageName)).toEqual(['hit']);
    });

    it('returns an empty list for a clip that declares no passages', () => {
        const sheet = {
            clips: { swing: { durationSeconds: 0.4 } },
        } satisfies ModelAnimationMetadata;

        expect(compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).toEqual([]);
    });
});

describe('compileAnimationWindows — purity', () => {
    it('never mutates its input: a deep-frozen sheet compiles and stays identical', () => {
        const sheet = {
            clips: {
                swing: {
                    durationSeconds: 0.4,
                    frameCount: 8,
                    loop: 'once',
                    notifies: { impact: { at: { seconds: 0.15 } } },
                    passages: {
                        hit: {
                            from: { seconds: 0.1 },
                            to: { seconds: 0.2 },
                            beatWindow: [2, 4],
                            window: 'sword',
                        },
                    },
                },
            },
        } satisfies ModelAnimationMetadata;
        const before = structuredClone(sheet);
        deepFreeze(sheet);

        expect(() => compileAnimationWindows(sheet, 'swing', TICK_RATE_MS)).not.toThrow();
        expect(sheet).toEqual(before);
    });
});

describe('beatsForRealSeconds', () => {
    const REAL_SECONDS = 0.4;
    const SCALES = [1000, 250, 2000] as const;

    it('counts beats of the DILATED period, not of the base period', () => {
        expect(beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, 1000)).toBe(8);
        expect(beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, 250)).toBe(2);
        expect(beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, 2000)).toBe(16);
    });

    it.each(SCALES)(
        'beats × dilated beat period is exactly the real span in ms at permille %i',
        (permille: number) => {
            expect(
                beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, permille) *
                    dilatedBeatPeriodMs(TICK_RATE_MS, permille),
            ).toBe(REAL_SECONDS * 1000);
        },
    );

    it('falls back to real time for an absent or illegal scale', () => {
        expect(beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, undefined)).toBe(8);
        expect(beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, 9999)).toBe(
            beatsForRealSeconds(REAL_SECONDS, TICK_RATE_MS, 4000),
        );
    });

    it('throws RangeError when tickRateMs is not a finite positive number', () => {
        expect(() => beatsForRealSeconds(REAL_SECONDS, 0, 1000)).toThrow(RangeError);
    });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const member of Object.values(value)) deepFreeze(member);
        Object.freeze(value);
    }
    return value;
}
