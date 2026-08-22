'use client';

/**
 * renderer/audio/useAudioCues.ts
 *
 * The React face of `AudioManager.observeCues` (§4.25 — Audio System): a component
 * names a voice and a record of handlers, and the subscription follows the component's
 * life rather than the caller's bookkeeping.
 *
 * **Feedback, not control.** What arrives here is a cue the playhead has already
 * crossed, one frame late at best. A transition that must land ON a cue is armed
 * through `crossfadeAtCue` or `fadeOutAtCue`, which schedule against
 * `AudioContext.currentTime` — starting a swap from a handler here reintroduces exactly
 * the jitter those verbs exist to remove. Observe to decide; schedule to execute.
 *
 * **The handlers are read through a ref, and the subscription is not keyed on them.**
 * A game passes an inline record, so its identity changes on every render of the parent.
 * Keying the effect on it would unsubscribe and re-observe each time, and the sampler
 * re-seats a voice's scheduler when its last observer leaves — so every cue between the
 * two samples would be lost. Mirrors `input/useInputAction.ts`, which holds one
 * subscription across a callback that changes identity for the same reason.
 */

import { useEffect, useRef } from 'react';

import type { AudioHandle } from './AudioManager';
import { useAudioManager } from './AudioManagerContext.js';
import type { CueHandlers } from './cueMarkerScheduler.js';

/**
 * Observe `handle`'s cues for as long as the component is mounted and the handle names
 * the same voice.
 *
 * @param handle    The voice to observe, or `null` for a component that has not started
 *                  one yet — that subscribes nothing and reports nothing, so a bed
 *                  started a frame later does not force the caller into a conditional
 *                  hook. The manager hands back one handle object per voice, so its
 *                  identity IS the voice's: a caller that copies the object forfeits the
 *                  scheduler state the old subscription held.
 * @param handlers  Which cue events to receive. Read at emission rather than at
 *                  subscribe, so it may be an inline record and a member added after the
 *                  fact still gets the next event.
 */
export function useAudioCues(handle: AudioHandle | null, handlers: CueHandlers): void {
    const audioManager = useAudioManager();

    // Written during render, as `useInputAction` writes its callback. The sampler fires
    // from a frame callback this component does not sequence against, so there is no
    // commit step a handler swap can be deferred to and still be certain of arriving
    // before the next emission; the render is the earliest point the new record exists.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (handle === null) {
            return undefined;
        }

        // All three members, whatever the caller's record holds right now: this record is
        // what the sampler keeps for the life of the subscription, so a member mirrored
        // from the record present at subscribe time could never be added later without
        // the resubscribe this hook exists to avoid.
        return audioManager.observeCues(handle, {
            onCue: (event) => handlersRef.current.onCue?.(event),
            onLoop: (event) => handlersRef.current.onLoop?.(event),
            onEnd: (event) => handlersRef.current.onEnd?.(event),
        });
    }, [audioManager, handle]);
}
