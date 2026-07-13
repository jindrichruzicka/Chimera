// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetManager } from '../assets/AssetManager';
import { useAssetManager } from '../assets/AssetManagerContext.js';
import type { DelegatingAssetManager } from '../assets/DelegatingAssetManager';
import { DeviceInfoProvider } from '../device/DeviceInfoProvider.js';
import { SetGameAssetManagerContext } from '../assets/SetGameAssetManagerContext';
import type { AudioManager } from '../audio/AudioManager';
import { useAudioManager } from '../audio/AudioManagerContext.js';
import type { InputAction } from '../input/InputAction.js';
import type { InputManager } from '../input/InputManager.js';
import { useInputManager } from '../input/InputManagerContext.js';
import { Providers } from './providers';

const providerMocks = vi.hoisted(() => {
    const delegatingAssetManager = {
        registerManifest: vi.fn(),
        preloadCritical: vi.fn(async () => undefined),
        get: vi.fn(() => null),
        load: vi.fn(async () => {
            throw new Error('unused delegating asset manager mock');
        }),
        dispose: vi.fn(),
        setDelegate: vi.fn(),
    };
    const audioManager = {
        play: vi.fn(() => ({
            id: 'audio-handle',
            ref: 'tactics/audio/sfx/test.ogg',
            bus: 'sfx',
            priority: 0,
            valid: true,
        })),
        stop: vi.fn(),
        stopAll: vi.fn(),
        duck: vi.fn(),
        dispose: vi.fn(),
    };
    const inputManager = {
        start: vi.fn(),
        stop: vi.fn(),
        isPressed: vi.fn().mockReturnValue(false),
        onAction: vi.fn(() => vi.fn()),
        setActiveCategory: vi.fn(),
        rebind: vi.fn().mockResolvedValue({ ok: true }),
        pollGamepad: vi.fn(),
        getActions: vi.fn(() => []),
        getBinding: vi.fn(() => undefined),
        resetBinding: vi.fn().mockResolvedValue(undefined),
    };

    return {
        delegatingAssetManager,
        audioManager,
        inputManager,
        createDelegatingAssetManager: vi.fn(() => delegatingAssetManager),
        createAudioManager: vi.fn(() => audioManager),
        createInputManager: vi.fn(() => inputManager),
        createInputActionRegistry: vi.fn(() => ({
            register: vi.fn(),
            get: vi.fn(),
            has: vi.fn(),
            getAll: vi.fn(() => []),
        })),
        createKeyBindingRepository: vi.fn(() => ({
            getAll: vi.fn(() => ({})),
            get: vi.fn(),
            save: vi.fn(),
            reset: vi.fn().mockResolvedValue(undefined),
        })),
    };
});

vi.mock('../assets/DelegatingAssetManager', () => ({
    createDelegatingAssetManager: providerMocks.createDelegatingAssetManager,
}));

vi.mock('../audio/AudioManager', () => ({
    createAudioManager: providerMocks.createAudioManager,
}));

vi.mock('../input/InputManager.js', () => ({
    createInputManager: providerMocks.createInputManager,
}));

vi.mock('../input/InputActionRegistry.js', () => ({
    createInputActionRegistry: providerMocks.createInputActionRegistry,
}));

vi.mock('../input/KeyBindingRepository.js', () => ({
    createKeyBindingRepository: providerMocks.createKeyBindingRepository,
}));

// Mock DeviceInfoProvider so tests don't need window.__chimera.system.
// Detailed DeviceInfoProvider behaviour is covered by renderer/device/DeviceInfoProvider.test.tsx.
vi.mock('../device/DeviceInfoProvider.js', async () => {
    const { createElement, Fragment, createContext } = await import('react');
    return {
        DeviceInfoProvider: vi.fn(({ children }: { children: React.ReactNode }) =>
            createElement(Fragment, null, children),
        ),
        DeviceInfoContext: createContext(null),
    };
});

beforeEach(() => {
    providerMocks.createDelegatingAssetManager.mockClear();
    providerMocks.createAudioManager.mockClear();
    providerMocks.createInputManager.mockClear();
    providerMocks.createInputActionRegistry.mockClear();
    providerMocks.createKeyBindingRepository.mockClear();
    providerMocks.delegatingAssetManager.dispose.mockClear();
    providerMocks.delegatingAssetManager.setDelegate.mockClear();
    providerMocks.audioManager.dispose.mockClear();
    providerMocks.inputManager.start.mockClear();
    providerMocks.inputManager.stop.mockClear();
    vi.mocked(DeviceInfoProvider).mockClear();

    // Provide a minimal window.__chimera stub so <Providers> can evaluate
    // systemApi={window.__chimera.system} during rendering.
    (window as any).__chimera = {
        system: {
            getDeviceInfo: vi.fn().mockResolvedValue(null),
            onDeviceInfoChange: vi.fn().mockReturnValue(vi.fn()),
        },
    };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as any).__chimera;
});

