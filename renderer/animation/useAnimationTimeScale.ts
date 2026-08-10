'use client';

/**
 * renderer/animation/useAnimationTimeScale.ts
 *
 * The exported scalar: the dilation multiplier the whole renderer may pace
 * against. `1` is real time, `0.25` quarter speed.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * `useClipPlayer` applies this multiplier itself, so clip playback dilates with
 * no wiring at all. Everything else a game animates by hand — a camera tween, a
 * particle rate, a shader uniform, a HUD countdown — is opt-in, and this hook is
 * what it opts in with. It ships from the `components/r3f` barrel (Invariant
 * #96) because `renderer/animation/` is not an importable subpath.
 *
 * Read-only by construction: the store's one writer is `TimeScaleBridge`, which
 * carries a snapshot integer in one direction only (Invariant #131).
 */

import { useTimeScaleStore } from './timeScaleStore.js';

/** The current dilation multiplier; re-renders the caller when it changes. */
export function useAnimationTimeScale(): number {
    return useTimeScaleStore((state) => state.timeScale);
}
