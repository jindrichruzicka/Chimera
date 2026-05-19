'use client';

import React, { type ReactNode } from 'react';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';

import type { AssetManager } from '../assets/AssetManager';
import { AssetManagerContext } from '../assets/AssetManagerContext.js';
import { createDelegatingAssetManager } from '../assets/DelegatingAssetManager';
import { SetGameAssetManagerContext } from '../assets/SetGameAssetManagerContext';
import { createAudioManager, type AudioHandle, type AudioManager } from '../audio/AudioManager';
import { AudioManagerContext } from '../audio/AudioManagerContext.js';
import type { InputAction } from '../input/InputAction.js';
import { createInputManager } from '../input/InputManager.js';
import { createInputActionRegistry } from '../input/InputActionRegistry.js';
import { InputActionRegistryContext } from '../input/InputActionRegistryContext.js';
import { createKeyBindingRepository } from '../input/KeyBindingRepository.js';
import { InputManagerContext } from '../input/InputManagerContext.js';
import { DeviceInfoProvider, type DeviceInfoSystemApi } from '../device/DeviceInfoProvider.js';

const ENGINE_INPUT_ACTIONS: readonly InputAction[] = [
    { id: 'engine:undo', description: 'Undo last action', category: 'Engine', oneShot: true },
    {
        id: 'engine:redo',
        description: 'Redo last undone action',
        category: 'Engine',
        oneShot: true,
    },
    {
        id: 'engine:toggle-menu',
        description: 'Toggle game menu',
        category: 'Engine',
        oneShot: true,
    },
    {
        id: 'engine:toggle-perf-hud',
        description: 'Toggle performance HUD',
        category: 'Engine',
        oneShot: true,
    },
];

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

    const inputRegistry = React.useMemo(() => createInputActionRegistry(ENGINE_INPUT_ACTIONS), []);
    const inputBindings = React.useMemo(() => createKeyBindingRepository(), []);
    const inputManager = React.useMemo(
        () => createInputManager(inputRegistry, inputBindings),
        [inputRegistry, inputBindings],
    );

    React.useEffect(() => {
        return () => {
            audioManager.dispose();
            delegatingAssetManager.dispose();
        };
    }, [audioManager, delegatingAssetManager]);

    React.useEffect(() => {
        inputManager.start();
        return () => {
            inputManager.stop();
        };
        // §4.26: the Providers-owned InputManager is an app-lifetime singleton.
    }, []);

    const setGameAssetManager = React.useCallback(
        (manager: AssetManager | null) => {
            delegatingAssetManager.setDelegate(manager);
        },
        [delegatingAssetManager],
    );

    const systemApi = resolveDeviceInfoSystemApi();

    return (
        <DeviceInfoProvider systemApi={systemApi}>
            <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
                <AssetManagerContext.Provider value={delegatingAssetManager}>
                    <AudioManagerContext.Provider value={audioManager}>
                        <InputActionRegistryContext.Provider value={inputRegistry}>
                            <InputManagerContext.Provider value={inputManager}>
                                {children}
                            </InputManagerContext.Provider>
                        </InputActionRegistryContext.Provider>
                    </AudioManagerContext.Provider>
                </AssetManagerContext.Provider>
            </SetGameAssetManagerContext.Provider>
        </DeviceInfoProvider>
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

function resolveDeviceInfoSystemApi(): DeviceInfoSystemApi | null {
    if (typeof window === 'undefined') return null;
    const chimera = window.__chimera as Window['__chimera'] | undefined;
    return chimera?.system ?? null;
}
