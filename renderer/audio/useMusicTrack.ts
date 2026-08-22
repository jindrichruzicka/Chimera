'use client';

import { useMemo } from 'react';

import type { AudioManager } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';

/**
 * What this hook binds (§4.25 — Audio System), taken from {@link AudioManager} rather than
 * restated: each member keeps the manager's own signature and its own documentation, and a
 * hand copy of either drifts silently. The handle names the voice, so one control object
 * serves however many voices a component holds. Which members those are is the `Pick` below
 * and is measured by `useMusicTrack.test.tsx` — the manager carries other handle-taking
 * verbs that deliberately stay off it.
 *
 * The cue-aligned pair belongs here for exactly that reason — both take a live handle and
 * act on the voice it names. What the cue moves is WHEN each runs, not what it acts on:
 * the call arms a native schedule against `AudioContext.currentTime` and returns, and the
 * transition executes at the voice's next arrival at the cue. Deciding to arm one from a
 * cue the game OBSERVED is `useAudioCues`' side of the split.
 */
export type AudioTrackControls = Pick<
    AudioManager,
    'fadeOut' | 'fadeTo' | 'crossfade' | 'crossfadeAtCue' | 'fadeOutAtCue'
>;

/**
 * Returns the live-handle verbs bound to the app's `AudioManager`.
 *
 * The returned object carries those and nothing else, so a component holding music
 * controls passes around a control surface rather than the manager. That is a narrowing,
 * not a barrier: `useAudioManager()` stays open to any renderer component, and Invariant
 * #64 has `GameShell` call `stopAll()` on the manager it gets that way. Starting a voice
 * from nothing stays `useSound`'s job; `crossfade` starts one only as the other half of
 * a swap.
 *
 * The manager comes from {@link useAudioManager} and from nowhere else (Invariant #84);
 * outside the provider that call throws rather than substituting one. The returned object
 * keeps its identity for as long as the manager does, so it is safe in an effect's
 * dependency list.
 */
export function useMusicTrack(): AudioTrackControls {
    const audioManager = useAudioManager();

    // Typed through AudioTrackControls rather than per-parameter, so the signatures have
    // the one home the type does. The wrappers are what make each call a METHOD call:
    // bare references would reach the manager's class methods with the controls as
    // receiver, and every one of them reads `this.voices`.
    return useMemo<AudioTrackControls>(
        () => ({
            fadeOut: (handle, spec) => {
                audioManager.fadeOut(handle, spec);
            },
            fadeTo: (handle, spec) => {
                audioManager.fadeTo(handle, spec);
            },
            crossfade: (outgoing, incoming, opts) =>
                audioManager.crossfade(outgoing, incoming, opts),
            crossfadeAtCue: (outgoing, incoming, opts) =>
                audioManager.crossfadeAtCue(outgoing, incoming, opts),
            fadeOutAtCue: (handle, spec) => {
                audioManager.fadeOutAtCue(handle, spec);
            },
        }),
        [audioManager],
    );
}
