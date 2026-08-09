'use client';

import { useFrame } from '@react-three/fiber';
import type { AnimationMixer } from 'three';

import type { ModelInstance } from '../../assets/ModelInstance.js';
import { useOwnedMixer } from './useOwnedMixer.js';

/**
 * One `AnimationMixer` bound to a {@link ModelInstance}'s root, advanced every
 * frame from `useFrame` at the DEFAULT render priority. Returns the raw mixer —
 * actions, crossfades, loop modes and completion events are the caller's to
 * drive — and `null` until the commit-phase effect has allocated it, or while
 * `instance` is `null`. Requires a `<Canvas>`.
 *
 * DEFAULT priority is load-bearing: a non-zero `renderPriority` subscriber
 * becomes responsible for calling `gl.render` — see the co-presenter notes in
 * `FrameRateLimiter.tsx`'s header.
 *
 * This hook never requests frames itself, and on an engine canvas it never needs
 * to: frames arrive unasked under both frameloops `useEngineFrameloop()`
 * returns. Only a `frameloop="demand"` root — one no game canvas can be under
 * Invariant #127, since GameCanvas never produces that value — makes
 * `useFrame` wait for a frame something else scheduled, and there calling
 * `invalidate()` is the caller's job. See `useEngineFrameloop.ts` for why demand
 * rendering reaches no engine canvas.
 *
 * Allocation and release are `useOwnedMixer.ts`, which records the commit-phase
 * effect, the `stopAllAction()` → `uncacheRoot()` order, and why neither may be
 * a `useMemo`. Mixer state is renderer-local and never enters a `GameSnapshot`,
 * store, IPC payload, save, or replay.
 */
export function useModelAnimation(instance: ModelInstance | null): AnimationMixer | null {
    const mixer = useOwnedMixer(instance);

    // Registered unconditionally (rules of hooks: `instance` transitions
    // between null and non-null across renders of one mounted component) and
    // inert until the mixer exists. No setState in the frame path (§6.3).
    useFrame((_state, deltaSeconds) => {
        mixer?.update(deltaSeconds);
    });

    return mixer;
}
