'use client';

import { useCallback, useMemo } from 'react';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AudioHandle, PlayOptions } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';

const DEFAULT_BUS = 'sfx';
const DEFAULT_LOOP = false;
const DEFAULT_VOLUME = 1;
const DEFAULT_PRIORITY = 0;

/**
 * Returns a memoized callback that plays the provided sound reference.
 *
 * Equivalent option values keep the same callback identity across rerenders,
 * even when callers pass a newly created options object.
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
        ],
    );

    return useCallback(
        () => audioManager.play(ref, stableOptions),
        [audioManager, ref, stableOptions],
    );
}
