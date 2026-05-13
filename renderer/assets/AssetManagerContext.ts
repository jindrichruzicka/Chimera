'use client';

import { createContext, useContext } from 'react';

import type { AssetManager } from './AssetManager';

export const AssetManagerContext = createContext<AssetManager | null>(null);

export function useAssetManager(): AssetManager {
    const assetManager = useContext(AssetManagerContext);
    if (assetManager === null) {
        throw new Error('useAssetManager must be used inside AssetManagerContext.Provider');
    }

    return assetManager;
}
