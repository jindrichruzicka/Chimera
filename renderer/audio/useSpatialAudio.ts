'use client';

import { useMemo } from 'react';

import type { AudioManager } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';

/**
 * The two spatial verbs (§4.25 — Audio System → Spatial Audio), taken from
 * {@link AudioManager} rather than restated — exactly as `AudioTrackControls` is —
 * so each keeps the manager's own signature and documentation, and a hand copy of
 * either would drift silently.
 */
export type SpatialAudioControls = Pick<AudioManager, 'setListener' | 'setVoicePosition'>;

/**
 * Returns the spatial verbs bound to the app's `AudioManager`: the one listener pose
 * and the moving-source verb. The returned object carries those two and nothing
 * else, so a component anchoring the listener passes around a control surface rather
 * than the manager. Starting a positioned voice stays `useSound`'s job, through
 * `PlayOptions.spatial`.
 *
 * The manager comes from {@link useAudioManager} and from nowhere else (Invariant
 * #84); outside the provider that call throws rather than substituting one
 * (Invariant #83). The returned object keeps its identity for as long as the manager
 * does, so it is safe in an effect's dependency list — which is exactly where a
 * game anchors its listener, keyed on the focus rather than per frame.
 */
export function useSpatialAudio(): SpatialAudioControls {
    const audioManager = useAudioManager();

    // Typed through SpatialAudioControls rather than per-parameter, so the signatures
    // have the one home the type does. The wrappers are what make each call a METHOD
    // call: bare references would reach the manager's class methods with the controls
    // object as receiver, and both verbs read `this.voices` or `this.audioContext`.
    return useMemo<SpatialAudioControls>(
        () => ({
            setListener: (pose, opts) => {
                audioManager.setListener(pose, opts);
            },
            setVoicePosition: (handle, position, opts) => {
                audioManager.setVoicePosition(handle, position, opts);
            },
        }),
        [audioManager],
    );
}
