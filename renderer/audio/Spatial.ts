/**
 * renderer/audio/Spatial.ts
 *
 * Architecture reference: §4.25 — Audio System → Spatial Audio.
 *
 * The spatial option types and the STATIC half of their validation. Distances need no
 * decode, so — by the same provenance rule the cue tiers follow (Invariant #117) — an
 * already-invalid spec is rejected synchronously inside `play()`, before any voice is
 * reserved. Rejection is a named value handed back to the caller, never a throw
 * (Invariant #118); `play()` owns the one warning it prints.
 *
 * {@link resolveSpatialSpec} maps the authored options onto the `PannerNode`'s own
 * vocabulary — `refDistance` / `maxDistance` / `distanceModel` / `rolloffFactor` — with
 * no arithmetic of its own, so the platform stays the authority on the curve. The one
 * exception is the authored hard cutoff: `falloffDistance === fullVolumeDistance` names
 * a band the continuous model cannot express directly (the linear model divides by
 * `maxDistance - refDistance`), so it resolves to the narrowest band it CAN express,
 * through {@link HARD_CUTOFF_BAND_EPSILON}.
 *
 * Framework-free by design: no r3f, no `electron/**`, no DOM type beyond the lib's own
 * `DistanceModelType` strings — so everything here is unit-testable with no browser.
 */

/** A source or listener position, in the game's own world units. */
export type AudioPosition = readonly [number, number, number];

/**
 * The attenuation shape between the two authored radii. The values are exactly the
 * platform's `DistanceModelType` strings, and the platform stays the authority on each
 * curve — but the ENGINE default is `'linear'`, deliberately diverging from the Web
 * Audio default of `'inverse'`: only `linear` actually reaches zero at `maxDistance`,
 * while `'inverse'` and `'exponential'` clamp the DISTANCE there and hold a non-zero
 * gain at every distance beyond it. Shipping the platform default would make
 * `falloffDistance` name a radius that silences nothing. The other two stay selectable,
 * asymptotic behaviour and all.
 */
export type DistanceFalloff = 'linear' | 'inverse' | 'exponential';

/**
 * A positioned voice's authored spatial spec ({@link PlayOptions.spatial}).
 *
 * Statically validated inside `play()`: a non-finite position component, a negative or
 * non-finite distance or `rolloffFactor`, or a resolved band whose `falloffDistance`
 * falls below its `fullVolumeDistance` each reject the play synchronously — an invalid
 * handle and one warning, no voice reserved (Invariants #117, #118). Validation runs on
 * the RESOLVED pair, so a bound left to its platform default participates:
 * `falloffDistance: 0.5` alone is rejected against the default `fullVolumeDistance` of
 * 1, and the warning prints the resolved values.
 */
export interface SpatialOptions {
    readonly position: AudioPosition;
    /** Radius within which the voice plays at full `volume`. >= 0; 0 attenuates from the source. */
    readonly fullVolumeDistance?: number;
    /** Radius at which the voice reaches its floor. Must be > `fullVolumeDistance`; equal is
     * an authored hard cutoff — a CUTOFF only under the `'linear'` default, see
     * {@link HARD_CUTOFF_BAND_EPSILON}. */
    readonly falloffDistance?: number;
    /** Attenuation shape between the two. Default `'linear'`. */
    readonly falloff?: DistanceFalloff;
    /** The platform's own curve-steepness factor. >= 0; default 1. */
    readonly rolloffFactor?: number;
}

/**
 * A validated {@link SpatialOptions} in the panner's own vocabulary, ready to be
 * written onto a `PannerNode` field-for-field. Lives on the private `VoiceRecord` —
 * never on `AudioHandle`, whose shape stays frozen (Invariant #126).
 */
export interface ResolvedSpatialSpec {
    readonly position: AudioPosition;
    readonly distanceModel: DistanceFalloff;
    readonly refDistance: number;
    readonly maxDistance: number;
    readonly rolloffFactor: number;
}