describe('Providers', () => {
    it('disposes both AudioManager and DelegatingAssetManager when Providers unmounts', () => {
        const { unmount } = render(
            <Providers>
                <ContextProbe />
            </Providers>,
        );

        expect(providerMocks.audioManager.dispose).not.toHaveBeenCalled();
        expect(providerMocks.delegatingAssetManager.dispose).not.toHaveBeenCalled();

        unmount();

        expect(providerMocks.audioManager.dispose).toHaveBeenCalledOnce();
        expect(providerMocks.delegatingAssetManager.dispose).toHaveBeenCalledOnce();
    });

    it('constructs one AudioManager with the DelegatingAssetManager and provides both contexts', () => {
        const { rerender } = render(
            <Providers>
                <ContextProbe />
            </Providers>,
        );

        expect(screen.getByTestId('provider-probe')).toHaveAttribute(
            'data-asset-manager',
            'provided',
        );
        expect(screen.getByTestId('provider-probe')).toHaveAttribute(
            'data-audio-manager',
            'provided',
        );
        expect(providerMocks.createDelegatingAssetManager).toHaveBeenCalledOnce();
        expect(providerMocks.createAudioManager).toHaveBeenCalledOnce();
        expect(providerMocks.createAudioManager).toHaveBeenCalledWith(
            providerMocks.delegatingAssetManager,
        );

        rerender(
            <Providers>
                <ContextProbe />
            </Providers>,
        );

        expect(providerMocks.createDelegatingAssetManager).toHaveBeenCalledOnce();
        expect(providerMocks.createAudioManager).toHaveBeenCalledOnce();
    });

    it('provides SetGameAssetManagerContext so GameShell can wire its game AssetManager', () => {
        const gameManager = createGameAssetManagerStub();
        const { unmount } = render(
            <Providers>
                <DelegateSetterProbe manager={gameManager} />
            </Providers>,
        );

        const probe = screen.getByTestId('delegate-setter-probe');
        expect(probe.getAttribute('data-set-game-delegate')).toBe('provided');
        expect(providerMocks.delegatingAssetManager.setDelegate).toHaveBeenCalledWith(gameManager);

        unmount();

        expect(providerMocks.delegatingAssetManager.setDelegate).toHaveBeenLastCalledWith(null);
    });

    it('logs and provides noop audio when AudioManager creation fails', () => {
        const setupError = new Error('AudioContext unavailable');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        providerMocks.createAudioManager.mockImplementationOnce(() => {
            throw setupError;
        });

        render(
            <Providers>
                <NoopAudioProbe />
            </Providers>,
        );

        expect(screen.getByTestId('noop-audio-probe')).toHaveAttribute(
            'data-audio-handle-valid',
            'false',
        );
        expect(warn).toHaveBeenCalledWith(
            '[Providers] AudioManager initialization failed; using noop audio manager.',
            setupError,
        );
    });
});

function ContextProbe(): React.ReactElement {
    const assetManager = useAssetManager();
    const audioManager = useAudioManager();
    const setGameAssetManager = React.useContext(SetGameAssetManagerContext);
    const expectedAudioManager = providerMocks.audioManager as unknown as AudioManager;
    const expectedAssetManager =
        providerMocks.delegatingAssetManager as unknown as DelegatingAssetManager;

    return (
        <div
            data-testid="provider-probe"
            data-asset-manager={assetManager === expectedAssetManager ? 'provided' : 'wrong'}
            data-audio-manager={audioManager === expectedAudioManager ? 'provided' : 'wrong'}
            data-set-game-delegate={
                typeof setGameAssetManager === 'function' ? 'provided' : 'missing'
            }
        />
    );
}

function DelegateSetterProbe({ manager }: { readonly manager: AssetManager }): React.ReactElement {
    const setGameAssetManager = React.useContext(SetGameAssetManagerContext);

    React.useEffect(() => {
        setGameAssetManager?.(manager);
        return () => {
            setGameAssetManager?.(null);
        };
    }, [manager, setGameAssetManager]);

    return (
        <div
            data-testid="delegate-setter-probe"
            data-set-game-delegate={
                typeof setGameAssetManager === 'function' ? 'provided' : 'missing'
            }
        />
    );
}

function NoopAudioProbe(): React.ReactElement {
    const audioManager = useAudioManager();
    const handle = audioManager.play(
        'tactics/audio/sfx/test.ogg' as Parameters<AudioManager['play']>[0],
    );

    return (
        <div
            data-testid="noop-audio-probe"
            data-audio-handle-valid={handle.valid ? 'true' : 'false'}
        />
    );
}

function createGameAssetManagerStub(): AssetManager {
    return {
        registerManifest: vi.fn(),
        preloadCritical: vi.fn(async () => undefined),
        get: vi.fn(() => null),
        load: vi.fn(async () => {
            throw new Error('unused match asset manager mock');
        }),
        dispose: vi.fn(),
    };
}

