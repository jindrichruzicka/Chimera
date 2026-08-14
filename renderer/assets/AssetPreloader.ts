import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetManager } from './AssetManager';

export type AssetPreloadProgress = (fraction: number) => void;

export class AssetPreloader {
    constructor(private readonly assetManager: AssetManager) {}

    async preloadCritical(
        manifest: AssetManifest,
        onProgress?: AssetPreloadProgress,
        onEntryFailure?: (ref: AssetRef, error: unknown) => void,
    ): Promise<void> {
        // One call site, not one per callback shape: a second would let a
        // forwarded argument be dropped from the branch no caller exercises and
        // stay green. The manager's terminal `1` is filtered out so the `1`
        // below is this wrapper's own, reported only once the run resolved.
        await this.assetManager.preloadCritical(
            manifest,
            onProgress === undefined
                ? undefined
                : (fraction) => {
                      if (fraction < 1) {
                          onProgress(fraction);
                      }
                  },
            onEntryFailure,
        );
        onProgress?.(1);
    }
}

/**
 * Promotes SceneDescriptor.requiredAssets refs to critical priority while
 * preserving the full manifest registration surface for AssetManager.
 */
export function markRequiredAssetsCritical(
    manifest: AssetManifest,
    requiredAssets: readonly AssetRef[],
): AssetManifest {
    const requiredRefs = new Set<string>(requiredAssets);
    return {
        gameId: manifest.gameId,
        entries: manifest.entries.map((entry) =>
            markEntryCriticalWhenRequired(entry, requiredRefs),
        ),
    };
}

function markEntryCriticalWhenRequired(
    entry: AssetManifestEntry,
    requiredRefs: ReadonlySet<string>,
): AssetManifestEntry {
    if (!requiredRefs.has(entry.ref) || entry.priority === 'critical') {
        return entry;
    }

    return { ...entry, priority: 'critical' };
}
