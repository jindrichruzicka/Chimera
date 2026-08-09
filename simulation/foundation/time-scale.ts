// simulation/foundation/time-scale.ts
// Animation System → time dilation arithmetic. Feature F82,
// docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
//
// Global time dilation is expressed as ONE integer in permille: 1000 is real
// time, 250 is quarter speed, 2000 is double speed. Turning a permille into a
// number happens here, so that a sign or reciprocal error is a single visible
// edit rather than two independent formulas drifting apart.
//
// `timeScaleMultiplier` and `dilatedBeatPeriodMs` are RECIPROCAL BY
// CONSTRUCTION: both divide by the same `clampTimeScalePermille` result. The
// scales at which their product is asserted exact are measured in
// `time-scale.test.ts`.
//
// Permille is a HOST PACING DIVISOR, not a gameplay quantity: the float results
// below only ever reach a wall clock or a renderer playback rate. `fromFloat()`
// is never called here and no value produced here may enter a `GameSnapshot`
// field (Invariants #75/#76).
//
// This module carries runtime values, so it is NOT re-exported from
// `simulation/index.ts` or `simulation/contracts/index.ts` — both of those
// barrels are asserted to bundle to the empty string (Invariant #1). Its own
// subpath is the way in, as for `foundation/crc32.js` and
// `foundation/asset-ref-parse.js`.
//
// Zero-dependency leaf: this module imports nothing.

/** Real time — the scale an absent or unusable permille falls back to. */
export const NORMAL_TIME_SCALE_PERMILLE = 1000;

/** The slowest supported scale (5% of real time). */
export const MIN_TIME_SCALE_PERMILLE = 50;

/** The fastest supported scale (4× real time). */
export const MAX_TIME_SCALE_PERMILLE = 4000;

/**
 * Normalise an authored or wire-received time scale into the supported range.
 *
 * Two distinct rules, in order:
 *
 *  1. Anything that is not a finite INTEGER — `undefined`, `NaN`, `±Infinity`,
 *     or a fractional permille such as `2.5` — falls back to real time. A
 *     fraction is REFUSED rather than rounded or clamped: silently turning `2.5`
 *     into the 5%-speed floor would read as a slow-motion bug rather than as the
 *     typo it is.
 *  2. A finite integer is clamped into
 *     `[MIN_TIME_SCALE_PERMILLE, MAX_TIME_SCALE_PERMILLE]`.
 *
 * @param value  The authored permille, or `undefined` for real time.
 * @returns      An integer in `[MIN_TIME_SCALE_PERMILLE, MAX_TIME_SCALE_PERMILLE]`.
 */
export function clampTimeScalePermille(value: number = NORMAL_TIME_SCALE_PERMILLE): number {
    if (!Number.isInteger(value)) return NORMAL_TIME_SCALE_PERMILLE;
    return Math.min(MAX_TIME_SCALE_PERMILLE, Math.max(MIN_TIME_SCALE_PERMILLE, value));
}

/**
 * The RENDERER's half of a dilated hit: the multiplier a clip's playback rate is
 * scaled by. `1` is real time, `0.25` is quarter speed.
 *
 * @param permille  The authored permille, or `undefined` for real time.
 */
export function timeScaleMultiplier(permille?: number): number {
    return clampTimeScalePermille(permille) / NORMAL_TIME_SCALE_PERMILLE;
}

/**
 * The HOST's half of a dilated hit: the wall-clock period one beat occupies once
 * the scale is applied. Slower scale ⇒ longer period, so the reciprocal of
 * {@link timeScaleMultiplier}.
 *
 * @param basePeriodMs  The undilated beat period, i.e. the game's `tickRateMs`.
 * @param permille      The authored permille, or `undefined` for real time.
 */
export function dilatedBeatPeriodMs(basePeriodMs: number, permille?: number): number {
    return (basePeriodMs * NORMAL_TIME_SCALE_PERMILLE) / clampTimeScalePermille(permille);
}
