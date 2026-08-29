'use client';

import { createContext, useContext } from 'react';

import type { AssetManager } from '../assets/AssetManager';

/**
 * The two halves of the app-level delegate binding, published as ONE object so a
 * registrant cannot reach the register verb without the release verb that pairs
 * with it.
 *
 * `set` replaces whatever is bound; `release` clears only while the caller is
 * still the bound one. Which verb a teardown wants is decided by whether its
 * owner can outlive the binding — see `DelegatingAssetManager.releaseDelegate`
 * for the shell → match hop that makes the distinction load-bearing.
 */
export interface GameAssetManagerBinding {
    readonly set: (manager: AssetManager | null) => void;
    readonly release: (manager: AssetManager) => void;
}

/**
 * Callback context that allows a renderer surface to register its game-level
 * AssetManager with the app-level DelegatingAssetManager so the AudioManager
 * (owned by Providers) can load game-specific audio assets.
 *
 * Provided by: renderer/app/providers.tsx
 * Consumed by: renderer/components/shell/GameShell.tsx (useGameAssetManager) for
 * a match, and renderer/components/shell/ShellAudioSession.tsx for the
 * shell-scoped session outside one.
 *
 * Invariant #64 / §4.25: AudioManager lifecycle owned by Providers; game AssetManager
 * lifecycle owned by whoever built it. This context is the handshake between them.
 */
export const SetGameAssetManagerContext = createContext<GameAssetManagerBinding | null>(null);

export function useSetGameAssetManager(): (manager: AssetManager | null) => void {
    const binding = useContext(SetGameAssetManagerContext);
    if (binding === null) {
        throw new Error(
            'useSetGameAssetManager() must be used within the app root (inside <Providers>).',
        );
    }

    return binding.set;
}

export function useReleaseGameAssetManager(): (manager: AssetManager) => void {
    const binding = useContext(SetGameAssetManagerContext);
    if (binding === null) {
        throw new Error(
            'useReleaseGameAssetManager() must be used within the app root (inside <Providers>).',
        );
    }

    return binding.release;
}
