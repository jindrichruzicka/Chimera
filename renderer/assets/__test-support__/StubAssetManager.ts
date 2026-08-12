// renderer/assets/__test-support__/StubAssetManager.ts
//
// An `AssetManager` whose per-ref load outcome the test chooses, for specs that
// are about what a CALLER does with a load — when it starts one, when it
// abandons one, what it reports while one is outstanding — rather than about
// how the manager resolves it.
//
// `'deferred'` is the seam the timing cases need: a ref that stays outstanding
// until the test lands it, so "the run settled AFTER the caller moved on" is a
// deterministic sequence rather than a race.
//
// Specs about the manager's own behaviour (cache retention, manifest
// equivalence, eviction) must use the real `DefaultAssetManager` instead — a
// double there would only assert against itself.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type {
    AssetKind,
    AssetRef,
    TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../AssetManager.js';

export type StubLoadOutcome = 'resolve' | 'reject' | 'hang' | 'deferred';

export interface StubAssetManager extends AssetManager {
    /** Every manifest handed to `registerManifest`, in order. */
    readonly registered: AssetManifest[];
    /** Lands a `'deferred'` ref. A no-op for any other ref. */
    settleDeferred(ref: AssetRef): void;
}

/** A texture ref, the kind-agnostic default for specs that never read the value. */
export function textureRef(name: string): AssetRef<TextureAsset> {
    return `tactics/textures/${name}.png` as AssetRef<TextureAsset>;
}

export function stubManifest(
    refs: readonly AssetRef<TextureAsset>[],
    gameId = 'tactics',
): AssetManifest {
    return {
        gameId,
        entries: refs.map((ref) => ({ ref, kind: 'texture', priority: 'deferred' as const })),
    };
}

export function createStubAssetManager(
    outcomes: Readonly<Record<string, StubLoadOutcome>> = {},
): StubAssetManager {
    const registered: AssetManifest[] = [];
    const deferred = new Map<string, () => void>();

    return {
        registered,
        registerManifest: (manifest) => {
            registered.push(manifest);
        },
        preloadCritical: () => Promise.resolve(),
        get: () => null,
        load: <TAssetKind extends AssetKind>(
            ref: AssetRef<TAssetKind>,
        ): Promise<ResolvedAsset<TAssetKind>> => {
            const outcome = outcomes[String(ref)] ?? 'resolve';
            if (outcome === 'reject') {
                return Promise.reject(new Error(`load failed: ${String(ref)}`));
            }
            if (outcome === 'hang') {
                return new Promise<ResolvedAsset<TAssetKind>>(() => undefined);
            }
            if (outcome === 'deferred') {
                return new Promise<ResolvedAsset<TAssetKind>>((resolve) => {
                    deferred.set(String(ref), () => {
                        resolve({} as ResolvedAsset<TAssetKind>);
                    });
                });
            }
            return Promise.resolve({} as ResolvedAsset<TAssetKind>);
        },
        getManifestMetadata: () => undefined,
        dispose: () => undefined,
        settleDeferred: (ref) => {
            deferred.get(String(ref))?.();
        },
    };
}