/** The static-tier verdict: a spec ready for the panner, or a warning for `play()` to print. */
export type SpatialSpecResolution =
    | { readonly kind: 'resolved'; readonly spec: ResolvedSpatialSpec }
    | { readonly kind: 'rejected'; readonly warning: string };

/**
 * The band width an authored hard cutoff (`falloffDistance === fullVolumeDistance`)
 * resolves to. A power-of-two fraction (2^-13 ≈ 0.000122 world units) so that
 * `refDistance + HARD_CUTOFF_BAND_EPSILON` is exact in double precision at any
 * plausible game scale — narrow enough to be audibly a cutoff, wide enough to keep
 * `maxDistance` strictly above `refDistance` (and above zero, which the platform
 * requires) even when both authored distances are 0.
 *
 * A CUTOFF is what the band means only under the `'linear'` default. The asymptotic
 * models clamp DISTANCE at the band's edge and
 * hold that gain forever after, and over a band this narrow the clamped gain is ≈ 1 —
 * an equal pair under `'inverse'` or `'exponential'` therefore attenuates essentially
 * nothing, exactly as those models' own docs say they silence nothing.
 */
export const HARD_CUTOFF_BAND_EPSILON = 2 ** -13;

/** `createPanner()`'s own `refDistance` default. */
export const DEFAULT_FULL_VOLUME_DISTANCE = 1;
/** `createPanner()`'s own `maxDistance` default. */
export const DEFAULT_FALLOFF_DISTANCE = 10000;
/** The ENGINE default — see {@link DistanceFalloff} for why it is not the platform's `'inverse'`. */
export const DEFAULT_DISTANCE_FALLOFF: DistanceFalloff = 'linear';
/** `createPanner()`'s own `rolloffFactor` default. */
export const DEFAULT_ROLLOFF_FACTOR = 1;

/**
 * Resolve an authored {@link SpatialOptions} to a {@link ResolvedSpatialSpec}, or to
 * the rejection `play()` warns with. Synchronous and side-effect free — the static
 * validation tier (Invariant #117).
 */
export function resolveSpatialSpec(options: SpatialOptions): SpatialSpecResolution {
    const [x, y, z] = options.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return reject(
            `Audio spatial position [${x}, ${y}, ${z}] has a non-finite component; rejecting play().`,
        );
    }

    const scalarWarning =
        scalarRejection('fullVolumeDistance', options.fullVolumeDistance) ??
        scalarRejection('falloffDistance', options.falloffDistance) ??
        scalarRejection('rolloffFactor', options.rolloffFactor);
    if (scalarWarning !== null) {
        return reject(scalarWarning);
    }

    const refDistance = options.fullVolumeDistance ?? DEFAULT_FULL_VOLUME_DISTANCE;
    const maxDistance = options.falloffDistance ?? DEFAULT_FALLOFF_DISTANCE;
    if (maxDistance < refDistance) {
        return reject(
            `Audio spatial distance band [${refDistance}, ${maxDistance}] is already out of order; rejecting play().`,
        );
    }

    return {
        kind: 'resolved',
        spec: {
            position: options.position,
            distanceModel: options.falloff ?? DEFAULT_DISTANCE_FALLOFF,
            refDistance,
            maxDistance:
                maxDistance === refDistance ? refDistance + HARD_CUTOFF_BAND_EPSILON : maxDistance,
            rolloffFactor: options.rolloffFactor ?? DEFAULT_ROLLOFF_FACTOR,
        },
    };
}

/**
 * The one scalar rule every authored spatial number shares: absent is fine, and a
 * present value must be a finite non-negative number. There is no dynamic tier to defer
 * a non-finite value to — nothing a decode could reveal makes `NaN` a radius — so,
 * unlike a cue bound, it rejects here.
 */
function scalarRejection(
    name: 'fullVolumeDistance' | 'falloffDistance' | 'rolloffFactor',
    value: number | undefined,
): string | null {
    if (value === undefined || (Number.isFinite(value) && value >= 0)) {
        return null;
    }
    return `Audio spatial ${name} ${value} is negative or not finite; rejecting play().`;
}

function reject(warning: string): SpatialSpecResolution {
    return { kind: 'rejected', warning };
}
