// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import React, { type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimationClip, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
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
    type ModelInstanceMaterialOverride,
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

/**
 * A REAL StrictMode double mount — see
 * `../components/r3f/useModelAnimation.test.tsx`.
 *
 * It composes with `wrapper`, which is why the context provider still is one:
 * RTL builds `strictModeIfNeeded(wrapUiIfNeeded(ui, Wrapper))`, so StrictMode
 * ends up OUTSIDE the provider and at the root.
 */
const STRICT = { reactStrictMode: true } as const;

describe('useModelInstance', () => {
    it('clones once under a StrictMode double mount, after the load the double mount precedes, and releases it', async () => {
        const asset = createGltfAsset();
        // Counted through a closure rather than `vi.fn`, which erases `load`'s
        // generic signature and stops the stub type-checking as an AssetManager.
        let loadCalls = 0;
        const resolvedLoad = createResolvedLoad(asset);
        const manager = createAssetManagerStub(function load(ref) {
            loadCalls += 1;
            return resolvedLoad(ref);
        });

        const { result, unmount } = renderHook(() => useModelInstance(modelRef), {
            wrapper: createWrapper(manager),
            ...STRICT,
        });

        // The double mount REACHED the hook: `useAsset`'s effect ran
        // setup/cleanup/setup, so the manager was asked twice. This is the
        // assertion the `wrapper` form could not make — there `load` is called
        // once — and it is what makes the clone count below a measurement
        // rather than a coincidence.
        expect(loadCalls).toBe(2);

        await act(async () => {
            await flushMicrotasks();
        });
        expect(result.current.instance).not.toBeNull();

        unmount();

        // ONE clone is the whole point: `useAsset` publishes through a promise,
        // so `asset` is still null on the commit the simulated remount runs in,
        // and the allocating effect early-returns both times. A hook that cloned
        // without waiting for the asset would clone on each of those setups and
        // release on each cleanup — leaving `cloneCalls === releaseCalls` true
        // and only this count able to tell the difference.
        expect(cloneSpy.mock.calls).toHaveLength(1);
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
        // Vite rewrites this static-literal `new URL(..., import.meta.url)`
        // pattern to an http URL whose pathname is rooted at the vitest --dir
        // under jsdom (raw import.meta.url stays the true file URL), so
        // resolve the pathname against cwd — the --dir for every pnpm-run
        // script.
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
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
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

describe('useModelInstance with a material override', () => {
    it('gives two mounts of the same model different tints and leaves the cached material untouched after both unmount', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));
        const states: (UseModelInstanceState | undefined)[] = [undefined, undefined];

        function Probe({ slot, color }: { readonly slot: number; readonly color: string }): null {
            states[slot] = useModelInstance(modelRef, { color });
            return null;
        }

        const { unmount } = render(
            <AssetManagerContext.Provider value={manager}>
                <Probe slot={0} color="red" />
                <Probe slot={1} color="lime" />
            </AssetManagerContext.Provider>,
        );
        await act(async () => {
            await flushMicrotasks();
        });

        const first = publishedMaterial(getPublishedInstance(states[0]));
        const second = publishedMaterial(getPublishedInstance(states[1]));
        expect(first).not.toBe(cachedMaterial(asset));
        expect(second).not.toBe(cachedMaterial(asset));
        expect(first.color.getHexString()).toBe('ff0000');
        expect(second.color.getHexString()).toBe('00ff00');

        unmount();

        expect(cachedMaterial(asset).color.getHexString()).toBe('ffffff');
        expect(releaseSpy).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['color', { color: 'red' }, { color: 'blue' }],
        ['emissive', { emissive: 'red' }, { emissive: 'blue' }],
    ] as const)(
        'changes %s in place on a re-render, without re-cloning',
        async (field, before, after) => {
            const asset = createGltfAsset();
            const manager = createAssetManagerStub(createResolvedLoad(asset));
            let override: ModelInstanceMaterialOverride = before;

            const { result, rerender } = renderHook(() => useModelInstance(modelRef, override), {
                wrapper: createWrapper(manager),
            });
            await act(async () => {
                await flushMicrotasks();
            });
            const instance = getPublishedInstance(result.current);
            const clonesAfterPublish = cloneSpy.mock.calls.length;

            override = after;
            rerender();
            await act(async () => {
                await flushMicrotasks();
            });

            expect(cloneSpy).toHaveBeenCalledTimes(clonesAfterPublish);
            expect(getPublishedInstance(result.current)).toBe(instance);
            expect(publishedMaterial(instance)[field].getHexString()).toBe('0000ff');
        },
    );

    it('colours the owned materials before any consumer effect of the publishing commit runs', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));
        const seen: string[] = [];

        // A child's passive effect runs BEFORE its parent's in the same commit,
        // so an apply done from a passive effect would let this child observe
        // the authored white first. A layout effect runs before every passive
        // effect of the commit, which is what puts red first here.
        function Consumer({ instance }: { readonly instance: ModelInstance | null }): null {
            React.useEffect(() => {
                if (instance !== null) {
                    seen.push(publishedMaterial(instance).color.getHexString());
                }
            }, [instance]);
            return null;
        }

        function Owner(): ReactElement {
            const { instance } = useModelInstance(modelRef, { color: 'red' });
            return <Consumer instance={instance} />;
        }

        render(
            <AssetManagerContext.Provider value={manager}>
                <Owner />
            </AssetManagerContext.Provider>,
        );
        await act(async () => {
            await flushMicrotasks();
        });

        expect(seen[0]).toBe('ff0000');
    });

    it('does not re-clone for a new override object carrying the same values', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));

        const { result, rerender } = renderHook(
            () => useModelInstance(modelRef, { color: 'red', emissive: 'blue' }),
            { wrapper: createWrapper(manager) },
        );
        await act(async () => {
            await flushMicrotasks();
        });
        const instance = getPublishedInstance(result.current);
        const clonesAfterPublish = cloneSpy.mock.calls.length;

        rerender();
        await act(async () => {
            await flushMicrotasks();
        });

        expect(cloneSpy).toHaveBeenCalledTimes(clonesAfterPublish);
        expect(getPublishedInstance(result.current)).toBe(instance);
        expect(publishedMaterial(instance).color.getHexString()).toBe('ff0000');
        expect(publishedMaterial(instance).emissive.getHexString()).toBe('0000ff');
    });

    it('re-clones when an override is added to a mounted instance, and again when it is removed', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));
        let override: ModelInstanceMaterialOverride | undefined = undefined;

        const { result, rerender } = renderHook(() => useModelInstance(modelRef, override), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });
        const shared = getPublishedInstance(result.current);
        expect(publishedMaterial(shared)).toBe(cachedMaterial(asset));

        override = { color: 'red' };
        rerender();
        await act(async () => {
            await flushMicrotasks();
        });
        const owned = getPublishedInstance(result.current);
        expect(owned).not.toBe(shared);
        expect(releaseSpy).toHaveBeenCalledWith(shared);
        expect(publishedMaterial(owned)).not.toBe(cachedMaterial(asset));
        expect(publishedMaterial(owned).color.getHexString()).toBe('ff0000');

        override = undefined;
        rerender();
        await act(async () => {
            await flushMicrotasks();
        });
        const sharedAgain = getPublishedInstance(result.current);
        expect(sharedAgain).not.toBe(owned);
        expect(releaseSpy).toHaveBeenCalledWith(owned);
        expect(publishedMaterial(sharedAgain)).toBe(cachedMaterial(asset));
        expect(cachedMaterial(asset).color.getHexString()).toBe('ffffff');
    });
});

