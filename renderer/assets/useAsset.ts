'use client';

import { useEffect, useState } from 'react';

import type { AssetKind, AssetRef } from '@chimera/simulation/content/AssetRef.js';

import type { ResolvedAsset } from './AssetManager';
import { useAssetManager } from './AssetManagerContext.js';

export interface UseAssetState<TAssetKind extends AssetKind> {
    readonly asset: ResolvedAsset<TAssetKind> | null;
    readonly loading: boolean;
    readonly error: Error | null;
}

interface TrackedAssetState<TAssetKind extends AssetKind> extends UseAssetState<TAssetKind> {
    readonly ref: AssetRef<TAssetKind> | null;
}

export function useAsset<TAssetKind extends AssetKind>(
    ref: AssetRef<TAssetKind> | null,
): UseAssetState<TAssetKind> {
    const assetManager = useAssetManager();
    const [state, setState] = useState<TrackedAssetState<TAssetKind>>(() =>
        ref === null ? createIdleState() : createLoadingState(ref),
    );

    useEffect(() => {
        if (ref === null) {
            return;
        }

        let isMounted = true;

        setState(createLoadingState(ref));

        assetManager.load(ref).then(
            (asset) => {
                if (isMounted) {
                    setState({ ref, asset, loading: false, error: null });
                }
            },
            (error: unknown) => {
                if (isMounted) {
                    setState({ ref, asset: null, loading: false, error: toError(error) });
                }
            },
        );

        return () => {
            isMounted = false;
        };
    }, [assetManager, ref]);

    if (ref === null) {
        return toPublicState(createIdleState<TAssetKind>());
    }

    if (state.ref !== ref) {
        return toPublicState(createLoadingState(ref));
    }

    return toPublicState(state);
}

function createIdleState<TAssetKind extends AssetKind>(): TrackedAssetState<TAssetKind> {
    return { ref: null, asset: null, loading: false, error: null };
}

function createLoadingState<TAssetKind extends AssetKind>(
    ref: AssetRef<TAssetKind>,
): TrackedAssetState<TAssetKind> {
    return { ref, asset: null, loading: true, error: null };
}

function toPublicState<TAssetKind extends AssetKind>(
    state: TrackedAssetState<TAssetKind>,
): UseAssetState<TAssetKind> {
    return { asset: state.asset, loading: state.loading, error: state.error };
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
