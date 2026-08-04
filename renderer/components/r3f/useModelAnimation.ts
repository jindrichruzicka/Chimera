'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { AnimationMixer } from 'three';

import type { ModelInstance } from '../../assets/ModelInstance.js';

/**
 * One `AnimationMixer` bound to a {@link ModelInstance}'s root, advanced every
 * frame from `useFrame` at the DEFAULT render priority and released with
 * `stopAllAction()` then `uncacheRoot()` (skipping `uncacheRoot` would leave
 * three's internal action cache holding the root). Returns the raw mixer —
 * actions, crossfades, loop modes and completion events are the caller's to
 * drive — and `null` until the commit-phase effect has allocated it, or while
 * `instance` is `null`. Requires a `<Canvas>`.
 *
 * DEFAULT priority is load-bearing: a non-zero `renderPriority` subscriber
 * becomes responsible for calling `gl.render` — see the co-presenter notes in
 * `FrameRateLimiter.tsx`'s header.
 *
 * On a `frameloop="demand"` canvas, `useFrame` only runs for frames something
 * else has already scheduled, so a caller starting an action from an event
 * handler must also request a frame through R3F's frame-scheduling API; this
 * hook never requests frames itself. The engine `GameCanvas` passes the
 * `frameloop` from `useEngineFrameloop()` — `'never'` whenever a frame-rate cap
 * is active, which `display.targetFps` defaults to, and `'always'` when
 * uncapped.
 *
 * The mixer is allocated in a commit-phase effect, never `useMemo`:
 * StrictMode double-invokes memo factories and discards one result, which
 * would orphan a mixer retaining the clone root with no `uncacheRoot` ever
 * running. Mixer state is renderer-local and never enters a `GameSnapshot`,
 * store, IPC payload, save, or replay.
 */
export function useModelAnimation(instance: ModelInstance | null): AnimationMixer | null {
    const [mixer, setMixer] = useState<AnimationMixer | null>(null);

    useEffect(() => {
        if (instance === null) {
            return undefined;
        }
        const allocatedMixer = new AnimationMixer(instance.root);
        setMixer(allocatedMixer);
        return () => {
            // Release order matters: stop every action before dropping the
            // root from three's action cache.
            allocatedMixer.stopAllAction();
            allocatedMixer.uncacheRoot(instance.root);
            setMixer(null);
        };
    }, [instance]);

    // Registered unconditionally (rules of hooks: `instance` transitions
    // between null and non-null across renders of one mounted component) and
    // inert until the mixer exists. No setState in the frame path (§6.3).
    useFrame((_state, deltaSeconds) => {
        mixer?.update(deltaSeconds);
    });

    return mixer;
}
