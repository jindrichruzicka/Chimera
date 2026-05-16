// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';

import { AudioManagerContext } from './AudioManagerContext.js';
import type { AudioHandle, AudioManager, PlayOptions } from './AudioManager';
import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs.js';
import { useSound } from './useSound.js';

const SOUND_REF = 'tactics/audio/sfx/select.ogg' as AssetRef<AudioClipAsset>;
const OTHER_SOUND_REF = 'tactics/audio/sfx/confirm.ogg' as AssetRef<AudioClipAsset>;
const PLAY_OPTIONS: PlayOptions = { bus: 'sfx', volume: 0.5 };

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useSound', () => {
    it('plays the sound through the injected audio manager and returns the handle', () => {
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useSound(SOUND_REF, PLAY_OPTIONS), {
            wrapper: createWrapper(audioManager),
        });

        const handle = result.current();

        expect(audioManager.play).toHaveBeenCalledOnce();
        expect(audioManager.play).toHaveBeenCalledWith(SOUND_REF, PLAY_OPTIONS);
        expect(handle).toEqual({
            id: 'test-audio-handle',
            ref: SOUND_REF,
            bus: 'sfx',
            priority: 0,
            valid: true,
        });
    });

    it('returns a stable play callback when inputs stay the same', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: PLAY_OPTIONS },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: PLAY_OPTIONS });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when the sound ref changes', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: PLAY_OPTIONS },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: OTHER_SOUND_REF, opts: PLAY_OPTIONS });

        expect(result.current).not.toBe(initialPlay);
    });

    it('updates the play callback when play options change', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: PLAY_OPTIONS },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: { bus: 'voice', volume: 0.75 } satisfies PlayOptions });

        expect(result.current).not.toBe(initialPlay);
    });

    it('returns a stable play callback when options are omitted', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref }) => useSound(ref), {
            initialProps: { ref: SOUND_REF },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between omitted and empty options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: undefined as PlayOptions | undefined },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: {} });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between empty and omitted options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions | undefined }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: {} },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: undefined });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between omitted and explicit default options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: undefined as PlayOptions | undefined },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: { bus: 'sfx', loop: false, volume: 1, priority: 0 },
        });

        expect(result.current).toBe(initialPlay);
    });

    it('returns a stable play callback when options values are unchanged', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { bus: 'sfx', volume: 0.5 } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: { bus: 'sfx', volume: 0.5 } satisfies PlayOptions });

        expect(result.current).toBe(initialPlay);
    });

    it('returns a stable play callback when position values are unchanged', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { position: [1, 2, 3] } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: { position: [1, 2, 3] } satisfies PlayOptions,
        });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when position values change', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { position: [1, 2, 3] } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: { position: [1, 2, 4] } satisfies PlayOptions,
        });

        expect(result.current).not.toBe(initialPlay);
    });
});

function createWrapper(audioManager: AudioManager): React.ComponentType<{
    readonly children: React.ReactNode;
}> {
    return function AudioManagerWrapper({ children }): React.ReactElement {
        return (
            <AudioManagerContext.Provider value={audioManager}>
                {children}
            </AudioManagerContext.Provider>
        );
    };
}
