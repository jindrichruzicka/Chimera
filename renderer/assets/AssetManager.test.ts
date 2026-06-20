import { describe, expect, it, vi } from 'vitest';

vi.mock('three', () => ({
    TextureLoader: class TextureLoader {
        load(url: string, onLoad: (texture: unknown) => void): void {
            onLoad({ textureUrl: url });
        }
    },
}));

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
} from '@chimera/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';
import {
    createAssetLoaderRegistry,
    type AssetLoadRequest,
    type AssetLoader,
    type AssetLoaderRegistry,
    UnknownAssetKindError,
} from './AssetLoaderRegistry';
import {
    DefaultAssetManager,
    type AssetManager,
    type ResolvedAsset,
    UnknownAssetManifestEntryError,
} from './AssetManager';

interface CompressedMapAsset extends AssetKindBrand<'tactics:compressed-map'> {
    readonly __compressedMapAsset: unique symbol;
}

interface LoadedCompressedMapAsset {
    readonly cells: readonly number[];
}

declare module '@chimera/simulation/foundation/asset-contract.js' {
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
