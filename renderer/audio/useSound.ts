'use client';

import { useCallback, useMemo } from 'react';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { DEFAULT_FADE_CURVE, type AudioHandle, type PlayOptions } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';
import type { Cue } from './Cue';

const DEFAULT_BUS = 'sfx';
const DEFAULT_LOOP = false;
const DEFAULT_VOLUME = 1;
const DEFAULT_PRIORITY = 0;

/**
 * Collapse a {@link Cue} to a scalar memo key. A `{ name }` cue is a fresh object on
 * every render, so keying on identity would churn the callback; keying on the bare
 * name would instead collide with the symbolic `'start'`/`'end'` bounds, hence the
 * prefix. `undefined` stays distinct from every authored cue.
 */
function cueDependency(cue: Cue | undefined): string | number | undefined {
    if (cue === undefined || typeof cue === 'number' || typeof cue === 'string') {
        return cue;
    }
    return `name:${cue.name}`;
}

/**
 * Returns a memoized callback that plays the provided sound reference.
 *
 * Every field of {@link PlayOptions} is part of the key, so a rerender that changes any
 * one of them hands back a callback that plays the new value. Equivalent option values
 * keep the same callback identity, even when callers pass a newly created options object.
 */
export function useSound(ref: AssetRef<AudioClipAsset>, opts?: PlayOptions): () => AudioHandle {
    const audioManager = useAudioManager();
    const stableOptions = useMemo(
        () => opts,
        [
            opts?.bus ?? DEFAULT_BUS,
            opts?.loop ?? DEFAULT_LOOP,
            opts?.volume ?? DEFAULT_VOLUME,
            opts?.priority ?? DEFAULT_PRIORITY,
            opts?.position?.[0],
            opts?.position?.[1],
            opts?.position?.[2],
            cueDependency(opts?.from),
            cueDependency(opts?.to),
            cueDependency(opts?.loopRegion?.start),
            cueDependency(opts?.loopRegion?.end),
            // A fade-in is two authored values, keyed as two. `durationMs` is required on
            // FadeInSpec, so an absent fade cannot collide with an authored one on the pair
            // even though both read the same defaulted curve.
            opts?.fadeIn?.durationMs,
            opts?.fadeIn?.curve ?? DEFAULT_FADE_CURVE,
        ],
    );

    return useCallback(
        () => audioManager.play(ref, stableOptions),
        [audioManager, ref, stableOptions],
    );
}
