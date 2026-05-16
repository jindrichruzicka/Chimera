'use client';

import React, { type ReactNode } from 'react';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';

import type { AssetManager } from '../assets/AssetManager';
import { AssetManagerContext } from '../assets/AssetManagerContext.js';
import { createDelegatingAssetManager } from '../assets/DelegatingAssetManager';
import { SetGameAssetManagerContext } from '../assets/SetGameAssetManagerContext';
import { createAudioManager, type AudioHandle, type AudioManager } from '../audio/AudioManager';
import { AudioManagerContext } from '../audio/AudioManagerContext.js';

export interface ProvidersProps {
    readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): React.ReactElement {
    // DelegatingAssetManager forwards load/get/registerManifest calls to whatever
    // game-level AssetManager GameShell registers via SetGameAssetManagerContext.
    // This allows the app-level AudioManager to load game-specific audio assets
    // without owning the game AssetManager lifecycle.
    const delegatingAssetManager = React.useMemo(() => createDelegatingAssetManager(), []);
    const audioManager = React.useMemo(
        () => createAudioManagerForEnvironment(delegatingAssetManager),
        [delegatingAssetManager],
    );

    React.useEffect(() => {
        return () => {
            audioManager.dispose();
            delegatingAssetManager.dispose();
        };
    }, [audioManager, delegatingAssetManager]);

    const setGameAssetManager = React.useCallback(
        (manager: AssetManager | null) => {
            delegatingAssetManager.setDelegate(manager);
        },
        [delegatingAssetManager],
    );

    return (
        <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
            <AssetManagerContext.Provider value={delegatingAssetManager}>
                <AudioManagerContext.Provider value={audioManager}>
                    {children}
                </AudioManagerContext.Provider>
            </AssetManagerContext.Provider>
        </SetGameAssetManagerContext.Provider>
    );
}

function createAudioManagerForEnvironment(assetManager: AssetManager): AudioManager {
    try {
        return createAudioManager(assetManager);
    } catch (error) {
        console.warn(
            '[Providers] AudioManager initialization failed; using noop audio manager.',
            error,
        );
        return createNoopAudioManager();
    }
}

function createNoopAudioManager(): AudioManager {
    return {
        play(ref: AssetRef<AudioClipAsset>, opts = {}): AudioHandle {
            return {
                id: 'noop-audio-handle',
                ref,
                bus: opts.bus ?? 'sfx',
                priority: opts.priority ?? 0,
                valid: false,
            };
        },
        stop(): void {
            return;
        },
        stopAll(): void {
            return;
        },
        duck(): void {
            return;
        },
        dispose(): void {
            return;
        },
    };
}
