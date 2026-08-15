import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('three', () => ({
    TextureLoader: class TextureLoader {
        load(url: string, onLoad: (texture: unknown) => void): void {
            onLoad({ textureUrl: url });
        }
    },
}));

import type { AnimationClip } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
    type AssetKind,
    type AssetKindBrand,
    type AssetKindId,
    type AssetRef,
    buildAssetRef,
    type AudioClipAsset,
    type GLTFModelAsset,
    type SpriteSheetAsset,
    type TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';
import {
    createAssetLoaderRegistry,
    type AssetLoadRequest,
    type AssetLoader,
    type AssetLoaderRegistry,
    UnknownAssetKindError,
} from './AssetLoaderRegistry';
import {
    createAssetManager,
    CriticalAssetPreloadFailedError,
    DefaultAssetManager,
    type AssetManager,
    type LoadedGltfAsset,
    type ResolvedAsset,
    UnknownAssetManifestEntryError,
} from './AssetManager';

interface CompressedMapAsset extends AssetKindBrand<'tactics:compressed-map'> {
    readonly __compressedMapAsset: unique symbol;
}

interface LoadedCompressedMapAsset {
    readonly cells: readonly number[];
}

declare module '@chimera-engine/simulation/foundation/asset-contract.js' {
    interface AssetKindRegistry {
        readonly 'tactics:compressed-map': CompressedMapAsset;
    }
}

declare module './AssetManager' {
    interface ResolvedAssetRegistry {
        readonly 'tactics:compressed-map': LoadedCompressedMapAsset;
    }
}

function createResolver(): AssetResolver {
    return {
        resolve(ref): string {
            return `resolved://${ref}`;
        },
    };
}

function createManifestEntry<TAssetKind extends AssetKind>(
    ref: AssetManifestEntry<TAssetKind>['ref'],
    kind: AssetKindId<TAssetKind>,
    priority: AssetManifestEntry<TAssetKind>['priority'] = 'deferred',
): AssetManifestEntry<TAssetKind> {
    return { ref, kind, priority } as AssetManifestEntry<TAssetKind>;
}

function registerManifest(manager: AssetManager, entries: readonly AssetManifestEntry[]): void {
    manager.registerManifest({ gameId: 'tactics', entries });
}

function createSingleLoaderRegistry<TAssetKind extends AssetKind>(
    kind: AssetKindId<TAssetKind>,
    load: AssetLoader<TAssetKind>['load'],
): AssetLoaderRegistry {
    return createAssetLoaderRegistry([{ kind, load }]);
}

function createTextureManager(load: AssetLoader<TextureAsset>['load']): DefaultAssetManager {
    return new DefaultAssetManager(createResolver(), createSingleLoaderRegistry('texture', load));
}

function createRegisteredTextureManager(
    ref: ReturnType<typeof buildAssetRef<TextureAsset>>,
    load: AssetLoader<TextureAsset>['load'],
): DefaultAssetManager {
    const manager = createTextureManager(load);
    registerManifest(manager, [createManifestEntry(ref, 'texture')]);
    return manager;
}

function createManualLoader(): {
    readonly registry: AssetLoaderRegistry;
    readonly calls: AssetLoadRequest[];
    readonly resolveNext: (asset: ResolvedAsset) => void;
    readonly rejectNext: (error: unknown) => void;
} {
    const pending: {
        readonly resolve: (asset: ResolvedAsset) => void;
        readonly reject: (error: unknown) => void;
    }[] = [];
    const calls: AssetLoadRequest[] = [];

    return {
        calls,
        registry: createAssetLoaderRegistry([
            {
                kind: 'texture',
                load(request): Promise<ResolvedAsset> {
                    calls.push(request);
                    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
                },
            },
        ]),
        resolveNext(asset): void {
            const pendingLoad = pending.shift();
            if (!pendingLoad) {
                throw new Error('No pending asset load to resolve.');
            }
            pendingLoad.resolve(asset);
        },
        rejectNext(error): void {
            const pendingLoad = pending.shift();
            if (!pendingLoad) {
                throw new Error('No pending asset load to reject.');
            }
            pendingLoad.reject(error);
        },
    };
}

