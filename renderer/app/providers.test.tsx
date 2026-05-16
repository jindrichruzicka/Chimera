// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetManager } from '../assets/AssetManager';
import { useAssetManager } from '../assets/AssetManagerContext.js';
import type { DelegatingAssetManager } from '../assets/DelegatingAssetManager';
import { SetMatchAssetManagerContext } from '../assets/SetMatchAssetManagerContext';
import type { AudioManager } from '../audio/AudioManager';
import { useAudioManager } from '../audio/AudioManagerContext.js';
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

    return {
        delegatingAssetManager,
        audioManager,
        createDelegatingAssetManager: vi.fn(() => delegatingAssetManager),
        createAudioManager: vi.fn(() => audioManager),
    };
});

vi.mock('../assets/DelegatingAssetManager', () => ({
    createDelegatingAssetManager: providerMocks.createDelegatingAssetManager,
}));

vi.mock('../audio/AudioManager', () => ({
    createAudioManager: providerMocks.createAudioManager,
}));

beforeEach(() => {
    providerMocks.createDelegatingAssetManager.mockClear();
    providerMocks.createAudioManager.mockClear();
    providerMocks.delegatingAssetManager.dispose.mockClear();
    providerMocks.delegatingAssetManager.setDelegate.mockClear();
    providerMocks.audioManager.dispose.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

    it('provides SetMatchAssetManagerContext so GameShell can wire its match AssetManager', () => {
        const matchManager = createMatchAssetManagerStub();
        const { unmount } = render(
            <Providers>
                <DelegateSetterProbe manager={matchManager} />
            </Providers>,
        );

        const probe = screen.getByTestId('delegate-setter-probe');
        expect(probe.getAttribute('data-set-match-delegate')).toBe('provided');
        expect(providerMocks.delegatingAssetManager.setDelegate).toHaveBeenCalledWith(matchManager);

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
    const setMatchAssetManager = React.useContext(SetMatchAssetManagerContext);
    const expectedAudioManager = providerMocks.audioManager as unknown as AudioManager;
    const expectedAssetManager =
        providerMocks.delegatingAssetManager as unknown as DelegatingAssetManager;

    return (
        <div
            data-testid="provider-probe"
            data-asset-manager={assetManager === expectedAssetManager ? 'provided' : 'wrong'}
            data-audio-manager={audioManager === expectedAudioManager ? 'provided' : 'wrong'}
            data-set-match-delegate={
                typeof setMatchAssetManager === 'function' ? 'provided' : 'missing'
            }
        />
    );
}

function DelegateSetterProbe({ manager }: { readonly manager: AssetManager }): React.ReactElement {
    const setMatchAssetManager = React.useContext(SetMatchAssetManagerContext);

    React.useEffect(() => {
        setMatchAssetManager?.(manager);
        return () => {
            setMatchAssetManager?.(null);
        };
    }, [manager, setMatchAssetManager]);

    return (
        <div
            data-testid="delegate-setter-probe"
            data-set-match-delegate={
                typeof setMatchAssetManager === 'function' ? 'provided' : 'missing'
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

function createMatchAssetManagerStub(): AssetManager {
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
