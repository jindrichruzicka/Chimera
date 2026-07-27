'use client';

import { useMemo } from 'react';

import type { AudioManager } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';

/**
 * The three verbs that act on a voice already playing (§4.25 — Audio System), taken from
 * {@link AudioManager} rather than restated: each keeps the manager's own signature and its
 * own documentation, and a hand copy of either drifts silently. The handle names the voice,
 * so one control object serves however many voices a component holds.
 */
export type AudioTrackControls = Pick<AudioManager, 'fadeOut' | 'fadeTo' | 'crossfade'>;

/**
 * Returns the live-handle verbs bound to the app's `AudioManager`.
 *
 * The returned object carries those three and nothing else, so a component holding music
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
        }),
        [audioManager],
    );
}
