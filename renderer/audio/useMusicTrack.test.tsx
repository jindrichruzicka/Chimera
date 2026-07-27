// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AudioHandle, AudioManager } from './AudioManager';
import { AudioManagerContext } from './AudioManagerContext.js';
import type { CrossfadeOptions, FadeOutSpec, FadeToSpec } from './Cue';
import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs.js';
import { useMusicTrack, type AudioTrackControls } from './useMusicTrack.js';

const MUSIC_REF = 'tactics/audio/music/menu.ogg' as AssetRef<AudioClipAsset>;
const NEXT_MUSIC_REF = 'tactics/audio/music/battle.ogg' as AssetRef<AudioClipAsset>;

const TRACK: AudioHandle = {
    id: 'music-voice',
    ref: MUSIC_REF,
    bus: 'music',
    priority: 100,
    valid: true,
};

/**
 * The verbs the controls expose, sorted for the shape case below. Typed against
 * `AudioTrackControls`, so a renamed or mistyped verb is a compile error rather than a
 * silently-passing list.
 */
const TRACK_VERBS = [
    'crossfade',
    'fadeOut',
    'fadeTo',
] as const satisfies readonly (keyof AudioTrackControls)[];

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useMusicTrack', () => {
    it('fades a live voice out through the context manager', () => {
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });
        const spec: FadeOutSpec = { toEnd: true, curve: 'equalPower' };

        result.current.fadeOut(TRACK, spec);

        expect(audioManager.fadeOut).toHaveBeenCalledOnce();
        expect(audioManager.fadeOut).toHaveBeenCalledWith(TRACK, spec);
    });

    it('ramps a live voice to an absolute gain through the context manager', () => {
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });
        const spec: FadeToSpec = { to: 0.3, durationMs: 800 };

        result.current.fadeTo(TRACK, spec);

        expect(audioManager.fadeTo).toHaveBeenCalledOnce();
        expect(audioManager.fadeTo).toHaveBeenCalledWith(TRACK, spec);
    });

    it('crossfades through the context manager and returns the incoming handle', () => {
        // The incoming handle is the whole point of the verb — it is what the caller
        // holds to fade the NEXT swap. The mutant this pins is handing back `outgoing`
        // instead of the manager's return: it type-checks, and leaves every later verb
        // aimed at the voice that just faded out.
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });
        const opts: CrossfadeOptions = { durationMs: 2000, bus: 'music', loop: true };

        const incoming = result.current.crossfade(TRACK, NEXT_MUSIC_REF, opts);

        expect(audioManager.crossfade).toHaveBeenCalledOnce();
        expect(audioManager.crossfade).toHaveBeenCalledWith(TRACK, NEXT_MUSIC_REF, opts);
        expect(incoming).toBe(vi.mocked(audioManager.crossfade).mock.results[0]?.value);
    });

    it('exposes the three live-handle verbs and nothing else the manager carries', () => {
        // `AudioManager` is structurally assignable to `AudioTrackControls`, so a body of
        // `return audioManager;` typechecks AND delegates correctly — every other case in
        // this file passes on it. What it also hands the component is `play`, `stop`,
        // `stopAll`, `duck` and `dispose`, so the narrowing is a runtime property that
        // only this assertion holds.
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });

        expect(Object.keys(result.current).sort()).toEqual([...TRACK_VERBS]);
    });

    it('calls each verb ON the context manager, not as a detached function', () => {
        // `DefaultAudioManager`'s verbs are class methods that read `this.voices`, so
        // controls built from bare references — `fadeOut: audioManager.fadeOut` — would
        // call them with the CONTROLS as receiver and throw against the real manager. The
        // spy's verbs are plain functions that never read one, so the recorded context is
        // the only thing that tells a bound call from an extracted one.
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });

        result.current.fadeOut(TRACK, { toEnd: true });
        result.current.fadeTo(TRACK, { to: 0.5, durationMs: 100 });
        result.current.crossfade(TRACK, NEXT_MUSIC_REF, { durationMs: 100 });

        // `toBe`, not `toEqual`: the claim is that the receiver IS the manager, and two
        // distinct spies are deep-equal.
        expect(vi.mocked(audioManager.fadeOut).mock.contexts[0]).toBe(audioManager);
        expect(vi.mocked(audioManager.fadeTo).mock.contexts[0]).toBe(audioManager);
        expect(vi.mocked(audioManager.crossfade).mock.contexts[0]).toBe(audioManager);
    });

    it('throws outside the provider, having no other source for a manager', () => {
        // Invariant #84: the hook reaches the manager through useAudioManager() alone.
        // A body that imported or constructed one would render here instead of throwing.
        expect(() => renderHook(() => useMusicTrack())).toThrow(
            'useAudioManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns stable controls while the manager stays the same', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(() => useMusicTrack(), {
            wrapper: createWrapper(audioManager),
        });
        const initialControls = result.current;

        rerender();

        expect(result.current).toBe(initialControls);
    });

    it('returns fresh controls when the provider supplies a different manager', () => {
        // Controls memoized on an empty dependency list stay bound to the FIRST manager
        // for the component's whole life — every later fade would reach the manager the
        // provider has already replaced.
        // RTL's renderHook does not pass props to the wrapper, so the provided manager
        // is swapped through a local the wrapper re-reads on each render.
        const firstManager = createAudioManagerSpy();
        const secondManager = createAudioManagerSpy();
        let providedManager = firstManager;
        const { result, rerender } = renderHook(() => useMusicTrack(), {
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
        result.current.fadeTo(TRACK, { to: 0, durationMs: 10 });
        expect(secondManager.fadeTo).toHaveBeenCalledOnce();
        expect(firstManager.fadeTo).not.toHaveBeenCalled();
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
