import { describe, expect, it, vi } from 'vitest';

import {
    type AssetRef,
    buildAssetRef,
    type TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';
import { createAssetLoaderRegistry, type AssetLoadRequest } from './AssetLoaderRegistry';
import { DefaultAssetManager, type AssetManager, type ResolvedAsset } from './AssetManager';
import { AssetPreloader, markRequiredAssetsCritical } from './AssetPreloader';

function createResolver(): AssetResolver {
    return {
        resolve(ref): string {
            return `resolved://${ref}`;
        },
    };
}

function createTextureEntry(
    ref: AssetRef<TextureAsset>,
    priority: AssetManifestEntry<TextureAsset>['priority'],
): AssetManifestEntry<TextureAsset> {
    return { ref, kind: 'texture', priority };
}

function createManifest(entries: readonly AssetManifestEntry[]): AssetManifest {
    return { gameId: 'tactics', entries };
}

function createDeferredPromise(): {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
} {
    let resolveDeferred: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
        resolveDeferred = resolve;
    });

    return {
        promise,
        resolve(): void {
            resolveDeferred?.();
        },
    };
}

describe('AssetPreloader', () => {
    it('reports progress for resolved critical assets, resolves after completion, and skips deferred entries', async () => {
        const load = vi.fn(
            async (request: AssetLoadRequest): Promise<ResolvedAsset> => ({
                id: request.url,
            }),
        );
        const assetManager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const deferredTree = buildAssetRef<TextureAsset>('tactics', 'textures/tree.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const progress: number[] = [];
        const manifest = createManifest([
            createTextureEntry(criticalGrass, 'critical'),
            createTextureEntry(deferredTree, 'deferred'),
            createTextureEntry(criticalCursor, 'critical'),
        ]);

        await new AssetPreloader(assetManager).preloadCritical(manifest, (fraction) => {
            progress.push(fraction);
        });

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
        expect(assetManager.get(deferredTree)).toBeNull();
    });

    it('waits for preloadCritical to finish before reporting final progress', async () => {
        const completion = createDeferredPromise();
        const progress: number[] = [];
        const events: string[] = [];
        const manager: AssetManager = {
            registerManifest: vi.fn(),
            async preloadCritical(_manifest, onProgress): Promise<void> {
                onProgress?.(0.5);
                onProgress?.(1);
                events.push('manager-progress-complete');
                await completion.promise;
                events.push('manager-resolved');
            },
            get(): null {
                return null;
            },
            async load(): Promise<never> {
                throw new Error('AssetPreloader should not load assets directly.');
            },
            dispose: vi.fn(),
        };
        const manifest = createManifest([
            createTextureEntry(
                buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp'),
                'critical',
            ),
            createTextureEntry(
                buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp'),
                'critical',
            ),
        ]);

        const preload = new AssetPreloader(manager).preloadCritical(manifest, (fraction) => {
            progress.push(fraction);
            events.push(`progress:${fraction}`);
        });

        expect(progress).toEqual([0.5]);
        expect(events).toEqual(['progress:0.5', 'manager-progress-complete']);

        completion.resolve();
        await preload;

        expect(progress).toEqual([0.5, 1]);
        expect(events).toEqual([
            'progress:0.5',
            'manager-progress-complete',
            'manager-resolved',
            'progress:1',
        ]);
    });

    it('can preload SceneDescriptor.requiredAssets refs by promoting matching manifest entries to critical priority', async () => {
        const load = vi.fn(
            async (request: AssetLoadRequest): Promise<ResolvedAsset> => ({
                id: request.ref,
            }),
        );
        const assetManager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const requiredBackdrop = buildAssetRef<TextureAsset>('tactics', 'textures/backdrop.webp');
        const deferredDecoration = buildAssetRef<TextureAsset>(
            'tactics',
            'textures/deferred-decoration.webp',
        );
        const requiredAssets: readonly AssetRef[] = [requiredBackdrop];
        const sceneManifest = markRequiredAssetsCritical(
            createManifest([
                createTextureEntry(requiredBackdrop, 'deferred'),
                createTextureEntry(deferredDecoration, 'deferred'),
            ]),
            requiredAssets,
        );

        await new AssetPreloader(assetManager).preloadCritical(sceneManifest);

        expect(sceneManifest.entries).toEqual([
            createTextureEntry(requiredBackdrop, 'critical'),
            createTextureEntry(deferredDecoration, 'deferred'),
        ]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith({
            ref: requiredBackdrop,
            kind: 'texture',
            url: 'resolved://tactics/textures/backdrop.webp',
        });
        expect(assetManager.get(requiredBackdrop)).toEqual({ id: requiredBackdrop });
        expect(assetManager.get(deferredDecoration)).toBeNull();
    });

    it('silently ignores requiredAssets refs that are absent from the manifest', () => {
        const presentRef = buildAssetRef<TextureAsset>('tactics', 'textures/backdrop.webp');
        const absentRef = buildAssetRef<TextureAsset>('tactics', 'textures/ghost.webp');

        const result = markRequiredAssetsCritical(
            createManifest([createTextureEntry(presentRef, 'deferred')]),
            [presentRef, absentRef],
        );

        expect(result.entries).toEqual([createTextureEntry(presentRef, 'critical')]);
    });

    it('calls onProgress(1) immediately and skips loading when manifest has no critical entries', async () => {
        const load = vi.fn();
        const assetManager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const progress: number[] = [];
        const manifest = createManifest([
            createTextureEntry(
                buildAssetRef<TextureAsset>('tactics', 'textures/deferred.webp'),
                'deferred',
            ),
        ]);

        await new AssetPreloader(assetManager).preloadCritical(manifest, (fraction) => {
            progress.push(fraction);
        });

        expect(load).not.toHaveBeenCalled();
        expect(progress).toEqual([1]);
    });
});
