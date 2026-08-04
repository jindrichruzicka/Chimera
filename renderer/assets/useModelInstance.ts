'use client';

import { useEffect, useState } from 'react';

import type { AssetRef, GLTFModelAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { LoadedGltfAsset } from './AssetManager';
import { cloneModelInstance, type ModelInstance, releaseModelInstance } from './ModelInstance.js';
import { useAsset } from './useAsset.js';

export interface UseModelInstanceState {
    readonly instance: ModelInstance | null;
    readonly loading: boolean;
    readonly error: Error | null;
}

interface CommittedClone {
    readonly asset: LoadedGltfAsset;
    readonly instance: ModelInstance | null;
    readonly error: Error | null;
}

/**
 * Resolves a `gltf-model` ref through {@link useAsset} and publishes a
 * per-component {@link ModelInstance} clone of the cached scene. The cached
 * asset stays manager-owned; the clone is component-owned and is released
 * when the resolved asset identity changes and on unmount (Invariant #21).
 *
 * The clone is allocated in a commit-phase effect, never during render:
 * render-phase allocation (`useMemo`) leaks under StrictMode, which
 * double-invokes memo factories and discards one result, and discarded
 * renders never run any cleanup. Because allocation is commit-phase,
 * `loading` stays `true` for one extra render after the asset resolves —
 * callers already check the loading flag before reading (§6.2).
 *
 * The `ref` follows the stable-`AssetRef` rule (§13.3).
 *
 * Load failures and everything `cloneModelInstance` raises surface as
 * `error` with a `null` instance, never as a render throw; the sole
 * render-phase throw is `useAssetManager`'s missing-provider refusal
 * (Invariant #83).
 *
 * Loads reject into `error` whenever the manager in context is the app-level
 * `DelegatingAssetManager` with no delegate registered (no active match), so
 * a surface above `GameShell` — e.g. Invariant #96's `apps/<name>/shell/*.tsx`
 * — resolves loads only while a match is active. The other way to satisfy the
 * hook is to be under a manager that is not the delegating one at all:
 * `GameShell` publishes the match-level manager, and `GameAssetSession`
 * (`renderer/app/gameAssetSession.tsx`) publishes a matchless one for a route
 * that renders a game's assets outside a match.
 */
export function useModelInstance(ref: AssetRef<GLTFModelAsset> | null): UseModelInstanceState {
    const { asset, error } = useAsset<GLTFModelAsset>(ref);
    const [committed, setCommitted] = useState<CommittedClone | null>(null);

    // Keyed on the resolved asset OBJECT, never the ref string: every path
    // that swaps the cached asset under a stable ref (manager swap, manifest
    // eviction + reload) produces a new object identity, while the ref string
    // would keep this clone bound to a destroyed asset.
    useEffect(() => {
        if (ref === null || asset === null) {
            return undefined;
        }

        let instance: ModelInstance | null = null;
        let cloneError: Error | null = null;
        try {
            instance = cloneModelInstance(asset);
        } catch (thrown) {
            cloneError = toError(thrown);
        }
        setCommitted({ asset, instance, error: cloneError });

        return () => {
            if (instance !== null) {
                releaseModelInstance(instance);
            }
            setCommitted(null);
        };
    }, [ref, asset]);

    if (ref === null) {
        return { instance: null, loading: false, error: null };
    }

    if (error !== null) {
        return { instance: null, loading: false, error };
    }

    if (committed !== null && committed.asset === asset) {
        return { instance: committed.instance, loading: false, error: committed.error };
    }

    return { instance: null, loading: true, error: null };
}

function toError(thrown: unknown): Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
}
