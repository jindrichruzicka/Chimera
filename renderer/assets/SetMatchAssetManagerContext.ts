'use client';

import { createContext } from 'react';

import type { AssetManager } from '../assets/AssetManager';

/**
 * Callback context that allows GameShell to register its match-level AssetManager
 * with the app-level DelegatingAssetManager so the AudioManager (owned by Providers)
 * can load match-specific audio assets.
 *
 * Provided by: renderer/app/providers.tsx
 * Consumed by: renderer/components/shell/GameShell.tsx (useMatchAssetManager)
 *
 * Invariant #64 / §4.25: AudioManager lifecycle owned by Providers; match AssetManager
 * lifecycle owned by GameShell. This context is the handshake between them.
 */
export const SetMatchAssetManagerContext = createContext<
    ((manager: AssetManager | null) => void) | null
>(null);
