/**
 * renderer/animation/ClipPosition.test.ts
 *
 * Unit tests for `resolveClipPosition` — the pure, fail-soft resolver turning an
 * authored {@link ClipPosition} into a normalized phase in `[0, 1]`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * The posture mirrors `renderer/audio/audioCueSheet.ts` (Invariant #118): the
 * resolver NEVER throws and never calls a logger — it RETURNS the warning string
 * in the result, which is what makes "exactly one warning" a pure, synchronous
 * property of the return value rather than something a console spy has to count.
 *
 * Properties pinned here:
 *   - a phase resolves with no context at all; seconds need a duration; a frame
 *     needs a frame count. A missing one is `rejected`, never a default.
 *   - out-of-range inputs CLAMP into `[0, 1]`; unusable ones REJECT. The two are
 *     separately fixtured because collapsing them either way is a silent bug.
 *   - every rejection carries exactly one non-empty warning.
 */

import { describe, expect, it } from 'vitest';
import type { ClipPosition } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { resolveClipPosition } from './ClipPosition.js';

/** The resolved phase, or `null` when the call rejected. Keeps the cases terse. */
function phaseOf(
    position: ClipPosition,
    ctx: Parameters<typeof resolveClipPosition>[1],
): number | null {
    const result = resolveClipPosition(position, ctx);
    return result.kind === 'resolved' ? result.phase : null;
}

