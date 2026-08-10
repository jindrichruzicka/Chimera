'use client';

import { useEffect, useState } from 'react';
import { AnimationMixer } from 'three';

import type { ModelInstance } from '../../assets/ModelInstance.js';
import { registerMixerBinding } from './mixerBindingRegistry.js';

/**
 * renderer/components/r3f/useOwnedMixer.ts
 *
 * The allocation and release half of a Canvas-bound `AnimationMixer`, with no
 * frame loop of its own.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Separate from `useModelAnimation` so a consumer that drives the mixer through
 * a `MeshClipBackend` rather than by calling `update` itself — `useClipPlayer`
 * — can own one without also inheriting that hook's `useFrame`.
 * `MeshClipBackend` derives a playback's wrap count from the deltas that came
 * through its own `advance`, so a mixer carrying its playbacks must have
 * exactly ONE driver, and composing `useModelAnimation` inside `useClipPlayer`
 * would give that mixer two.
 *
 * Internal: not exported from the `components/r3f` barrel. What a game imports
 * is `useModelAnimation` or `useClipPlayer`, both of which own one of these.
 *
 * **The mixer is allocated in a commit-phase effect, never `useMemo`.**
 * StrictMode double-invokes memo factories and discards one result, which would
 * orphan a mixer retaining the clone root with no `uncacheRoot` ever running.
 * Release order matters too: every action is stopped before the root is dropped
 * from three's action cache, and skipping `uncacheRoot` leaves that cache
 * holding the root.
 *
 * The effect is keyed on `instance`, not on `instance.root`: the mixer belongs
 * to the instance that owns the root, and two instances cloned from one asset
 * are two roots anyway — keying on the field would tie a released mixer's
 * identity to a value the hook does not own.
 *
 * **Rule ONE-MIXER-PER-ROOT.** The same effect that allocates the mixer claims
 * `instance.root` in `mixerBindingRegistry` under `binderName`, and the same
 * cleanup releases it — so a root carrying two mixer-owning hooks is reported
 * (logged, deferred one frame, never thrown) rather than silently playing every
 * clip at a multiple of its speed. The registry module's header records the
 * rest.
 *
 * Mixer state is renderer-local and never enters a `GameSnapshot`, store, IPC
 * payload, save, or replay.
 *
 * Its behaviour is pinned where it is consumed rather than in a suite of its
 * own: the two hooks' co-located suites own the release order, the mixer
 * identity and the per-hook binding ledger, and
 * `__tests__/one-mixer-per-root.test.tsx` owns the two-hooks-one-root report.
 *
 * @param binderName  The hook claiming the root, named in a duplicate report.
 */
export function useOwnedMixer(
    instance: ModelInstance | null,
    binderName: string,
): AnimationMixer | null {
    const [mixer, setMixer] = useState<AnimationMixer | null>(null);

    useEffect(() => {
        if (instance === null) {
            return undefined;
        }
        const allocatedMixer = new AnimationMixer(instance.root);
        const releaseBinding = registerMixerBinding(instance.root, binderName);
        setMixer(allocatedMixer);
        return () => {
            // LIFO: the claim was taken last, so it is released first.
            releaseBinding();
            allocatedMixer.stopAllAction();
            allocatedMixer.uncacheRoot(instance.root);
            setMixer(null);
        };
    }, [instance, binderName]);

    return mixer;
}
