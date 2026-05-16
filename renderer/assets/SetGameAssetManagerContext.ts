'use client';

import { createContext } from 'react';

import type { AssetManager } from '../assets/AssetManager';

/**
 * Callback context that allows GameShell to register its game-level AssetManager
 * with the app-level DelegatingAssetManager so the AudioManager (owned by Providers)
 * can load game-specific audio assets.
 *
 * Provided by: renderer/app/providers.tsx
 * Consumed by: renderer/components/shell/GameShell.tsx (useGameAssetManager)
 *
 * Invariant #64 / §4.25: AudioManager lifecycle owned by Providers; game AssetManager
 * lifecycle owned by GameShell. This context is the handshake between them.
 */
export const SetGameAssetManagerContext = createContext<
    ((manager: AssetManager | null) => void) | null
>(null);
