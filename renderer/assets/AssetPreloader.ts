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
        // Guarded here as well as inside the manager, on every call. The
        // terminal `1` is this wrapper's own — made after the run resolved, so
        // no manager guard covers it, and unguarded it rejects a preload in
        // which every ref loaded. The two FORWARDED ones run inside whichever
        // `AssetManager` this wrapper was handed, and that is an interface a
        // game can implement: `DefaultAssetManager` guards its own dispatches,
        // another implementation need not. Swallowed per call: a
        // reporter that breaks once still hears the rest of the run.
        const report = (fraction: number): void => {
            try {
                onProgress?.(fraction);
            } catch {
                // Intentionally swallowed; see above.
            }
        };

        // One call site, not one per callback shape: a second would let a
        // forwarded argument be dropped from the branch no caller exercises and
        // stay green. Each forward stays conditional so a manager can still
        // tell "no reporter registered" from "one that does nothing" — the
        // wrapper never synthesises a callback its caller did not pass. The
        // manager's terminal `1` is filtered out so the `1` below is this
        // wrapper's own, reported only once the run resolved.
        await this.assetManager.preloadCritical(
            manifest,
            onProgress === undefined
                ? undefined
                : (fraction) => {
                      if (fraction < 1) {
                          report(fraction);
                      }
                  },
            onEntryFailure === undefined
                ? undefined
                : (ref, error) => {
                      try {
                          onEntryFailure(ref, error);
                      } catch {
                          // Intentionally swallowed; see above.
                      }
                  },
        );
        report(1);
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