describe('DefaultAssetManager', () => {
    it('get returns null before an asset has loaded', () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const manager = createRegisteredTextureManager(
            ref,
            async (): Promise<ResolvedAsset> => ({
                id: 'unused',
            }),
        );

        expect(manager.get(ref)).toBeNull();
    });

    it('deduplicates concurrent load calls for the same AssetRef', async () => {
        const manualLoader = createManualLoader();
        const manager = new DefaultAssetManager(createResolver(), manualLoader.registry);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const asset = { id: 'grass-texture' };
        registerManifest(manager, [createManifestEntry(ref, 'texture')]);

        const first = manager.load(ref);
        const second = manager.load(ref);
        manualLoader.resolveNext(asset);

        await expect(Promise.all([first, second])).resolves.toEqual([asset, asset]);
        expect(first).toBe(second);
        expect(manualLoader.calls.map((request) => request.url)).toEqual([
            'resolved://tactics/textures/grass.webp',
        ]);
        expect(manager.get(ref)).toBe(asset);
    });

    it('rejects and disposes an in-flight load that resolves after dispose', async () => {
        const manualLoader = createManualLoader();
        const manager = new DefaultAssetManager(createResolver(), manualLoader.registry);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const asset = { id: 'late-texture', dispose: vi.fn() };
        registerManifest(manager, [createManifestEntry(ref, 'texture')]);

        const load = manager.load(ref);
        manager.dispose();
        manualLoader.resolveNext(asset);

        await expect(load).rejects.toThrow('Asset load was superseded by dispose.');
        expect(asset.dispose).toHaveBeenCalledTimes(1);
        expect(manager.get(ref)).toBeNull();
    });

    it('clears failed loads so a later load can retry the same AssetRef', async () => {
        const manualLoader = createManualLoader();
        const loadFailure = new Error('texture decode failed');
        const asset = { id: 'grass-texture' };
        const manager = new DefaultAssetManager(createResolver(), manualLoader.registry);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        registerManifest(manager, [createManifestEntry(ref, 'texture')]);

        const failedLoad = manager.load(ref);
        manualLoader.rejectNext(loadFailure);
        await expect(failedLoad).rejects.toBe(loadFailure);

        const retriedLoad = manager.load(ref);
        manualLoader.resolveNext(asset);
        await expect(retriedLoad).resolves.toBe(asset);

        expect(manualLoader.calls.map((request) => request.url)).toEqual([
            'resolved://tactics/textures/grass.webp',
            'resolved://tactics/textures/grass.webp',
        ]);
        expect(manager.get(ref)).toBe(asset);
    });

    it('clears synchronous loader failures and allows retrying the same AssetRef', async () => {
        const asset = { id: 'grass-texture' };
        const loadFailure = new Error('texture decode failed');
        const load = vi
            .fn<AssetLoader<TextureAsset>['load']>()
            .mockImplementationOnce(() => {
                throw loadFailure;
            })
            .mockResolvedValueOnce(asset);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const manager = createRegisteredTextureManager(ref, load);

        await expect(manager.load(ref)).rejects.toThrow('texture decode failed');
        await expect(manager.load(ref)).resolves.toBe(asset);

        expect(load).toHaveBeenCalledTimes(2);
        expect(manager.get(ref)).toBe(asset);
    });

    it('preloads only critical manifest entries and reports completion progress', async () => {
        const load = vi.fn(
            async (request: AssetLoadRequest): Promise<ResolvedAsset> => ({
                id: request.url,
            }),
        );
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const deferredTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const progress: number[] = [];
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                { ref: deferredTree, kind: 'texture', priority: 'deferred' },
                { ref: criticalCursor, kind: 'texture', priority: 'critical' },
            ],
        };

        await manager.preloadCritical(manifest, (fraction) => progress.push(fraction));

        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenNthCalledWith(1, {
            ref: criticalGrass,
            kind: 'texture',
            url: 'resolved://tactics/textures/grass.webp',
        });
        expect(load).toHaveBeenNthCalledWith(2, {
            ref: criticalCursor,
            kind: 'texture',
            url: 'resolved://tactics/textures/cursor.webp',
        });
        expect(progress).toEqual([0.5, 1]);
        expect(manager.get(criticalGrass)).toEqual({
            id: 'resolved://tactics/textures/grass.webp',
        });
        expect(manager.get(deferredTree)).toBeNull();
        expect(manager.get(criticalCursor)).toEqual({
            id: 'resolved://tactics/textures/cursor.webp',
        });
    });

    it('attempts every critical entry when the FIRST one rejects, and names the failures', async () => {
        // The degradation this closes: a run that abandoned the list at the
        // first bad ref left every entry after it to load on demand — the
        // pop-in `priority: 'critical'` exists to prevent — and rejected with an
        // error naming no ref, so the report could say that something broke and
        // never which.
        const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
            if (request.url.endsWith('grass.webp')) {
                throw new Error('texture 404');
            }
            return { id: request.url };
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const progress: number[] = [];
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                { ref: criticalTree, kind: 'texture', priority: 'critical' },
                { ref: criticalCursor, kind: 'texture', priority: 'critical' },
            ],
        };

        const rejection = await manager
            .preloadCritical(manifest, (fraction) => progress.push(fraction))
            .then(
                () => null,
                (error: unknown) => error,
            );

        // All THREE attempted, in manifest order — the two after the failure are
        // what the old shape dropped.
        expect(load.mock.calls.map((call) => call[0].ref)).toEqual([
            criticalGrass,
            criticalTree,
            criticalCursor,
        ]);
        // The survivors are in the cache, which is the point of attempting them.
        expect(manager.get(criticalTree)).toEqual({ id: 'resolved://tactics/textures/tree.webp' });
        expect(manager.get(criticalCursor)).toEqual({
            id: 'resolved://tactics/textures/cursor.webp',
        });
        expect(manager.get(criticalGrass)).toBeNull();

        // It still REJECTS — the caller's contract is unchanged — but the
        // rejection now names the ref that failed, and carries the cause.
        expect(rejection).toBeInstanceOf(CriticalAssetPreloadFailedError);
        expect((rejection as CriticalAssetPreloadFailedError).refs).toEqual([
            String(criticalGrass),
        ]);
        expect((rejection as Error).message).toContain(String(criticalGrass));
        expect((rejection as Error).message).toContain('texture 404');
        expect((rejection as Error).cause).toBeInstanceOf(Error);

        // A failed entry still SETTLES, so the fraction keeps counting against
        // the same denominator rather than stalling at the failure.
        expect(progress).toEqual([1 / 3, 2 / 3, 1]);
    });

    it('names every failing critical ref, not only the first', async () => {
        // Two failures, so a report that carried `cause` alone — or only the
        // first entry of the list — is distinguishable from one that carries
        // the set.
        const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
            if (request.url.endsWith('cursor.webp')) {
                return { id: request.url };
            }
            throw new Error(`missing ${request.url}`);
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                { ref: criticalCursor, kind: 'texture', priority: 'critical' },
                { ref: criticalTree, kind: 'texture', priority: 'critical' },
            ],
        };

        const rejection = (await manager.preloadCritical(manifest).then(
            () => null,
            (error: unknown) => error,
        )) as CriticalAssetPreloadFailedError;

        expect(rejection.refs).toEqual([String(criticalGrass), String(criticalTree)]);
        expect(rejection.message).toContain(String(criticalTree));
        // `cause` is the FIRST failure, not the last: with two distinct causes
        // the difference is visible, which it is not in the single-failure case.
        expect((rejection.cause as Error).message).toContain('grass.webp');
    });

    it('keeps attempting entries when the failure callback itself throws', async () => {
        // The callback is on a publicly exported interface, so a game can pass
        // one. Unguarded, a throw inside the `catch` escapes the loop and
        // abandons every entry after the first failure — reinstating exactly
        // the shape the settle-all removed, and rejecting with the reporter's
        // error instead of the refs.
        const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
            if (request.url.endsWith('grass.webp')) {
                throw new Error('texture 404');
            }
            return { id: request.url };
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');

        const rejection = await manager
            .preloadCritical(
                {
                    gameId: 'tactics',
                    entries: [
                        { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                        { ref: criticalTree, kind: 'texture', priority: 'critical' },
                    ],
                },
                undefined,
                () => {
                    throw new Error('reporter blew up');
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(load).toHaveBeenCalledTimes(2);
        expect(manager.get(criticalTree)).toEqual({ id: 'resolved://tactics/textures/tree.webp' });
        expect(rejection).toBeInstanceOf(CriticalAssetPreloadFailedError);
        expect((rejection as Error).message).not.toContain('reporter blew up');
    });

    it('attempts every critical entry when the progress callback itself throws', async () => {
        // The sibling hazard to the failure callback above, on the same loop and
        // through the same publicly exported interface: unguarded, the first
        // report's throw escapes the loop, abandons every entry after it, and
        // rejects a run in which nothing actually failed to load.
        const load = vi.fn(
            async (request: AssetLoadRequest): Promise<ResolvedAsset> => ({ id: request.url }),
        );
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const reported: number[] = [];

        const rejection = await manager
            .preloadCritical(
                {
                    gameId: 'tactics',
                    entries: [
                        { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                        { ref: criticalTree, kind: 'texture', priority: 'critical' },
                        { ref: criticalCursor, kind: 'texture', priority: 'critical' },
                    ],
                },
                (fraction) => {
                    reported.push(fraction);
                    throw new Error('progress meter blew up');
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        // All three attempted, in manifest order — the two after the first
        // report are what an escaping throw dropped.
        expect(load.mock.calls.map((call) => call[0].ref)).toEqual([
            criticalGrass,
            criticalTree,
            criticalCursor,
        ]);
        expect(manager.get(criticalCursor)).toEqual({
            id: 'resolved://tactics/textures/cursor.webp',
        });
        // Every report is still ATTEMPTED after one throws — the guard swallows
        // per call rather than muting the callback for the rest of the run.
        expect(reported).toEqual([1 / 3, 2 / 3, 1]);
        // And the run resolves: no ref failed, so there is nothing to reject
        // with, least of all the callback's own error.
        expect(rejection).toBeNull();
    });

    it('rejects with the failing refs, not the progress callback error, when both throw', async () => {
        // Distinguishes "swallowed" from "replaced the rejection": with a broken
        // ref AND a throwing reporter, the aggregate is the only correct answer.
        const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
            if (request.url.endsWith('grass.webp')) {
                throw new Error('texture 404');
            }
            return { id: request.url };
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');

        const rejection = await manager
            .preloadCritical(
                {
                    gameId: 'tactics',
                    entries: [
                        { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                        { ref: criticalTree, kind: 'texture', priority: 'critical' },
                    ],
                },
                () => {
                    throw new Error('progress meter blew up');
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(load).toHaveBeenCalledTimes(2);
        expect(rejection).toBeInstanceOf(CriticalAssetPreloadFailedError);
        expect((rejection as CriticalAssetPreloadFailedError).refs).toEqual([
            String(criticalGrass),
        ]);
        expect((rejection as Error).message).not.toContain('progress meter blew up');
    });

    it('resolves when the progress callback throws on a manifest with no critical entries', async () => {
        // The early-return site reports the terminal `1` outside the loop, so the
        // loop's guard does not cover it: a throw here rejects a run that had
        // nothing to load and could not have failed.
        const load = vi.fn();
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const reported: number[] = [];

        const rejection = await manager
            .preloadCritical(
                {
                    gameId: 'tactics',
                    entries: [
                        {
                            ref: buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp'),
                            kind: 'texture',
                            priority: 'deferred',
                        },
                    ],
                },
                (fraction) => {
                    reported.push(fraction);
                    throw new Error('progress meter blew up');
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(load).not.toHaveBeenCalled();
        expect(reported).toEqual([1]);
        expect(rejection).toBeNull();
    });

    it('announces each failing entry as it settles, before the run itself settles', async () => {
        // The channel a report with no budget depends on: the run attempts every
        // entry, so its own rejection cannot arrive before the slowest one. Here
        // the second entry never answers, and the first entry's failure is
        // announced anyway.
        let settleSecond: ((asset: ResolvedAsset) => void) | undefined;
        const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
            if (request.url.endsWith('grass.webp')) {
                throw new Error('texture 404');
            }
            return new Promise<ResolvedAsset>((resolve) => {
                settleSecond = resolve;
            });
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const announced: string[] = [];
        let settled = false;

        const run = manager
            .preloadCritical(
                {
                    gameId: 'tactics',
                    entries: [
                        { ref: criticalGrass, kind: 'texture', priority: 'critical' },
                        { ref: criticalTree, kind: 'texture', priority: 'critical' },
                    ],
                },
                undefined,
                (ref) => announced.push(String(ref)),
            )
            .catch(() => {
                settled = true;
            });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(announced).toEqual([String(criticalGrass)]);
        // And the run has NOT settled — which is what makes the announcement
        // above the only thing a caller could have reported by now.
        expect(settled).toBe(false);

        settleSecond?.({ id: 'resolved://tactics/textures/tree.webp' });
        await run;
        expect(settled).toBe(true);
    });

    it('reports complete progress when a manifest has no critical entries', async () => {
        const load = vi.fn(async (): Promise<ResolvedAsset> => ({ id: 'unused' }));
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                {
                    ref: buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp'),
                    kind: 'texture',
                    priority: 'deferred',
                },
            ],
        };
        const progress: number[] = [];

        await manager.preloadCritical(manifest, (fraction) => progress.push(fraction));

        expect(load).not.toHaveBeenCalled();
        expect(progress).toEqual([1]);
    });

    it('dispose calls disposable resources and clears the cache without throwing', async () => {
        const texture = { id: 'texture', dispose: vi.fn() };
        const geometry = { id: 'geometry', dispose: vi.fn() };
        const audioBufferEquivalent = { id: 'audio', dispose: vi.fn() };
        const loadedAssets = [texture, geometry, audioBufferEquivalent];
        const load = vi.fn(async (): Promise<ResolvedAsset> => {
            const asset = loadedAssets.shift();
            if (!asset) {
                throw new Error('Unexpected load.');
            }
            return asset;
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([
                { kind: 'texture', load },
                { kind: 'gltf-model', load },
                { kind: 'audio-clip', load },
            ]),
        );
        const textureRef = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const geometryRef = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');
        const audioRef = buildAssetRef<AudioClipAsset>('tactics', 'audio/audio-placeholder.ogg');
        registerManifest(manager, [
            createManifestEntry(textureRef, 'texture'),
            createManifestEntry(geometryRef, 'gltf-model'),
            createManifestEntry(audioRef, 'audio-clip'),
        ]);

        await manager.load(textureRef);
        await manager.load(geometryRef);
        await manager.load(audioRef);

        expect(() => manager.dispose()).not.toThrow();
        expect(() => manager.dispose()).not.toThrow();
        expect(texture.dispose).toHaveBeenCalledTimes(1);
        expect(geometry.dispose).toHaveBeenCalledTimes(1);
        expect(audioBufferEquivalent.dispose).toHaveBeenCalledTimes(1);
        expect(manager.get(textureRef)).toBeNull();
        expect(manager.get(geometryRef)).toBeNull();
        expect(manager.get(audioRef)).toBeNull();
    });

    it('disposes traversable scene resources without repeated subtree traversal', async () => {
        const geometry = { id: 'geometry', dispose: vi.fn() };
        const material = { id: 'material', dispose: vi.fn() };
        const child = {
            dispose: vi.fn(),
            geometry,
            id: 'scene-child',
            material,
            traverse: vi.fn((visitor: (child: unknown) => void) => visitor(child)),
        };
        const unrelatedValue = { id: 'metadata', dispose: vi.fn() };
        const scene = {
            dispose: vi.fn(),
            metadata: unrelatedValue,
            traverse: vi.fn((visitor: (child: unknown) => void) => {
                visitor(scene);
                visitor(child);
            }),
        };
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('gltf-model', async (): Promise<ResolvedAsset> => scene),
        );
        registerManifest(manager, [createManifestEntry(ref, 'gltf-model')]);

        await manager.load(ref);
        manager.dispose();

        expect(scene.dispose).toHaveBeenCalledTimes(1);
        expect(scene.traverse).toHaveBeenCalledTimes(1);
        expect(child.traverse).not.toHaveBeenCalled();
        expect(child.dispose).toHaveBeenCalledTimes(1);
        expect(geometry.dispose).toHaveBeenCalledTimes(1);
        expect(material.dispose).toHaveBeenCalledTimes(1);
        expect(unrelatedValue.dispose).not.toHaveBeenCalled();
    });

    it('keeps LoadedGltfAsset.scene assignable to GLTF scene and animations elements typed as AnimationClip', () => {
        const gltf = {} as LoadedGltfAsset;

        // Widening probe: each line compiles only while `scene` is a `Group` and every
        // `animations` element is an `AnimationClip`. `GLTF['animations']` is a mutable
        // array, so the readonly field is probed per-field — a whole-object
        // `Pick<GLTF, …>` assignment would reject any `readonly` array.
        const sceneWidening: GLTF['scene'] = gltf.scene;
        const animationsWidening: readonly AnimationClip[] = gltf.animations;

        expect(sceneWidening).toBe(gltf.scene);
        expect(animationsWidening).toBe(gltf.animations);
    });

    it('returns the identical cached object for repeated loads of one gltf-model ref', async () => {
        // A fresh object per loader call means identity across loads can only come
        // from the cache — a cache miss on the second load fails the toBe below.
        const load = vi.fn(
            async (): Promise<ResolvedAsset> => ({ animations: [], scene: { name: 'root' } }),
        );
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('gltf-model', load),
        );
        const gltfRef = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');
        registerManifest(manager, [createManifestEntry(gltfRef, 'gltf-model')]);

        expect(await manager.load(gltfRef)).toBe(await manager.load(gltfRef));
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('disposes the shared geometry, material, and skeleton of a SkinnedMesh scene', async () => {
        const geometry = { dispose: vi.fn() };
        const material = { dispose: vi.fn() };
        const skeleton = { dispose: vi.fn() };
        const skinnedMesh = {
            geometry,
            material,
            skeleton,
            traverse: vi.fn(),
        };
        const scene = {
            traverse: vi.fn((visitor: (child: unknown) => void) => {
                visitor(scene);
                visitor(skinnedMesh);
            }),
        };
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry(
                'gltf-model',
                async (): Promise<ResolvedAsset> => ({ animations: [], scene, scenes: [scene] }),
            ),
        );
        registerManifest(manager, [createManifestEntry(ref, 'gltf-model')]);

        await manager.load(ref);
        manager.dispose();

        // The cached original owns these shared resources; teardown must destroy them
        // (Invariant #21) — which is exactly why a per-instance release path must not.
        expect(geometry.dispose).toHaveBeenCalledTimes(1);
        expect(material.dispose).toHaveBeenCalledTimes(1);
        expect(skeleton.dispose).toHaveBeenCalledTimes(1);
        expect(skinnedMesh.traverse).not.toHaveBeenCalled();
    });

    it('routes custom manifest kinds to custom loaders without relying on file extensions', async () => {
        const ref = buildAssetRef<CompressedMapAsset>('tactics', 'maps/desert.mapbin');
        const asset: LoadedCompressedMapAsset = { cells: [1, 2, 3] };
        const load = vi.fn(async (): Promise<LoadedCompressedMapAsset> => asset);
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('tactics:compressed-map', load),
        );
        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref, kind: 'tactics:compressed-map', priority: 'deferred' }],
        });

        await expect(manager.load(ref)).resolves.toBe(asset);

        expect(manager.get(ref)?.cells).toEqual([1, 2, 3]);
        expect(load).toHaveBeenCalledWith({
            ref,
            kind: 'tactics:compressed-map',
            url: 'resolved://tactics/maps/desert.mapbin',
        });
    });

    it('rejects loads for refs that are not declared in the active manifest', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/unlisted.webp');
        const manager = createTextureManager(
            async (): Promise<ResolvedAsset> => ({ id: 'unused' }),
        );

        await expect(manager.load(ref)).rejects.toThrow(UnknownAssetManifestEntryError);
    });

    it('rejects previously declared refs after replacing the active manifest', async () => {
        const firstRef = buildAssetRef<TextureAsset>('tactics', 'textures/first.webp');
        const secondRef = buildAssetRef<TextureAsset>('tactics', 'textures/second.webp');
        const load = vi.fn<AssetLoader<TextureAsset>['load']>(async (request) => ({
            id: request.url,
        }));
        const manager = createTextureManager(load);

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: firstRef, kind: 'texture', priority: 'deferred' }],
        });

        await expect(manager.load(firstRef)).resolves.toEqual({
            id: 'resolved://tactics/textures/first.webp',
        });

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: secondRef, kind: 'texture', priority: 'deferred' }],
        });

        await expect(manager.load(firstRef)).rejects.toThrow(UnknownAssetManifestEntryError);
    });

    it('rejects manifest entries whose kind has no registered loader', async () => {
        const ref = buildAssetRef<CompressedMapAsset>('tactics', 'maps/desert.mapbin');
        const manager = new DefaultAssetManager(createResolver(), createAssetLoaderRegistry());
        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref, kind: 'tactics:compressed-map', priority: 'deferred' }],
        });

        await expect(manager.load(ref)).rejects.toThrow(UnknownAssetKindError);
    });

    it('evicts cached assets for refs whose kind changes across manifest replacement', async () => {
        // At runtime AssetRef is just a string — type-cast lets us reuse the same ref
        // string under a different phantom type to simulate a kind change.
        const refAsTexture = buildAssetRef<TextureAsset>('tactics', 'shared/versatile.webp');
        const refAsMap = refAsTexture as unknown as AssetRef<CompressedMapAsset>;

        const textureAsset = { id: 'texture-asset' };
        const mapAsset: LoadedCompressedMapAsset = { cells: [42] };

        const textureLoad = vi.fn(async (): Promise<ResolvedAsset> => textureAsset);
        const mapLoad = vi.fn(async (): Promise<LoadedCompressedMapAsset> => mapAsset);

        const manager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([
                { kind: 'texture', load: textureLoad },
                { kind: 'tactics:compressed-map', load: mapLoad },
            ]),
        );

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: refAsTexture, kind: 'texture', priority: 'deferred' }],
        });
        await manager.load(refAsTexture);
        expect(textureLoad).toHaveBeenCalledTimes(1);

        // Replace manifest: same ref path, different kind.
        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: refAsMap, kind: 'tactics:compressed-map', priority: 'deferred' }],
        });

        // Must invoke the map loader, NOT return the stale texture cache.
        const loaded = await manager.load(refAsMap);
        expect(loaded).toBe(mapAsset);
        expect(mapLoad).toHaveBeenCalledTimes(1);
        expect(textureLoad).toHaveBeenCalledTimes(1);
    });

    it('evicts cached assets for refs whose manifest metadata changes', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/multi-purpose.webp');
        const load = vi.fn<AssetLoader<TextureAsset>['load']>(async () => ({
            id: 'fresh',
        }));
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('texture', load),
        );

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref, kind: 'texture', priority: 'deferred', metadata: { variant: 'hd' } }],
        });
        await manager.load(ref);

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref, kind: 'texture', priority: 'deferred', metadata: { variant: 'sd' } }],
        });
        // Metadata changed — must reload, not serve stale cache.
        await manager.load(ref);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('keeps cached assets across a re-registration whose sheet is rebuilt but deep-equal', async () => {
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/warrior.glb');
        const load = vi.fn<AssetLoader<GLTFModelAsset>['load']>(async () => ({
            scene: { name: 'warrior' } as unknown as LoadedGltfAsset['scene'],
            animations: [],
        }));
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('gltf-model', load),
        );
        // Rebuilt per registration on purpose. A manifest assembled inside a
        // React render allocates a fresh sheet every time, so only a STRUCTURAL
        // comparison can see it as unchanged; `assetManifestEntryEquivalent`
        // comparing metadata by identity — or refusing every pair outright —
        // would evict the decoded model on each re-registration. Building the
        // sheet as a module-scope constant instead would pass under all three.
        const register = (): void => {
            manager.registerManifest({
                gameId: 'tactics',
                entries: [
                    {
                        ref,
                        kind: 'gltf-model',
                        priority: 'deferred',
                        metadata: {
                            clips: {
                                swing: { durationSeconds: 1, notifies: { woosh: { at: 0.25 } } },
                            },
                        },
                    },
                ],
            });
        };

        register();
        const first = await manager.load(ref);
        register();

        expect(await manager.load(ref)).toBe(first);
        expect(load).toHaveBeenCalledTimes(1);
        expect(manager.get(ref)).toBe(first);
    });

    it('disposes cached assets that are evicted by manifest replacement', async () => {
        const removedRef = buildAssetRef<TextureAsset>('tactics', 'textures/removed.webp');
        const retainedRef = buildAssetRef<TextureAsset>('tactics', 'textures/retained.webp');
        const removedAsset = { id: 'removed', dispose: vi.fn() };
        const retainedAsset = { id: 'retained', dispose: vi.fn() };
        const assetsByRef = new Map<string, ResolvedAsset>([
            [removedRef, removedAsset],
            [retainedRef, retainedAsset],
        ]);
        const load = vi.fn<AssetLoader<TextureAsset>['load']>(async (request) => {
            const asset = assetsByRef.get(request.ref);
            if (asset === undefined) {
                throw new Error('Unexpected ref.');
            }
            return asset;
        });
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('texture', load),
        );

        manager.registerManifest({
            gameId: 'tactics',
            entries: [
                { ref: removedRef, kind: 'texture', priority: 'deferred' },
                { ref: retainedRef, kind: 'texture', priority: 'deferred' },
            ],
        });
        await manager.load(removedRef);
        await manager.load(retainedRef);

        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: retainedRef, kind: 'texture', priority: 'deferred' }],
        });

        expect(removedAsset.dispose).toHaveBeenCalledTimes(1);
        expect(retainedAsset.dispose).not.toHaveBeenCalled();
        expect(manager.get(removedRef)).toBeNull();
        expect(manager.get(retainedRef)).toBe(retainedAsset);
    });

    it('loads sprite-sheet JSON atlases with texture and frame data', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/units/warrior.json');
        const fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                frames: {
                    idle: { x: 0, y: 0, w: 32, h: 32 },
                },
                meta: {
                    image: 'warrior.webp',
                },
            }),
        }));
        vi.stubGlobal('fetch', fetch);
        const manager = new DefaultAssetManager(createResolver());
        registerManifest(manager, [createManifestEntry(ref, 'sprite-sheet')]);

        try {
            const loaded = await manager.load(ref);

            expect(loaded.texture).toEqual({
                textureUrl: 'resolved://tactics/sprites/units/warrior.webp',
            });
            expect(loaded.frames).toEqual({
                idle: { x: 0, y: 0, w: 32, h: 32 },
            });
            expect(fetch).toHaveBeenCalledWith('resolved://tactics/sprites/units/warrior.json');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('rejects sprite-sheet JSON atlases with traversal-unsafe meta.image paths', async () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/units/warrior.json');
        const fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                meta: {
                    image: '../outside.webp',
                },
            }),
        }));
        vi.stubGlobal('fetch', fetch);
        const manager = new DefaultAssetManager(createResolver());
        registerManifest(manager, [createManifestEntry(ref, 'sprite-sheet')]);

        try {
            await expect(manager.load(ref)).rejects.toThrow(
                "Sprite sheet atlas 'resolved://tactics/sprites/units/warrior.json' declares traversal-unsafe meta.image '../outside.webp'.",
            );
            expect(fetch).toHaveBeenCalledWith('resolved://tactics/sprites/units/warrior.json');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('preserves cached assets for refs that are unchanged across manifest replacement', async () => {
        const unchangedRef = buildAssetRef<TextureAsset>('tactics', 'textures/unchanged.webp');
        const removedRef = buildAssetRef<TextureAsset>('tactics', 'textures/removed.webp');

        let callCount = 0;
        const load = vi.fn<AssetLoader<TextureAsset>['load']>(async () => ({
            id: `load-${++callCount}`,
        }));
        const manager = new DefaultAssetManager(
            createResolver(),
            createSingleLoaderRegistry('texture', load),
        );

        manager.registerManifest({
            gameId: 'tactics',
            entries: [
                { ref: unchangedRef, kind: 'texture', priority: 'deferred' },
                { ref: removedRef, kind: 'texture', priority: 'deferred' },
            ],
        });
        const firstResult = await manager.load(unchangedRef);

        // Replace manifest: unchangedRef stays with identical entry; removedRef is gone.
        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref: unchangedRef, kind: 'texture', priority: 'deferred' }],
        });

        // Unchanged ref must still be served from cache — no second network fetch.
        const secondResult = await manager.load(unchangedRef);
        expect(secondResult).toBe(firstResult);
        expect(load).toHaveBeenCalledTimes(1);

        // Removed ref must be rejected.
        await expect(manager.load(removedRef)).rejects.toThrow(UnknownAssetManifestEntryError);
    });
});

