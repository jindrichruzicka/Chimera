// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import React, { StrictMode, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimationClip, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type * as SkeletonUtilsModule from 'three/examples/jsm/utils/SkeletonUtils.js';

import type {
    AssetKind,
    AssetRef,
    GLTFModelAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, LoadedGltfAsset, ResolvedAsset } from './AssetManager';
import { AssetManagerContext } from './AssetManagerContext.js';
import {
    cloneModelInstance,
    MalformedModelAssetError,
    type ModelInstance,
    releaseModelInstance,
} from './ModelInstance.js';
import type * as ModelInstanceModule from './ModelInstance.js';
import { type UseModelInstanceState, useModelInstance } from './useModelInstance.js';

vi.mock('three/examples/jsm/utils/SkeletonUtils.js', async (importOriginal) => {
    const original = await importOriginal<typeof SkeletonUtilsModule>();
    return { ...original, clone: vi.fn(original.clone) };
});

vi.mock('./ModelInstance.js', async (importOriginal) => {
    const original = await importOriginal<typeof ModelInstanceModule>();
    return {
        ...original,
        cloneModelInstance: vi.fn(original.cloneModelInstance),
        releaseModelInstance: vi.fn(original.releaseModelInstance),
    };
});

const cloneSpy = vi.mocked(cloneWithSkeleton);
const cloneModelInstanceSpy = vi.mocked(cloneModelInstance);
const releaseSpy = vi.mocked(releaseModelInstance);

const modelRef = 'tactics/models/crate.glb' as AssetRef<GLTFModelAsset>;

interface Deferred<TValue> {
    readonly promise: Promise<TValue>;
    resolve(value: TValue): void;
    reject(reason: unknown): void;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

describe('useModelInstance', () => {
    it('releases every clone it allocates under StrictMode: cloneCalls === releaseCalls after unmount', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));

        const { result, unmount } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createStrictModeWrapper(manager),
        });

        await act(async () => {
            await flushMicrotasks();
        });
        expect(result.current.instance).not.toBeNull();

        unmount();

        expect(cloneSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(releaseSpy).toHaveBeenCalledTimes(cloneSpy.mock.calls.length);
        const clonedRoots = cloneSpy.mock.results.map((cloneResult) => cloneResult.value);
        const releasedRoots = releaseSpy.mock.calls.map(([instance]) => instance.root);
        expect(new Set(releasedRoots)).toEqual(new Set(clonedRoots));
    });

    it('gives two components on the same ref distinct roots but the identical clips array', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));
        const states: (UseModelInstanceState | undefined)[] = [undefined, undefined];

        function Probe({ slot }: { readonly slot: number }): null {
            states[slot] = useModelInstance(modelRef);
            return null;
        }

        render(
            <AssetManagerContext.Provider value={manager}>
                <Probe slot={0} />
                <Probe slot={1} />
            </AssetManagerContext.Provider>,
        );
        await act(async () => {
            await flushMicrotasks();
        });

        const first = getPublishedInstance(states[0]);
        const second = getPublishedInstance(states[1]);
        expect(first.root).not.toBe(second.root);
        expect(first.clips).toBe(second.clips);
    });

    it('releases the previous clone and publishes a new one when the resolved asset identity changes mid-mount', async () => {
        // A provider swap is the test's stand-in for a manifest eviction +
        // reload: both hand the hook a NEW resolved-asset object under an
        // unchanged ref string.
        const managerA = createAssetManagerStub(createResolvedLoad(createGltfAsset('prop-a')));
        const managerB = createAssetManagerStub(createResolvedLoad(createGltfAsset('prop-b')));
        let currentManager = managerA;
        const observed: UseModelInstanceState[] = [];

        const { result, rerender } = renderHook(
            () => {
                const state = useModelInstance(modelRef);
                observed.push(state);
                return state;
            },
            { wrapper: createManagerGetterWrapper(() => currentManager) },
        );
        await act(async () => {
            await flushMicrotasks();
        });
        const firstInstance = getPublishedInstance(result.current);
        expect(firstInstance.root.getObjectByName('prop-a')).toBeDefined();

        const rendersBeforeSwap = observed.length;
        currentManager = managerB;
        rerender();
        await act(async () => {
            await flushMicrotasks();
        });

        expect(releaseSpy).toHaveBeenCalledWith(firstInstance);
        const secondInstance = getPublishedInstance(result.current);
        expect(secondInstance).not.toBe(firstInstance);
        expect(secondInstance.root.getObjectByName('prop-b')).toBeDefined();

        // The old clone may render once more — useAsset stores resolved
        // state keyed only on the ref, so the swap render still returns the
        // old asset — but never again: a second post-swap exposure means the
        // render path ignored the resolved-asset identity and showed a
        // released clone.
        const postSwapOldExposures = observed
            .slice(rendersBeforeSwap)
            .filter((state) => state.instance === firstInstance);
        expect(postSwapOldExposures).toHaveLength(1);
    });

    it('does not clone again on a re-render with an unchanged asset', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));

        const { result, rerender } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });
        const firstInstance = getPublishedInstance(result.current);
        const clonesAfterPublish = cloneSpy.mock.calls.length;

        rerender();
        await act(async () => {
            await flushMicrotasks();
        });

        expect(cloneSpy).toHaveBeenCalledTimes(clonesAfterPublish);
        expect(getPublishedInstance(result.current)).toBe(firstInstance);
    });

    it('yields idle state for a null ref without touching the manager', () => {
        const manager = createAssetManagerStub();

        const { result } = renderHook(() => useModelInstance(null), {
            wrapper: createWrapper(manager),
        });

        expect(result.current).toEqual({ instance: null, loading: false, error: null });
        expect(cloneSpy).not.toHaveBeenCalled();
    });

    it('surfaces a rejected load as error with a null instance', async () => {
        const error = new Error('model load failed');
        const deferred = createDeferred<ResolvedAsset<GLTFModelAsset>>();
        const manager = createAssetManagerStub(createDeferredLoad(deferred));

        const { result } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            deferred.reject(error);
            await deferred.promise.catch(() => undefined);
            await flushMicrotasks();
        });

        expect(result.current).toEqual({ instance: null, loading: false, error });
        expect(cloneSpy).not.toHaveBeenCalled();
    });

    it('surfaces a malformed asset as MalformedModelAssetError state instead of throwing out of render', async () => {
        const malformed = {
            scene: { name: 'not-a-scene' },
            animations: [],
        } as unknown as LoadedGltfAsset;
        const manager = createAssetManagerStub(createResolvedLoad(malformed));

        const { result } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });

        expect(result.current.instance).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeInstanceOf(MalformedModelAssetError);
    });

    it('normalises a non-Error clone failure into an Error surfaced as state.error', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));
        cloneModelInstanceSpy.mockImplementationOnce(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'clone failed as a plain string';
        });

        const { result } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });

        expect(result.current.instance).toBeNull();
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toContain('clone failed as a plain string');
    });

    it('reports loading for exactly one render between the asset resolving and the clone publishing', async () => {
        const asset = createGltfAsset();
        const deferred = createDeferred<ResolvedAsset<GLTFModelAsset>>();
        const manager = createAssetManagerStub(createDeferredLoad(deferred));
        const observed: UseModelInstanceState[] = [];

        function Recorder(): null {
            observed.push(useModelInstance(modelRef));
            return null;
        }

        render(
            <AssetManagerContext.Provider value={manager}>
                <Recorder />
            </AssetManagerContext.Provider>,
        );

        const rendersBeforeResolve = observed.length;
        // Before the load resolves every render must report a clean loading
        // state — an effect that runs the clone attempt against a null asset
        // would publish a bogus error here.
        expect(rendersBeforeResolve).toBeGreaterThanOrEqual(1);
        for (const state of observed) {
            expect(state).toEqual({ instance: null, loading: true, error: null });
        }

        await act(async () => {
            deferred.resolve(asset);
            await deferred.promise;
            await flushMicrotasks();
        });

        const afterResolve = observed.slice(rendersBeforeResolve);
        expect(afterResolve).toHaveLength(2);
        expect(afterResolve[0]).toEqual({ instance: null, loading: true, error: null });
        expect(afterResolve[1]?.loading).toBe(false);
        expect(afterResolve[1]?.instance).not.toBeNull();
    });
});

