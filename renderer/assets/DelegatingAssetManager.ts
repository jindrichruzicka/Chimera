import type { AssetKind, AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetManager, ResolvedAsset } from './AssetManager';

export interface DelegatingAssetManager extends AssetManager {
    setDelegate(manager: AssetManager | null): void;
}

/**
 * A load ran while no match-level manager was registered with the app-level
 * delegating manager — i.e. outside an active game session. `GameShell`
 * registers the delegate while a match is mounted, so surfaces above it (an
 * `apps/<name>/shell/*.tsx` contribution, Invariant #96) hit this whenever
 * they load before a match starts or after it ends.
 */
export class NoActiveGameSessionError extends Error {
    constructor(public readonly ref: string) {
        super(
            `No active game session: cannot load '${ref}'. The AssetManager delegate is ` +
                'registered by GameShell while a match is mounted; above GameShell, loads ' +
                'resolve only during an active match.',
        );
        this.name = 'NoActiveGameSessionError';
    }
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

    getManifestMetadata(ref: AssetRef): unknown {
        return this.delegate?.getManifestMetadata(ref);
    }

    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        if (this.delegate === null) {
            return Promise.reject(new NoActiveGameSessionError(String(ref)));
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
