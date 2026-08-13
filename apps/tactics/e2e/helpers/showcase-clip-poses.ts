/**
 * What the two clips in `showcase-rig-animated.glb` pose the `top` bone at, and
 * the band between them that only a BLEND can produce.
 *
 * The model-showcase screen writes the played instance's bone rotation onto a
 * DOM attribute every frame. A rotation on its own says nothing, though: it is a
 * number out of a mixer, and reading one proves a clip advanced, not that two of
 * them were mixed. What proves a blend is a rotation NEITHER clip can pose alone
 * — and that requires knowing what each clip poses.
 *
 * Those are facts about a generated binary (`tools/gen-showcase-animated-glb.ts`),
 * so the numbers below are not copied from a comment: the co-located test reads
 * them back off the committed container, where the clips' rotation accessors
 * declare their own bounds for exactly this purpose. A regenerated fixture that
 * moved either pose reds there rather than silently moving the band an e2e
 * calls a blend.
 */

/** The largest Z rotation `wave` reaches, in radians (20°) — its peak swing. */
export const SHOWCASE_WAVE_PEAK_RADIANS = 0.3490658503988659;

/** The Z rotation `lean` holds for its whole length, in radians (60°). */
export const SHOWCASE_LEAN_POSE_RADIANS = 1.0471975511965976;

/**
 * Decimal places the screen publishes a bone rotation with —
 * `TacticsAnimatedShowcase`'s `boneRotationZ`, which is `toFixed(4)`.
 *
 * Load-bearing rather than cosmetic: the band's lower bound is the peak swing
 * ROUNDED to this precision, so a coarser one would round a legitimate swing
 * sample up past the bound and call a cut a blend. The co-located test pins it
 * against the component that does the writing.
 */
export const SHOWCASE_BONE_ROTATION_DECIMALS = 4;

/**
 * The open interval of bone rotations neither clip can pose on its own.
 *
 * `above` is the peak swing as the screen would WRITE it. At exactly its peak
 * the attribute reads `0.3491`, which is not greater than `0.3491` — so a
 * strictly-greater comparison excludes every rotation `wave` can reach, at any
 * point of its sweep, and rounding is monotone so nothing below the peak can
 * cross it either. `below` is `lean`'s hold unrounded, which the settled value
 * rounds UP past — so the pose a completed blend ends on is outside the band as
 * well.
 */
export const SHOWCASE_BLEND_BAND = {
    above: Number(SHOWCASE_WAVE_PEAK_RADIANS.toFixed(SHOWCASE_BONE_ROTATION_DECIMALS)),
    below: SHOWCASE_LEAN_POSE_RADIANS,
} as const;

/** Whether `rotation` is a value only a blend of the two clips could have produced. */
export function isBlendedRotation(rotation: number): boolean {
    return rotation > SHOWCASE_BLEND_BAND.above && rotation < SHOWCASE_BLEND_BAND.below;
}
