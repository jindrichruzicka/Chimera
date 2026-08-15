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
            getManifestMetadata(): unknown {
                return undefined;
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

    it('forwards the per-entry failure channel alongside progress', async () => {
        // Both callbacks in ONE call, because the wrapper builds its progress
        // filter conditionally: an argument dropped here reaches the manager as
        // `undefined` and the caller's report goes silent while the run still
        // resolves the same way.
        const failingRef = buildAssetRef<TextureAsset>('tactics', 'textures/broken.webp');
        const load = vi.fn(async (): Promise<ResolvedAsset> => {
            throw new Error('texture 404');
        });
        const assetManager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const progress: number[] = [];
        const failed: string[] = [];

        await new AssetPreloader(assetManager)
            .preloadCritical(
                createManifest([createTextureEntry(failingRef, 'critical')]),
                (fraction) => progress.push(fraction),
                (ref) => failed.push(String(ref)),
            )
            .catch(() => undefined);

        expect(failed).toEqual([String(failingRef)]);
        // And the wrapper's own terminal `1` is NOT reported for a run that
        // rejected — the manager's `1` is filtered and the trailing call is
        // never reached.
        expect(progress).toEqual([]);
    });

    it("resolves a successful run whose caller throws on the wrapper's own terminal report", async () => {
        // The terminal `1` is this wrapper's own call, made after the manager
        // resolved, so no guard inside the manager covers it: unguarded, a run
        // in which every critical ref loaded rejects with the caller's error.
        // The callback throws ONLY on `1`, so the manager-side guard is not what
        // this case exercises.
        const load = vi.fn(
            async (request: AssetLoadRequest): Promise<ResolvedAsset> => ({ id: request.url }),
        );
        const assetManager = new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        );
        const criticalGrass = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');
        const criticalCursor = buildAssetRef<TextureAsset>('tactics', 'textures/cursor.webp');
        const progress: number[] = [];

        const rejection = await new AssetPreloader(assetManager)
            .preloadCritical(
                createManifest([
                    createTextureEntry(criticalGrass, 'critical'),
                    createTextureEntry(criticalCursor, 'critical'),
                ]),
                (fraction) => {
                    progress.push(fraction);
                    if (fraction === 1) {
                        throw new Error('cover blew up');
                    }
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(load).toHaveBeenCalledTimes(2);
        expect(progress).toEqual([0.5, 1]);
        expect(rejection).toBeNull();
    });

    it('resolves when a manager reports progress unguarded and the caller throws on it', async () => {
        // The filtered forward runs INSIDE the manager, so this wrapper is only
        // as safe as the manager it was handed. `AssetManager` is an interface a
        // game can implement, so the guard lives here too — this manager double
        // calls the forwarded callback with no guard of its own, and the caller
        // throws only on the fraction it forwards.
        const manager: AssetManager = {
            registerManifest: vi.fn(),
            async preloadCritical(_manifest, onProgress): Promise<void> {
                onProgress?.(0.5);
                onProgress?.(1);
            },
            get(): null {
                return null;
            },
            getManifestMetadata(): unknown {
                return undefined;
            },
            async load(): Promise<never> {
                throw new Error('AssetPreloader should not load assets directly.');
            },
            dispose: vi.fn(),
        };
        const progress: number[] = [];

        const rejection = await new AssetPreloader(manager)
            .preloadCritical(
                createManifest([
                    createTextureEntry(
                        buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp'),
                        'critical',
                    ),
                ]),
                (fraction) => {
                    progress.push(fraction);
                    if (fraction < 1) {
                        throw new Error('cover blew up');
                    }
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(rejection).toBeNull();
        // The terminal report still happens: the guard swallows one call, it
        // does not abandon the rest of the wrapper's work.
        expect(progress).toEqual([0.5, 1]);
    });

    it('resolves when a manager dispatches an entry failure unguarded and the caller throws on it', async () => {
        // Same premise as the forwarded progress case above, on the channel
        // beside it: `onEntryFailure` runs inside whichever `AssetManager` this
        // wrapper was handed, and `AssetManager` is an interface a game can
        // implement. `DefaultAssetManager` guards its own dispatch, so this
        // double — which does not — is what makes the wrapper's guard the only
        // thing between a throwing reporter and the run.
        const failingRef = buildAssetRef<TextureAsset>('tactics', 'textures/broken.webp');
        const manager: AssetManager = {
            registerManifest: vi.fn(),
            async preloadCritical(_manifest, onProgress, onEntryFailure): Promise<void> {
                onEntryFailure?.(failingRef, new Error('texture 404'));
                onProgress?.(0.5);
            },
            get(): null {
                return null;
            },
            getManifestMetadata(): unknown {
                return undefined;
            },
            async load(): Promise<never> {
                throw new Error('AssetPreloader should not load assets directly.');
            },
            dispose: vi.fn(),
        };
        const progress: number[] = [];
        const failed: string[] = [];

        const rejection = await new AssetPreloader(manager)
            .preloadCritical(
                createManifest([createTextureEntry(failingRef, 'critical')]),
                (fraction) => progress.push(fraction),
                (ref) => {
                    failed.push(String(ref));
                    throw new Error('reporter blew up');
                },
            )
            .then(
                () => null,
                (error: unknown) => error,
            );

        expect(failed).toEqual([String(failingRef)]);
        expect(rejection).toBeNull();
        // The guard swallows one call; it does not abandon the rest of the run.
        // Unguarded, the throw unwinds the manager and both of these are lost.
        expect(progress).toEqual([0.5, 1]);
    });

    it('hands the manager neither channel when the caller registered neither', async () => {
        // Both forwards are conditional so a manager can still tell "no
        // reporter registered" from "one that does nothing" — synthesising a
        // callback the caller never passed is a behaviour change on an
        // interface a game implements.
        const received: { onProgress: unknown; onEntryFailure: unknown }[] = [];
        const manager: AssetManager = {
            registerManifest: vi.fn(),
            async preloadCritical(_manifest, onProgress, onEntryFailure): Promise<void> {
                received.push({ onProgress, onEntryFailure });
            },
            get(): null {
                return null;
            },
            getManifestMetadata(): unknown {
                return undefined;
            },
            async load(): Promise<never> {
                throw new Error('AssetPreloader should not load assets directly.');
            },
            dispose: vi.fn(),
        };

        await new AssetPreloader(manager).preloadCritical(
            createManifest([
                createTextureEntry(
                    buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp'),
                    'critical',
                ),
            ]),
        );

        expect(received).toHaveLength(1);
        expect(received[0]?.onProgress).toBeUndefined();
        expect(received[0]?.onEntryFailure).toBeUndefined();
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
