// renderer/components/scene/loadingCoverHold.ts
//
// Renderer-side resolution of `GameScreenRegistry.loadingScreenMinVisibleMs`
// (§4.36) into the durations its consumers arm: the hold a cover consumer arms
// (`resolveLoadingCoverHoldMs`) and the floor the loading beat holds its cover
// for (`resolveLoadingBeatFloorMs`), which differ on what an absent declaration
// means. Kept beside `resolveLoadingScreen`, the read side of the cover slots
// the minimum floors; the contract field itself lives in the zero-dependency
// foundation leaf, so the env reads below belong here, not there (Invariant #1).

import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

/**
 * The minimum-visible hold in milliseconds a loading-cover consumer should arm
 * for this registry: the declared `loadingScreenMinVisibleMs`, or `0` — arm no
 * timer at all — for an absent, zero, negative or non-finite declaration.
 *
 * Collapses to `0` under `NEXT_PUBLIC_CHIMERA_E2E === '1'`, reading the env at
 * call time exactly like `screenFadeMs()`: the hold is a deliberate delay, not
 * a release budget, and the e2e suite must not wait out cosmetic timers
 * (Invariant #133).
 *
 * Deliberately does NOT collapse under `prefers-reduced-motion` — the
 * preference zeroes the fades around the cover, which makes a sub-perceptual
 * cover flash strictly worse, so the minimum stands there.
 */
export function resolveLoadingCoverHoldMs(registry: GameScreenRegistry): number {
    if (process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1') {
        return 0;
    }
    const declared = registry.loadingScreenMinVisibleMs;
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
        return 0;
    }
    return declared;
}

/**
 * How long the loading beat holds its cover when a registry declares no usable
 * `loadingScreenMinVisibleMs`.
 *
 * A beat bounded only by its own two fades is sub-perceptual under
 * `prefers-reduced-motion`, where those fades are cuts — so the fallback exists
 * to keep an undeclared beat readable rather than to pick a house rhythm.
 */
export const DEFAULT_LOADING_BEAT_FLOOR_MS = 400;

/**
 * How long the loading beat holds its cover for this registry: the declared
 * `loadingScreenMinVisibleMs`, a declared `0`, or
 * {@link DEFAULT_LOADING_BEAT_FLOOR_MS} when the declaration is absent or
 * unusable (negative, `NaN`, `Infinity` — each already warned at registration).
 *
 * Answers HOW LONG a beat holds, never WHETHER one runs: the beat arms on the
 * cascade resolving a game-declared cover form, which this function does not
 * read. So a positive answer for a registry that declares no cover is correct
 * and means nothing on its own.
 *
 * A declared `0` is the one value that does not reach the default — it is how a
 * game opts down to "show the cover for as long as the load actually runs".
 *
 * Collapses to `0` under `NEXT_PUBLIC_CHIMERA_E2E === '1'` on every branch,
 * default included, reading the env at call time exactly like
 * {@link resolveLoadingCoverHoldMs} and `screenFadeMs()`: the beat is a
 * deliberate delay, not a release budget (Invariant #133). Deliberately does
 * NOT collapse under `prefers-reduced-motion`, for the reason the constant
 * above exists.
 */
export function resolveLoadingBeatFloorMs(registry: GameScreenRegistry): number {
    if (process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1') {
        return 0;
    }
    const declared = registry.loadingScreenMinVisibleMs;
    // `< 0`, never `<= 0`: a declared `0` is a valid opt-down and must fall
    // through to be returned as itself, where an absent or unusable value takes
    // the default instead.
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < 0) {
        return DEFAULT_LOADING_BEAT_FLOOR_MS;
    }
    return declared;
}
