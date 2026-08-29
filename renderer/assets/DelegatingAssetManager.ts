import type { AssetKind, AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetManager, ResolvedAsset } from './AssetManager';

export interface DelegatingAssetManager extends AssetManager {
    setDelegate(manager: AssetManager | null): void;
    /**
     * Clear the delegate, but only while it is still `manager` — the teardown
     * half of a binding whose owner cannot assume it is still the current one.
     *
     * `setDelegate(null)` clears whatever is bound, which is what a match wants:
     * `GameShell` owns the binding for the whole life of a mount and nothing
     * else registers underneath it. A SHELL-scoped session has no such
     * guarantee. Its mount is driven by the shell-state store, so on a shell
     * surface → `/game` hop it tears down on a store update that lands after
     * the router's own commit — the commit in which `GameShell` already
     * registered the match manager, during render. An unconditional clear there
     * would silence the match it just handed over to.
     *
     * Releasing a manager that is not the bound one is a no-op, and no release
     * ever disposes: a manager's lifetime belongs to whoever built it
     * (Invariant #21).
     */
    releaseDelegate(manager: AssetManager): void;
}

/**
 * A load ran while nothing was registered with the app-level delegating
 * manager. Who registers, and for how long, is each registrant's own contract —
 * `GameShell` for a match and `ShellAudioSession` for the shell surfaces —
 * so this says only that none of them was bound.
 *
 * A surface can also miss this entirely by publishing a real manager over this
 * one for its own subtree (`GameAssetSession`, Invariant #21), which is a
 * different reach: that manager answers `useAsset` and its siblings, never the
 * app-level `AudioManager`.
 */
export class NoActiveGameSessionError extends Error {
    constructor(public readonly ref: string) {
        super(
            `No active game session: cannot load '${ref}'. No AssetManager delegate is ` +
                'registered with the app-level manager.',
        );
        this.name = 'NoActiveGameSessionError';
    }
}

class DefaultDelegatingAssetManager implements DelegatingAssetManager {
    private delegate: AssetManager | null = null;

    setDelegate(manager: AssetManager | null): void {
        this.delegate = manager;
    }

    releaseDelegate(manager: AssetManager): void {
        if (this.delegate === manager) {
            this.delegate = null;
        }
    }

    registerManifest(manifest: AssetManifest): void {
        this.delegate?.registerManifest(manifest);
    }

    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
        onEntryFailure?: (ref: AssetRef, error: unknown) => void,
    ): Promise<void> {
        return (
            this.delegate?.preloadCritical(manifest, onProgress, onEntryFailure) ??
            Promise.resolve()
        );
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
        // Clear the delegate reference but do not dispose it — a registered
        // manager's lifetime is its registrant's, never this wrapper's.
        this.delegate = null;
    }
}

export function createDelegatingAssetManager(): DelegatingAssetManager {
    return new DefaultDelegatingAssetManager();
}