describe('resolveClipPosition', () => {
    describe('a bare number is already a phase', () => {
        it('resolves with an EMPTY context — neither duration nor frame count is consulted', () => {
            // The load-bearing half: a phase mark must compile for a clip whose
            // sheet declares no durationSeconds and no frameCount at all.
            expect(resolveClipPosition(0.25, {})).toEqual({ kind: 'resolved', phase: 0.25 });
        });

        it.each([
            ['both ends of the range', 0, 0],
            ['both ends of the range', 1, 1],
            ['above the range', 1.5, 1],
            ['below the range', -0.5, 0],
        ])('clamps %s: %d → %d', (_label, input, expected) => {
            expect(phaseOf(input, {})).toBe(expected);
        });

        it.each([
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
            ['-Infinity', Number.NEGATIVE_INFINITY],
        ])('rejects %s rather than clamping it', (_label, input) => {
            // Infinity would otherwise clamp to a perfectly plausible 1 and NaN
            // to 0 — a corrupt sheet silently becoming a mark at the clip end or
            // the clip start. Rejection is what makes the authoring error visible.
            const result = resolveClipPosition(input, {});
            expect(result.kind).toBe('rejected');
        });
    });

    describe('{ seconds } needs the clip duration', () => {
        it('divides by the duration it is given', () => {
            expect(phaseOf({ seconds: 0.5 }, { durationSeconds: 2 })).toBe(0.25);
        });

        it('is rejected when no durationSeconds is available, with exactly one warning', () => {
            const result = resolveClipPosition({ seconds: 2 }, {});

            expect(result).toEqual({ kind: 'rejected', warning: expect.any(String) });
            expect(result.kind === 'rejected' && result.warning.length).toBeGreaterThan(0);
        });

        it.each([
            ['zero', 0],
            ['negative', -1],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('is rejected against a %s duration', (_label, durationSeconds) => {
            // A zero duration is the one that matters: dividing by it yields
            // Infinity, which the clamp would turn into a phase of 1.
            expect(phaseOf({ seconds: 1 }, { durationSeconds })).toBeNull();
        });

        it('clamps a second beyond the clip end instead of rejecting it', () => {
            expect(phaseOf({ seconds: 9 }, { durationSeconds: 2 })).toBe(1);
        });

        it('clamps a negative second to the clip start', () => {
            expect(phaseOf({ seconds: -3 }, { durationSeconds: 2 })).toBe(0);
        });

        it('rejects a non-finite second even against a usable duration', () => {
            expect(phaseOf({ seconds: Number.NaN }, { durationSeconds: 2 })).toBeNull();
        });
    });

    describe('{ frame } needs the frame count', () => {
        it('maps a frame onto the START of its own cell, not onto the last cell boundary', () => {
            // frame / frameCount, so a 4-frame run gives 0, 0.25, 0.5, 0.75 and
            // frame 0 is the clip start. The rejected alternative — frame /
            // (frameCount - 1) — would put the LAST frame at phase 1, i.e. at the
            // clip end, where a 'once' clip has already stopped.
            expect(phaseOf({ frame: 0 }, { frameCount: 4 })).toBe(0);
            expect(phaseOf({ frame: 3 }, { frameCount: 4 })).toBe(0.75);
        });

        it('is rejected when no frameCount is available, with exactly one warning', () => {
            const result = resolveClipPosition({ frame: 3 }, {});

            expect(result).toEqual({ kind: 'rejected', warning: expect.any(String) });
            expect(result.kind === 'rejected' && result.warning.length).toBeGreaterThan(0);
        });

        it('is NOT rescued by a duration — the two context fields are independent', () => {
            // The single-axis case for the frame branch: a sheet that declares
            // durationSeconds but no frameCount still cannot place a frame.
            expect(phaseOf({ frame: 3 }, { durationSeconds: 2 })).toBeNull();
        });

        it.each([
            ['zero', 0],
            ['negative', -4],
            ['fractional', 2.5],
            ['NaN', Number.NaN],
        ])('is rejected against a %s frameCount', (_label, frameCount) => {
            expect(phaseOf({ frame: 1 }, { frameCount })).toBeNull();
        });

        it('rejects a fractional frame index', () => {
            expect(phaseOf({ frame: 1.5 }, { frameCount: 4 })).toBeNull();
        });

        it('clamps a frame past the end of the run', () => {
            expect(phaseOf({ frame: 99 }, { frameCount: 4 })).toBe(1);
        });

        it('clamps a negative frame to the clip start', () => {
            expect(phaseOf({ frame: -2 }, { frameCount: 4 })).toBe(0);
        });
    });

    describe('shapes that are not a position at all', () => {
        // `ClipPosition` is a typed union, but a sheet reaches this resolver from
        // the `unknown` metadata slot, so the shapes below are physically
        // reachable. Each is `rejected` rather than thrown.
        it.each([
            ['null', null],
            ['a string', '0.5'],
            ['an empty object', {}],
            ['an array', [0.5]],
            ['a seconds that is not a number', { seconds: '2' }],
            ['a frame that is not a number', { frame: '2' }],
        ])('rejects %s', (_label, input) => {
            const result = resolveClipPosition(input as ClipPosition, {
                durationSeconds: 2,
                frameCount: 4,
            });
            expect(result.kind).toBe('rejected');
        });

        it('rejects a position carrying BOTH seconds and frame rather than silently preferring one', () => {
            // Nothing in the type forbids the union's two object arms being
            // merged, and either precedence would place the mark somewhere the
            // author did not write. Ambiguity is an authoring error.
            // No cast: excess-property checking lets a literal carry members of
            // ANY arm of a union, so this merged shape is what the type already
            // admits — which is the reason the branch has to exist.
            const result = resolveClipPosition(
                { seconds: 1, frame: 3 },
                { durationSeconds: 2, frameCount: 4 },
            );
            expect(result.kind).toBe('rejected');
        });
    });

    describe('the fail-soft guarantee', () => {
        /** Every shape that rejects, including the ones only the warning text touches. */
        function hostileInputs(): readonly unknown[] {
            const cyclic: Record<string, unknown> = { seconds: 1 };
            cyclic['self'] = cyclic;
            return [
                undefined,
                null,
                Number.NaN,
                'x',
                {},
                { seconds: null },
                { frame: {} },
                [],
                () => 0,
                Symbol('nope'),
                cyclic,
                // `JSON.stringify` answers `undefined` — not a string — for this
                // one, so the rendering has to survive that as well as a throw.
                { seconds: 'x', toJSON: () => undefined },
            ];
        }

        it('never throws, for any input, with or without a context', () => {
            for (const input of hostileInputs()) {
                expect(() => resolveClipPosition(input as ClipPosition, {})).not.toThrow();
                expect(() =>
                    resolveClipPosition(input as ClipPosition, {
                        durationSeconds: 2,
                        frameCount: 4,
                    }),
                ).not.toThrow();
            }
        });

        it('answers every hostile input with a rejection carrying a non-empty warning', () => {
            // The header claims this of EVERY rejection, so it is asserted over
            // every rejecting shape rather than at the two sites where a missing
            // context field is the cause.
            for (const input of hostileInputs()) {
                const result = resolveClipPosition(input as ClipPosition, {});

                expect(result.kind, String(typeof input)).toBe('rejected');
                expect(
                    result.kind === 'rejected' ? result.warning : '',
                    String(typeof input),
                ).not.toBe('');
            }
        });

        it('renders the offending position into the warning, and a cycle as a placeholder', () => {
            // Without this the whole rendering could return the empty string and
            // every case above would still pass. The cyclic case is the one that
            // makes the `try`/`catch` load-bearing: `JSON.stringify` throws a
            // TypeError on it, which would otherwise escape into the caller.
            const plain = resolveClipPosition({ seconds: 2 }, {});
            expect(plain.kind === 'rejected' && plain.warning).toContain('{"seconds":2}');

            const cyclic: Record<string, unknown> = { seconds: 1 };
            cyclic['self'] = cyclic;
            const wrapped = resolveClipPosition(cyclic as ClipPosition, {});
            expect(wrapped.kind === 'rejected' && wrapped.warning).toContain('[unserializable]');

            const callable = resolveClipPosition((() => 0) as unknown as ClipPosition, {});
            expect(callable.kind === 'rejected' && callable.warning).toContain('[function]');

            // `JSON.stringify` answers `undefined` rather than a string here, so
            // without the fallback the warning would read "position undefined".
            const opaque = resolveClipPosition(
                { seconds: 'x', toJSON: () => undefined } as unknown as ClipPosition,
                {},
            );
            expect(opaque.kind === 'rejected' && opaque.warning).toContain('[unserializable]');
        });
    });

    it('does not mutate the position it is handed', () => {
        const position = Object.freeze({ seconds: 1 });

        expect(() => resolveClipPosition(position, { durationSeconds: 2 })).not.toThrow();
        expect(position).toEqual({ seconds: 1 });
    });
});
