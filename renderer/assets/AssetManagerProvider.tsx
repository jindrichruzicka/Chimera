'use client';

import React from 'react';

import type { AssetManager } from './AssetManager';
import { AssetManagerContext } from './AssetManagerContext.js';

export interface AssetManagerProviderProps {
    readonly assetManager: AssetManager;
    readonly children: React.ReactNode;
}

/**
 * Publishes an {@link AssetManager} to `useAssetManager()` consumers.
 *
 * The app root mounts the one live provider (`renderer/app/providers.tsx`,
 * publishing the app-level delegating manager) and `GameShell` is the unique
 * disposer of the match-level manager (Invariant #21) — this component only
 * publishes, it never constructs or disposes. A game mounts its own only over
 * a double, whose lifetime the game owns.
 *
 * It exists as a component rather than a bare exported context because it is
 * part of the public `@chimera-engine/renderer/assets` barrel: an adopting
 * game's tests have to mount whatever satisfies `useAssetManager()`,
 * `useAsset()`, or `useModelInstance()`, and shipping a provider keeps the
 * context object itself internal — the same shape as `AudioManagerProvider`
 * and `<I18nProvider>`. Nothing here weakens the throwing-hook contract of
 * Invariant #83: outside a provider `useAssetManager()` still throws.
 */
export function AssetManagerProvider({
    assetManager,
    children,
}: AssetManagerProviderProps): React.ReactElement {
    return (
        <AssetManagerContext.Provider value={assetManager}>{children}</AssetManagerContext.Provider>
    );
}
