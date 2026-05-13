import { describe, expect, it, vi } from 'vitest';

import {
    buildAssetRef,
    type AudioClipAsset,
    type GLTFModelAsset,
    type TextureAsset,
} from '@chimera/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';
import { DefaultAssetManager, type AssetLoader, type ResolvedAsset } from './AssetManager';

function createResolver(): AssetResolver {
    return {
        resolve(ref): string {
            return `resolved://${ref}`;
        },
    };
}

function createManualLoader(): {
    readonly loader: AssetLoader;
    readonly calls: string[];
    readonly resolveNext: (asset: ResolvedAsset) => void;
    readonly rejectNext: (error: unknown) => void;
} {
    const pending: {
        readonly resolve: (asset: ResolvedAsset) => void;
        readonly reject: (error: unknown) => void;
    }[] = [];
    const calls: string[] = [];

    return {
        calls,
        loader: {
            load(url): Promise<ResolvedAsset> {
                calls.push(url);
                return new Promise((resolve, reject) => pending.push({ resolve, reject }));
            },
        },
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
        const manager = new DefaultAssetManager(createResolver(), {
            async load(): Promise<ResolvedAsset> {
                return { id: 'unused' };
            },
        });
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');

        expect(manager.get(ref)).toBeNull();
    });

    it('deduplicates concurrent load calls for the same AssetRef', async () => {
        const manualLoader = createManualLoader();
        const manager = new DefaultAssetManager(createResolver(), manualLoader.loader);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const asset = { id: 'grass-texture' };

        const first = manager.load(ref);
        const second = manager.load(ref);
        manualLoader.resolveNext(asset);

        await expect(Promise.all([first, second])).resolves.toEqual([asset, asset]);
        expect(first).toBe(second);
        expect(manualLoader.calls).toEqual(['resolved://tactics/textures/grass.webp']);
        expect(manager.get(ref)).toBe(asset);
    });

    it('rejects and disposes an in-flight load that resolves after dispose', async () => {
        const manualLoader = createManualLoader();
        const manager = new DefaultAssetManager(createResolver(), manualLoader.loader);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const asset = { id: 'late-texture', dispose: vi.fn() };

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
        const manager = new DefaultAssetManager(createResolver(), manualLoader.loader);
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');

        const failedLoad = manager.load(ref);
        manualLoader.rejectNext(loadFailure);
        await expect(failedLoad).rejects.toBe(loadFailure);

        const retriedLoad = manager.load(ref);
        manualLoader.resolveNext(asset);
        await expect(retriedLoad).resolves.toBe(asset);

        expect(manualLoader.calls).toEqual([
            'resolved://tactics/textures/grass.webp',
            'resolved://tactics/textures/grass.webp',
        ]);
        expect(manager.get(ref)).toBe(asset);
    });

    it('clears synchronous loader failures and allows retrying the same AssetRef', async () => {
        const asset = { id: 'grass-texture' };
        const loadFailure = new Error('texture decode failed');
        const load = vi
            .fn<AssetLoader['load']>()
            .mockImplementationOnce(() => {
                throw loadFailure;
            })
            .mockResolvedValueOnce(asset);
        const manager = new DefaultAssetManager(createResolver(), { load });
        const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');

        await expect(manager.load(ref)).rejects.toThrow('texture decode failed');
        await expect(manager.load(ref)).resolves.toBe(asset);

        expect(load).toHaveBeenCalledTimes(2);
        expect(manager.get(ref)).toBe(asset);
    });

    it('preloads only critical manifest entries and reports completion progress', async () => {
        const resolver = createResolver();
        const load = vi.fn(async (_url: string): Promise<ResolvedAsset> => ({ id: _url }));
        const manager = new DefaultAssetManager(resolver, { load });
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const deferredTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const progress: number[] = [];
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                { ref: criticalGrass, priority: 'critical' },
                { ref: deferredTree, priority: 'deferred' },
                { ref: criticalCursor, priority: 'critical' },
            ],
        };

        await manager.preloadCritical(manifest, (fraction) => progress.push(fraction));

        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenNthCalledWith(
            1,
            'resolved://tactics/textures/grass.webp',
            criticalGrass,
        );
        expect(load).toHaveBeenNthCalledWith(
            2,
            'resolved://tactics/textures/cursor.webp',
            criticalCursor,
        );
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
        const manager = new DefaultAssetManager(createResolver(), { load });
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                {
                    ref: buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp'),
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
        const manager = new DefaultAssetManager(createResolver(), { load });
        const textureRef = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const geometryRef = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');
        const audioRef = buildAssetRef<AudioClipAsset>('tactics', 'audio/audio-placeholder.ogg');

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
        const manager = new DefaultAssetManager(createResolver(), {
            async load(): Promise<ResolvedAsset> {
                return scene;
            },
        });
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/mesh-placeholder.glb');

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
});