describe('useModelInstance module shape', () => {
    it(`keeps 'use client' as line 1 and never re-exports the ModelInstance seam`, () => {
        // Under the jsdom environment import.meta.url is an http URL whose
        // pathname is rooted at the vitest --dir (the renderer package, which
        // is also the test run's cwd), so resolve it against cwd.
        const moduleUrl = new URL('./useModelInstance.ts', import.meta.url);
        const modulePath =
            moduleUrl.protocol === 'file:'
                ? fileURLToPath(moduleUrl)
                : join(process.cwd(), moduleUrl.pathname);
        const source = readFileSync(modulePath, 'utf8');
        const [firstLine] = source.split('\n');

        expect(firstLine).toBe(`'use client';`);
        expect(source).not.toMatch(/export\s+\{[^}]*(cloneModelInstance|releaseModelInstance)/);
        expect(source).not.toMatch(/export\s+\*/);
    });
});

function createGltfAsset(meshName = 'prop'): LoadedGltfAsset {
    const scene = new Group();
    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.name = meshName;
    scene.add(mesh);
    return { scene, animations: [new AnimationClip('idle', -1, [])] };
}

function getPublishedInstance(state: UseModelInstanceState | undefined): ModelInstance {
    const instance = state?.instance ?? null;
    if (instance === null) {
        throw new Error('Expected the hook to have published a ModelInstance.');
    }
    return instance;
}

function createWrapper(
    manager: AssetManager,
): ({ children }: { readonly children: ReactNode }) => ReactElement {
    return createManagerGetterWrapper(() => manager);
}

function createStrictModeWrapper(
    manager: AssetManager,
): ({ children }: { readonly children: ReactNode }) => ReactElement {
    return function StrictModeAssetManagerProvider({
        children,
    }: {
        readonly children: ReactNode;
    }): ReactElement {
        return (
            <StrictMode>
                <AssetManagerContext.Provider value={manager}>
                    {children}
                </AssetManagerContext.Provider>
            </StrictMode>
        );
    };
}

function createManagerGetterWrapper(
    getManager: () => AssetManager,
): ({ children }: { readonly children: ReactNode }) => ReactElement {
    return function AssetManagerProvider({
        children,
    }: {
        readonly children: ReactNode;
    }): ReactElement {
        return (
            <AssetManagerContext.Provider value={getManager()}>
                {children}
            </AssetManagerContext.Provider>
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
        getManifestMetadata(): unknown {
            return undefined;
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

function createResolvedLoad(asset: LoadedGltfAsset): AssetManager['load'] {
    return function resolvedLoad<TAssetKind extends AssetKind>(): Promise<
        ResolvedAsset<TAssetKind>
    > {
        return Promise.resolve(asset) as Promise<ResolvedAsset<TAssetKind>>;
    };
}

function createDeferredLoad(
    deferred: Deferred<ResolvedAsset<GLTFModelAsset>>,
): AssetManager['load'] {
    return function deferredLoad<TAssetKind extends AssetKind>(): Promise<
        ResolvedAsset<TAssetKind>
    > {
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