function InputManagerProbe(): React.ReactElement {
    const inputManager = useInputManager();
    const expected = providerMocks.inputManager as unknown as InputManager;

    return (
        <div
            data-testid="input-manager-probe"
            data-input-manager={inputManager === expected ? 'provided' : 'wrong'}
        />
    );
}

describe('Providers — InputManager lifecycle', () => {
    it('seeds the InputActionRegistry with engine-owned actions only', () => {
        render(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        const createRegistryMock = providerMocks.createInputActionRegistry as unknown as {
            readonly mock: { readonly calls: readonly [readonly InputAction[]][] };
        };
        const seededActions = createRegistryMock.mock.calls[0]?.[0] ?? [];
        expect(seededActions).toEqual([
            {
                id: 'engine:undo',
                description: 'engine.actions.undo',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'engine:redo',
                description: 'engine.actions.redo',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'engine:toggle-menu',
                description: 'engine.actions.toggleMenu',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'engine:toggle-perf-hud',
                description: 'engine.actions.togglePerfHud',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'engine:toggle-debug-inspector',
                description: 'engine.actions.toggleDebugInspector',
                category: 'Engine',
                oneShot: true,
            },
        ]);
    });

    it('creates one InputManager via createInputManager', () => {
        const { rerender } = render(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        expect(providerMocks.createInputManager).toHaveBeenCalledOnce();

        rerender(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        expect(providerMocks.createInputManager).toHaveBeenCalledOnce();
    });

    it('calls start() on the InputManager when Providers mounts', () => {
        render(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        expect(providerMocks.inputManager.start).toHaveBeenCalledOnce();
    });

    it('calls stop() on the InputManager when Providers unmounts', () => {
        const { unmount } = render(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        expect(providerMocks.inputManager.stop).not.toHaveBeenCalled();

        unmount();

        expect(providerMocks.inputManager.stop).toHaveBeenCalledOnce();
    });

    it('provides InputManager via InputManagerContext', () => {
        render(
            <Providers>
                <InputManagerProbe />
            </Providers>,
        );

        expect(screen.getByTestId('input-manager-probe')).toHaveAttribute(
            'data-input-manager',
            'provided',
        );
    });
});

// ─── DeviceInfoProvider integration ──────────────────────────────────────────

describe('Providers — DeviceInfoProvider', () => {
    it('renders DeviceInfoProvider wrapping the provider tree', () => {
        render(
            <Providers>
                <div data-testid="child" />
            </Providers>,
        );

        expect(vi.mocked(DeviceInfoProvider)).toHaveBeenCalledOnce();
        // Children are accessible, confirming DeviceInfoProvider wraps the tree
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('passes window.__chimera.system as systemApi to DeviceInfoProvider', () => {
        const systemStub = { getDeviceInfo: vi.fn(), onDeviceInfoChange: vi.fn() };
        (window as any).__chimera = { system: systemStub };

        render(
            <Providers>
                <div />
            </Providers>,
        );

        delete (window as any).__chimera;

        expect(vi.mocked(DeviceInfoProvider)).toHaveBeenCalledWith(
            expect.objectContaining({ systemApi: systemStub }),
            undefined,
        );
    });

    it('passes null systemApi when the preload bridge is unavailable during prerender', () => {
        Reflect.deleteProperty(window, '__chimera');

        expect(() =>
            render(
                <Providers>
                    <div data-testid="child" />
                </Providers>,
            ),
        ).not.toThrow();

        expect(vi.mocked(DeviceInfoProvider)).toHaveBeenCalledWith(
            expect.objectContaining({ systemApi: null }),
            undefined,
        );
    });

    it('passes null systemApi when window.__chimera.system is missing getDeviceInfo', () => {
        (window as { __chimera?: unknown }).__chimera = {
            system: { onDeviceInfoChange: vi.fn() }, // getDeviceInfo absent
        };

        render(
            <Providers>
                <div />
            </Providers>,
        );

        delete (window as { __chimera?: unknown }).__chimera;

        expect(vi.mocked(DeviceInfoProvider)).toHaveBeenCalledWith(
            expect.objectContaining({ systemApi: null }),
            undefined,
        );
    });

    it('passes null systemApi when window.__chimera.system is missing onDeviceInfoChange', () => {
        (window as { __chimera?: unknown }).__chimera = {
            system: { getDeviceInfo: vi.fn() }, // onDeviceInfoChange absent
        };

        render(
            <Providers>
                <div />
            </Providers>,
        );

        delete (window as { __chimera?: unknown }).__chimera;

        expect(vi.mocked(DeviceInfoProvider)).toHaveBeenCalledWith(
            expect.objectContaining({ systemApi: null }),
            undefined,
        );
    });
});
