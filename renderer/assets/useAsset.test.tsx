// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import React, { type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    AssetKind,
    AssetRef,
    ParticleConfigAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from './AssetManager';
import { AssetManagerContext } from './AssetManagerContext.js';
import { useAsset } from './useAsset.js';

const particleRef = 'tactics/particles/spark.json' as AssetRef<ParticleConfigAsset>;

interface Deferred<TValue> {
    readonly promise: Promise<TValue>;
    resolve(value: TValue): void;
    reject(reason: unknown): void;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useAsset', () => {
    it('returns idle state for a null ref', () => {
        const manager = createAssetManagerStub();
        const { result } = renderHook(() => useAsset(null), {
            wrapper: createWrapper(manager),
        });

        expect(result.current).toEqual({ asset: null, loading: false, error: null });
    });

    it('returns loading on first render and resolved asset after load completes', async () => {
        const asset = { effect: 'spark' };
        const deferred = createDeferred<ResolvedAsset<ParticleConfigAsset>>();
        const loadCalls: AssetRef[] = [];
        const manager = createAssetManagerStub(createDeferredLoad(deferred, loadCalls));

        const { result } = renderHook(() => useAsset(particleRef), {
            wrapper: createWrapper(manager),
        });

        expect(result.current).toEqual({ asset: null, loading: true, error: null });
        expect(loadCalls).toEqual([particleRef]);

        await act(async () => {
            deferred.resolve(asset);
            await deferred.promise;
            await flushMicrotasks();
        });

        expect(result.current).toEqual({ asset, loading: false, error: null });
    });

    it('propagates load failures to the error field', async () => {
        const error = new Error('asset load failed');
        const deferred = createDeferred<ResolvedAsset<ParticleConfigAsset>>();
        const manager = createAssetManagerStub(createDeferredLoad(deferred));

        const { result } = renderHook(() => useAsset(particleRef), {
            wrapper: createWrapper(manager),
        });

        await act(async () => {
            deferred.reject(error);
            await deferred.promise.catch(() => undefined);
            await flushMicrotasks();
        });

        expect(result.current).toEqual({ asset: null, loading: false, error });
    });

    it('returns loading synchronously when ref changes before the previous load resolves', async () => {
        const refA = 'tactics/particles/spark.json' as AssetRef<ParticleConfigAsset>;
        const refB = 'tactics/particles/ember.json' as AssetRef<ParticleConfigAsset>;

        const deferredA = createDeferred<ResolvedAsset<ParticleConfigAsset>>();
        const deferredB = createDeferred<ResolvedAsset<ParticleConfigAsset>>();
        let currentRef = refA;
        const manager = createAssetManagerStub(function load<TAssetKind extends AssetKind>(
            ref: AssetRef<TAssetKind>,
        ): Promise<ResolvedAsset<TAssetKind>> {
            if ((ref as string) === refA) {
                return deferredA.promise as Promise<ResolvedAsset<TAssetKind>>;
            }
            return deferredB.promise as Promise<ResolvedAsset<TAssetKind>>;
        });

        const { result, rerender } = renderHook(() => useAsset(currentRef), {
            wrapper: createWrapper(manager),
        });

        expect(result.current).toEqual({ asset: null, loading: true, error: null });

        // Resolve refA so the hook settles
        await act(async () => {
            deferredA.resolve({ effect: 'spark' });
            await deferredA.promise;
            await flushMicrotasks();
        });

        expect(result.current).toEqual({ asset: { effect: 'spark' }, loading: false, error: null });

        // Switch to refB — synchronously the stale-state guard must kick in
        currentRef = refB;
        rerender();

        expect(result.current).toEqual({ asset: null, loading: true, error: null });
    });

    it('does not report a React state update warning after unmount before resolve', async () => {
        const asset = { effect: 'late-spark' };
        const deferred = createDeferred<ResolvedAsset<ParticleConfigAsset>>();
        const manager = createAssetManagerStub(createDeferredLoad(deferred));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { unmount } = renderHook(() => useAsset(particleRef), {
            wrapper: createWrapper(manager),
        });

        unmount();

        await act(async () => {
            deferred.resolve(asset);
            await deferred.promise;
            await flushMicrotasks();
        });

        expect(consoleError).not.toHaveBeenCalled();
    });
});

function createWrapper(
    manager: AssetManager,
): ({ children }: { readonly children: ReactNode }) => ReactElement {
    return function AssetManagerProvider({
        children,
    }: {
        readonly children: ReactNode;
    }): ReactElement {
        return (
            <AssetManagerContext.Provider value={manager}>{children}</AssetManagerContext.Provider>
        );
    };
}

function createAssetManagerStub(load: AssetManager['load'] = createUnusedLoad()): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        load,
        dispose(): void {},
    };
}

function createUnusedLoad(): AssetManager['load'] {
    return async function unusedLoad(): Promise<never> {
        throw new Error('unused asset manager load');
    };
}

function createDeferredLoad(
    deferred: Deferred<ResolvedAsset<ParticleConfigAsset>>,
    loadCalls: AssetRef[] = [],
): AssetManager['load'] {
    return function deferredLoad<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        loadCalls.push(ref);
        return deferred.promise as Promise<ResolvedAsset<TAssetKind>>;
    };
}

function createDeferred<TValue>(): Deferred<TValue> {
    let resolve: ((value: TValue) => void) | undefined;
    let reject: ((reason: unknown) => void) | undefined;
    const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    if (resolve === undefined || reject === undefined) {
        throw new Error('Deferred promise callbacks were not initialized.');
    }

    return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
}
