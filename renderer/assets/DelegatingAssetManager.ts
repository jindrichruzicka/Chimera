import type { AssetKind, AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetManager, ResolvedAsset } from './AssetManager';

export interface DelegatingAssetManager extends AssetManager {
    setDelegate(manager: AssetManager | null): void;
}

class DefaultDelegatingAssetManager implements DelegatingAssetManager {
    private delegate: AssetManager | null = null;

    setDelegate(manager: AssetManager | null): void {
        this.delegate = manager;
    }

    registerManifest(manifest: AssetManifest): void {
        this.delegate?.registerManifest(manifest);
    }

    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
    ): Promise<void> {
        return this.delegate?.preloadCritical(manifest, onProgress) ?? Promise.resolve();
    }

    get<TAssetKind extends AssetKind>(ref: AssetRef<TAssetKind>): ResolvedAsset<TAssetKind> | null {
        return this.delegate?.get(ref) ?? null;
    }

    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        if (this.delegate === null) {
            return Promise.reject(
                new Error(
                    `AssetManager delegate not set; no active match. Cannot load '${String(ref)}'.`,
                ),
            );
        }
        return this.delegate.load(ref);
    }

    dispose(): void {
        // Clear the delegate reference but do not dispose it — the match-level
        // AssetManager lifecycle is owned by GameShell, not by this delegating wrapper.
        this.delegate = null;
    }
}

export function createDelegatingAssetManager(): DelegatingAssetManager {
    return new DefaultDelegatingAssetManager();
}
