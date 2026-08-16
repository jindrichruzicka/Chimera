/**
 * renderer/audio/Spatial.test.ts
 *
 * Architecture reference: §4.25 — Audio System → Spatial Audio.
 *
 * Invariants upheld:
 *   #117 — the static validation tier: every input here is synchronously knowable, so
 *          an already-invalid spec resolves to a named rejection with no decode, no
 *          node, and no side effect of any kind.
 *   #118 — rejection is a value handed back to `play()` (which owns the one warning),
 *          never a throw.
 *
 * Written test-first: the module did not exist, so every case was red as an
 * unresolvable import. The load-bearing behavioural reds, once it compiled, are the
 * platform-default resolution (an empty resolver returning the input would pass
 * nothing here), the `'linear'` engine default that diverges from the platform's
 * `'inverse'`, and the equal-distances hard cutoff — each pinned against inline
 * literals rather than the constants that produce them.
 *
 * Rejection fixtures move ONE conjunct at a time: `-1` is finite (killing only the
 * `>= 0` half of the scalar guard), `Infinity` is non-negative (killing only the
 * `Number.isFinite` half), and each position axis carries its own non-finite fixture
 * so no single axis check can stand in for the other two.
 */

import { describe, expect, it } from 'vitest';

import { resolveSpatialSpec, type SpatialOptions } from './Spatial';

const ORIGIN: SpatialOptions['position'] = [0, 0, 0];

function resolved(options: SpatialOptions): unknown {
    const resolution = resolveSpatialSpec(options);
    expect(resolution.kind).toBe('resolved');
    return resolution.kind === 'resolved' ? resolution.spec : null;
}

function rejectionWarning(options: SpatialOptions): string | null {
    const resolution = resolveSpatialSpec(options);
    expect(resolution.kind).toBe('rejected');
    return resolution.kind === 'rejected' ? resolution.warning : null;
}

describe('resolveSpatialSpec', () => {
    it('resolves an only-position spec to the platform defaults under the engine linear model', () => {
        // refDistance 1, maxDistance 10000 and rolloffFactor 1 are `createPanner()`'s
        // own defaults; the model is the ENGINE default, which is the one deliberate
        // divergence (only `'linear'` reaches zero at `maxDistance`).
        expect(resolved({ position: [1, 2, 3] })).toEqual({
            position: [1, 2, 3],
            distanceModel: 'linear',
            refDistance: 1,
            maxDistance: 10000,
            rolloffFactor: 1,
        });
    });

    it('maps authored fields onto the panner vocabulary with no arithmetic of its own', () => {
        expect(
            resolved({
                position: [-4, 0.5, 9],
                fullVolumeDistance: 2.5,
                falloffDistance: 40,
                falloff: 'exponential',
                rolloffFactor: 0.5,
            }),
        ).toEqual({
            position: [-4, 0.5, 9],
            distanceModel: 'exponential',
            refDistance: 2.5,
            maxDistance: 40,
            rolloffFactor: 0.5,
        });
    });

    it('passes each selectable falloff through as the distance model', () => {
        expect(resolved({ position: ORIGIN, falloff: 'inverse' })).toMatchObject({
            distanceModel: 'inverse',
        });
        expect(resolved({ position: ORIGIN, falloff: 'linear' })).toMatchObject({
            distanceModel: 'linear',
        });
    });

    it('accepts a fullVolumeDistance of zero, attenuating from the source', () => {
        expect(resolved({ position: ORIGIN, fullVolumeDistance: 0, falloffDistance: 6 })).toEqual({
            position: ORIGIN,
            distanceModel: 'linear',
            refDistance: 0,
            maxDistance: 6,
            rolloffFactor: 1,
        });
    });

    it('realises equal distances as the narrowest expressible band', () => {
        // 5 + 2^-13 exactly — the epsilon is a power-of-two fraction, so the sum has
        // an exact double representation and an inline literal can pin it.
        expect(resolved({ position: ORIGIN, fullVolumeDistance: 5, falloffDistance: 5 })).toEqual({
            position: ORIGIN,
            distanceModel: 'linear',
            refDistance: 5,
            maxDistance: 5.0001220703125,
            rolloffFactor: 1,
        });
    });

    it('keeps the hard-cutoff band above zero when both distances are zero', () => {
        // `maxDistance` must be strictly positive for the platform, so the epsilon is
        // what keeps an authored [0, 0] cutoff expressible at all.
        expect(
            resolved({ position: ORIGIN, fullVolumeDistance: 0, falloffDistance: 0 }),
        ).toMatchObject({ refDistance: 0, maxDistance: 0.0001220703125 });
    });

    it('rejects an inverted band, naming the resolved values', () => {
        expect(
            rejectionWarning({ position: ORIGIN, fullVolumeDistance: 5, falloffDistance: 2 }),
        ).toBe('Audio spatial distance band [5, 2] is already out of order; rejecting play().');
    });

    it('validates the band a defaulted bound resolves to, and says which values it used', () => {
        // Only `falloffDistance` is authored, so the platform-default `fullVolumeDistance`
        // of 1 participates — the warning prints the RESOLVED pair so the operator can
        // see the default that inverted it.
        expect(rejectionWarning({ position: ORIGIN, falloffDistance: 0.5 })).toBe(
            'Audio spatial distance band [1, 0.5] is already out of order; rejecting play().',
        );
    });

    it('rejects a negative distance rather than coercing it', () => {
        expect(rejectionWarning({ position: ORIGIN, fullVolumeDistance: -1 })).toBe(
            'Audio spatial fullVolumeDistance -1 is negative or not finite; rejecting play().',
        );
        expect(
            rejectionWarning({ position: ORIGIN, fullVolumeDistance: 0, falloffDistance: -2 }),
        ).toBe('Audio spatial falloffDistance -2 is negative or not finite; rejecting play().');
    });

    it('rejects a non-finite distance rather than deferring it', () => {
        // Unlike a cue bound, a distance has no dynamic tier to defer to: nothing the
        // decode could reveal makes `NaN` or `Infinity` a radius.
        expect(rejectionWarning({ position: ORIGIN, fullVolumeDistance: Number.NaN })).toBe(
            'Audio spatial fullVolumeDistance NaN is negative or not finite; rejecting play().',
        );
        expect(
            rejectionWarning({ position: ORIGIN, falloffDistance: Number.POSITIVE_INFINITY }),
        ).toBe(
            'Audio spatial falloffDistance Infinity is negative or not finite; rejecting play().',
        );
    });

    it('rejects a negative or non-finite rolloffFactor', () => {
        expect(rejectionWarning({ position: ORIGIN, rolloffFactor: -0.5 })).toBe(
            'Audio spatial rolloffFactor -0.5 is negative or not finite; rejecting play().',
        );
        expect(rejectionWarning({ position: ORIGIN, rolloffFactor: Number.NaN })).toBe(
            'Audio spatial rolloffFactor NaN is negative or not finite; rejecting play().',
        );
    });

    it('rejects a non-finite component on any position axis', () => {
        expect(rejectionWarning({ position: [Number.NaN, 0, 0] })).toBe(
            'Audio spatial position [NaN, 0, 0] has a non-finite component; rejecting play().',
        );
        expect(rejectionWarning({ position: [0, Number.NEGATIVE_INFINITY, 0] })).toBe(
            'Audio spatial position [0, -Infinity, 0] has a non-finite component; rejecting play().',
        );
        expect(rejectionWarning({ position: [0, 0, Number.POSITIVE_INFINITY] })).toBe(
            'Audio spatial position [0, 0, Infinity] has a non-finite component; rejecting play().',
        );
    });
});