describe('DefaultAssetManager.getManifestMetadata', () => {
    it('returns a registered entry metadata verbatim, kind-agnostically', () => {
        const manager = new DefaultAssetManager(createResolver());
        const textureRef = buildAssetRef<TextureAsset>('tactics', 'textures/hd.webp');
        const audioRef = buildAssetRef<AudioClipAsset>('tactics', 'audio/theme.ogg');
        const textureMetadata = { variant: 'hd' };
        const audioMetadata = { cues: { chorus: 5 }, durationSeconds: 10 };

        manager.registerManifest({
            gameId: 'tactics',
            entries: [
                {
                    ref: textureRef,
                    kind: 'texture',
                    priority: 'deferred',
                    metadata: textureMetadata,
                },
                {
                    ref: audioRef,
                    kind: 'audio-clip',
                    priority: 'deferred',
                    metadata: audioMetadata,
                },
            ],
        });

        // Returned by reference — the accessor never copies or interprets the value.
        expect(manager.getManifestMetadata(textureRef)).toBe(textureMetadata);
        expect(manager.getManifestMetadata(audioRef)).toBe(audioMetadata);
    });

    it('returns undefined for a ref absent from the active manifest', () => {
        const manager = new DefaultAssetManager(createResolver());
        const ref = buildAssetRef<AudioClipAsset>('tactics', 'audio/never-registered.ogg');

        expect(manager.getManifestMetadata(ref)).toBeUndefined();
    });

    it('returns undefined for a registered entry that declares no metadata', () => {
        const manager = new DefaultAssetManager(createResolver());
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/plain.webp');
        registerManifest(manager, [createManifestEntry(ref, 'texture')]);

        expect(manager.getManifestMetadata(ref)).toBeUndefined();
    });

    it('is a pure synchronous read that triggers no decode or load side effect', () => {
        const resolver = createResolver();
        const resolveSpy = vi.spyOn(resolver, 'resolve');
        const manualLoader = createManualLoader();
        const manager = new DefaultAssetManager(resolver, manualLoader.registry);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/with-metadata.webp');
        const metadata = { variant: 'hd' };
        manager.registerManifest({
            gameId: 'tactics',
            entries: [{ ref, kind: 'texture', priority: 'deferred', metadata }],
        });

        expect(manager.getManifestMetadata(ref)).toBe(metadata);
        // A pure read must not resolve a URL, invoke a loader, or populate the cache.
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(manualLoader.calls).toHaveLength(0);
        expect(manager.get(ref)).toBeNull();
    });

    it('exposes getManifestMetadata as a kind-agnostic (ref: AssetRef) => unknown channel', () => {
        const manager = new DefaultAssetManager(createResolver());
        const ref = buildAssetRef<AudioClipAsset>('tactics', 'audio/theme.ogg');

        expectTypeOf<AssetManager['getManifestMetadata']>().toEqualTypeOf<
            (ref: AssetRef) => unknown
        >();
        expectTypeOf(manager.getManifestMetadata(ref)).toBeUnknown();
    });
});

describe('createAssetManager — construction manifest', () => {
    it('registers a construction manifest before returning: load(declaredRef) resolves and get does not throw', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const asset = { id: 'grass-texture' };
        const manager = createAssetManager(
            createResolver(),
            { gameId: 'tactics', entries: [createManifestEntry(ref, 'texture')] },
            createSingleLoaderRegistry('texture', async (): Promise<ResolvedAsset> => asset),
        );

        expect(manager.get(ref)).toBeNull();
        await expect(manager.load(ref)).resolves.toBe(asset);
        expect(manager.get(ref)).toBe(asset);
    });

    it('behaves exactly as before when the manifest argument is omitted: an undeclared load fails fast', async () => {
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const manager = createAssetManager(
            createResolver(),
            undefined,
            createSingleLoaderRegistry(
                'texture',
                async (): Promise<ResolvedAsset> => ({
                    id: 'unused',
                }),
            ),
        );

        await expect(manager.load(ref)).rejects.toBeInstanceOf(UnknownAssetManifestEntryError);
    });
});
