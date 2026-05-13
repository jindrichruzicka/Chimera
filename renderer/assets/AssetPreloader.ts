import type { AssetRef } from '@chimera/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera/simulation/content/AssetManifest.js';

import type { AssetManager } from './AssetManager';

export type AssetPreloadProgress = (fraction: number) => void;

export class AssetPreloader {
    constructor(private readonly assetManager: AssetManager) {}

    async preloadCritical(
        manifest: AssetManifest,
        onProgress?: AssetPreloadProgress,
    ): Promise<void> {
        if (onProgress === undefined) {
            await this.assetManager.preloadCritical(manifest);
            return;
        }

        await this.assetManager.preloadCritical(manifest, (fraction) => {
            if (fraction < 1) {
                onProgress(fraction);
            }
        });
        onProgress(1);
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