describe('useModelInstance disposes what its clone owns', () => {
    it('disposes the clone-owned material on unmount', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));

        const { result, unmount } = renderHook(() => useModelInstance(modelRef, { color: 'red' }), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });
        const owned = publishedMaterial(getPublishedInstance(result.current));
        const ownedDispose = vi.spyOn(owned, 'dispose');
        const cachedDispose = vi.spyOn(cachedMaterial(asset), 'dispose');

        unmount();

        expect(ownedDispose).toHaveBeenCalledTimes(1);
        expect(cachedDispose).not.toHaveBeenCalled();
    });

    it('unmounts without throwing when the dispose of an owned material throws', async () => {
        const asset = createGltfAsset();
        const manager = createAssetManagerStub(createResolvedLoad(asset));

        const { result, unmount } = renderHook(() => useModelInstance(modelRef, { color: 'red' }), {
            wrapper: createWrapper(manager),
        });
        await act(async () => {
            await flushMicrotasks();
        });
        vi.spyOn(
            publishedMaterial(getPublishedInstance(result.current)),
            'dispose',
        ).mockImplementation(() => {
            throw new Error('dispose listener failure');
        });

        expect(() => unmount()).not.toThrow();
    });

    it('disposes the clone-owned material when the resolved asset identity changes under a stable ref', async () => {
        const managerA = createAssetManagerStub(createResolvedLoad(createGltfAsset()));
        const managerB = createAssetManagerStub(createResolvedLoad(createGltfAsset()));
        let currentManager = managerA;

        const { result, rerender } = renderHook(
            () => useModelInstance(modelRef, { color: 'red' }),
            {
                wrapper: createManagerGetterWrapper(() => currentManager),
            },
        );
        await act(async () => {
            await flushMicrotasks();
        });
        const firstOwned = publishedMaterial(getPublishedInstance(result.current));
        const firstDispose = vi.spyOn(firstOwned, 'dispose');

        currentManager = managerB;
        rerender();
        await act(async () => {
            await flushMicrotasks();
        });

        expect(firstDispose).toHaveBeenCalledTimes(1);
        expect(publishedMaterial(getPublishedInstance(result.current))).not.toBe(firstOwned);
    });
});

function cachedMaterial(asset: LoadedGltfAsset): MeshStandardMaterial {
    return (asset.scene.getObjectByName('prop') as Mesh).material as MeshStandardMaterial;
}

function publishedMaterial(instance: ModelInstance): MeshStandardMaterial {
    return (instance.root.getObjectByName('prop') as Mesh).material as MeshStandardMaterial;
}
