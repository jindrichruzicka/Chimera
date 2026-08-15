// renderer/components/scene/loadingCoverHold.ts
//
// Renderer-side resolution of `GameScreenRegistry.loadingScreenMinVisibleMs`
// (§4.36) into the hold a cover consumer arms — see `resolveLoadingCoverHoldMs`.
// Kept beside `resolveLoadingScreen`, the read side of the cover slots the
// minimum floors; the contract field itself lives in the zero-dependency
// foundation leaf, so the env read below belongs here, not there (Invariant #1).

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
