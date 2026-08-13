import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assetPathForRef, readGlbDocument } from '@chimera-engine/electron/test-support';

import {
    tacticsModelRefs,
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from '../../asset-manifest.js';
import {
    SHOWCASE_BLEND_BAND,
    SHOWCASE_BONE_ROTATION_DECIMALS,
    SHOWCASE_LEAN_POSE_RADIANS,
    SHOWCASE_WAVE_PEAK_RADIANS,
    isBlendedRotation,
} from './showcase-clip-poses';

/**
 * The angles the blend spec calls a blend, checked against the bytes they are
 * angles OF — and against the component that writes them out.
 *
 * Without this the helper is a pair of numbers agreeing with a comment: a
 * regenerated fixture that moved either pose, or a screen that published the
 * rotation at another precision, would leave the spec's band pointing at
 * rotations one clip can reach on its own, and the spec would keep passing while
 * proving nothing. Both failure modes are silent in every other suite.
 *
 * Intentional filesystem access: the committed container and the component
 * source ARE the subject.
 *
 * @chimera-review: intentional filesystem access — fixture and source alignment guard.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '../../../..');

const animatedRig = () =>
    readGlbDocument(
        assetPathForRef(path.join(here, '../..'), tacticsModelRefs.showcaseRigAnimated),
    );

/** The rotation accessor of the clip named `name`, bounds and all. */
function rotationBoundsOf(name: string): {
    readonly min: readonly number[];
    readonly max: readonly number[];
} {
    const document = animatedRig();
    const animation = (document.animations ?? []).find((candidate) => candidate.name === name);
    expect(animation, `the animated rig declares no clip named '${name}'`).toBeDefined();

    const sampler = animation?.samplers?.[0];
    const output = sampler?.output === undefined ? undefined : document.accessors?.[sampler.output];
    // The generator authors min/max on the rotation accessors for this reader;
    // their absence is the fixture having stopped stating what it poses.
    expect(output?.min, `clip '${name}' declares no rotation bounds`).toBeDefined();
    expect(output?.max, `clip '${name}' declares no rotation bounds`).toBeDefined();
    return { min: output?.min ?? [], max: output?.max ?? [] };
}

/** The Z rotation a pure-Z quaternion component carries: both clips rotate about Z alone. */
function rotationRadians(quaternionZ: number): number {
    return 2 * Math.asin(quaternionZ);
}

describe('showcase clip poses — the band, read off the shipped fixture', () => {
    it("the wave peak is the largest rotation that clip's own curve reaches", () => {
        const bounds = rotationBoundsOf(tacticsShowcaseWaveClip.name);

        expect(rotationRadians(bounds.max[2] ?? 0)).toBeCloseTo(SHOWCASE_WAVE_PEAK_RADIANS, 6);
        // The swing is symmetric, so the peak bounds it in both directions — the
        // band's `Math.abs` reading after a toggle back depends on that.
        expect(rotationRadians(bounds.min[2] ?? 0)).toBeCloseTo(-SHOWCASE_WAVE_PEAK_RADIANS, 6);
    });

    it('the lean pose is one rotation held, not a range', () => {
        const bounds = rotationBoundsOf(tacticsShowcaseLeanClip.name);

        expect(rotationRadians(bounds.max[2] ?? 0)).toBeCloseTo(SHOWCASE_LEAN_POSE_RADIANS, 6);
        // Equal bounds are what make the settled value after a blend an exact
        // number rather than wherever the curve happened to be.
        expect(bounds.min).toEqual(bounds.max);
    });

    it('leaves a band between the two clips for a blend to land in', () => {
        // Non-empty, and non-empty at the ROUNDED bound: the spec compares
        // published attribute values, so a band that only existed at full
        // precision would be one no sample could ever fall inside.
        expect(SHOWCASE_BLEND_BAND.above).toBeLessThan(SHOWCASE_BLEND_BAND.below);
        expect(isBlendedRotation((SHOWCASE_BLEND_BAND.above + SHOWCASE_BLEND_BAND.below) / 2)).toBe(
            true,
        );
    });

    it('excludes what either clip poses on its own', () => {
        // The negative control, and the whole point of the band: the peak swing
        // AS PUBLISHED and the settled lean pose AS PUBLISHED are both outside
        // it, so neither a cut to `lean` nor an uninterrupted `wave` can satisfy
        // the spec.
        const publish = (radians: number): number =>
            Number(radians.toFixed(SHOWCASE_BONE_ROTATION_DECIMALS));

        expect(isBlendedRotation(publish(SHOWCASE_WAVE_PEAK_RADIANS))).toBe(false);
        expect(isBlendedRotation(publish(-SHOWCASE_WAVE_PEAK_RADIANS))).toBe(false);
        expect(isBlendedRotation(publish(SHOWCASE_LEAN_POSE_RADIANS))).toBe(false);
        expect(isBlendedRotation(publish(0))).toBe(false);
    });

    it('is open at BOTH ends, not just the one a published value can land on', () => {
        // Each bound on the bound itself. The lower one already has a published
        // fixture — a peak swing rounds to exactly `above` — but nothing a screen
        // publishes at four decimals can equal `below`, so a `<` relaxed to `<=`
        // would admit the lean's own hold with every case above still green. The
        // band is stated as an OPEN interval; this is the half of that statement
        // the published channel cannot reach.
        expect(isBlendedRotation(SHOWCASE_BLEND_BAND.above)).toBe(false);
        expect(isBlendedRotation(SHOWCASE_BLEND_BAND.below)).toBe(false);
    });

    it('matches the precision the screen actually publishes the rotation at', () => {
        // The band's lower bound is the peak swing rounded to this many places.
        // Publish at fewer and a peak swing rounds UP past the bound, which turns
        // an ordinary `wave` frame into a "blend" the spec accepts — with nothing
        // else in the repo red.
        const component = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/components/TacticsAnimatedShowcase.tsx'),
            'utf-8',
        );

        expect(component).toContain(`toFixed(${SHOWCASE_BONE_ROTATION_DECIMALS})`);
    });
});
