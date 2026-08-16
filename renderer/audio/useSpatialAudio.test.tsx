// @vitest-environment jsdom

/**
 * renderer/audio/useSpatialAudio.test.tsx
 *
 * Architecture reference: §4.25 — Audio System → Spatial Audio.
 *
 * Invariants upheld:
 *   #83 — engine context hooks throw outside their provider.
 *   #84 — the manager is reached through useAudioManager() and nowhere else.
 *
 * Written test-first against a module that did not exist, so every case was red as
 * an unresolvable import. The load-bearing behavioural cases mirror useMusicTrack's:
 * the closed two-verb surface (an `AudioManager` is structurally assignable to the
 * Pick, so `return audioManager` would typecheck AND delegate — only the key walk
 * catches it), the method-call receiver, and the manager-keyed identity.
 */

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { AudioManagerContext } from './AudioManagerContext.js';
import type { AudioManager } from './AudioManager';
import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs.js';
import { useSpatialAudio } from './useSpatialAudio.js';

const SPATIAL_VERBS = ['setListener', 'setVoicePosition'] as const;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useSpatialAudio', () => {
    it('delegates both verbs to the injected manager with the arguments as passed', () => {
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useSpatialAudio(), {
            wrapper: createWrapper(audioManager),
        });

        result.current.setListener({ position: [1, 2, 3] }, { immediate: true });
        const handle = audioManager.play('tactics/audio/sfx/step.ogg' as AssetRef<AudioClipAsset>);
        result.current.setVoicePosition(handle, [4, 5, 6], { immediate: false });

        expect(audioManager.setListener).toHaveBeenCalledWith(
            { position: [1, 2, 3] },
            { immediate: true },
        );
        expect(audioManager.setVoicePosition).toHaveBeenCalledWith(handle, [4, 5, 6], {
            immediate: false,
        });
    });

    it('calls the manager as the receiver, never a bare function reference', () => {
        // Bare references would reach the class methods with the control object as
        // `this`, and both verbs read manager state through it.
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useSpatialAudio(), {
            wrapper: createWrapper(audioManager),
        });

        result.current.setListener({ position: [0, 0, 0] });
        result.current.setVoicePosition(
            audioManager.play('tactics/audio/sfx/tap.ogg' as AssetRef<AudioClipAsset>),
            [1, 1, 1],
        );

        expect(vi.mocked(audioManager.setListener).mock.contexts[0]).toBe(audioManager);
        expect(vi.mocked(audioManager.setVoicePosition).mock.contexts[0]).toBe(audioManager);
    });

    it('exposes exactly the two spatial verbs and nothing else the manager carries', () => {
        // `AudioManager` is structurally assignable to the Pick, so a body of
        // `return audioManager;` typechecks and delegates — this key walk is the one
        // assertion that holds the narrowing.
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useSpatialAudio(), {
            wrapper: createWrapper(audioManager),
        });

        expect(Object.keys(result.current).sort()).toEqual([...SPATIAL_VERBS]);
    });

    it('throws outside the provider, having no other source for a manager', () => {
        // Invariants #83/#84: the hook reaches the manager through useAudioManager()
        // alone. A body that imported or constructed one would render here instead.
        expect(() => renderHook(() => useSpatialAudio())).toThrow(
            'useAudioManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns a stable object while the manager stays the same', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(() => useSpatialAudio(), {
            wrapper: createWrapper(audioManager),
        });
        const initialControls = result.current;

        rerender();

        expect(result.current).toBe(initialControls);
    });

    it('hands back a new object bound to a swapped manager', () => {
        const firstManager = createAudioManagerSpy();
        const secondManager = createAudioManagerSpy();
        let providedManager = firstManager;
        const { result, rerender } = renderHook(() => useSpatialAudio(), {
            wrapper: ({ children }): React.ReactElement => (
                <AudioManagerContext.Provider value={providedManager}>
                    {children}
                </AudioManagerContext.Provider>
            ),
        });
        const initialControls = result.current;

        providedManager = secondManager;
        rerender();

        expect(result.current).not.toBe(initialControls);
        result.current.setListener({ position: [9, 9, 9] });
        expect(secondManager.setListener).toHaveBeenCalledOnce();
        expect(firstManager.setListener).not.toHaveBeenCalled();
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
