'use client';

import React, { useEffect, useRef } from 'react';
import {
    MUSIC_PRIORITY,
    useAudioManager,
    useMusicTrack,
    useSound,
    type AudioHandle,
    type CrossfadeOptions,
    type PlayOptions,
} from '@chimera-engine/renderer/audio';

import { tacticsAudioRefs } from '../asset-manifest.js';

/** Which ambience bed is playing. Mirrored into the DOM for the audio-smoke e2e. */
export type TacticsAmbienceTrack = 'calm' | 'tense';

const AMBIENCE_REFS = {
    calm: tacticsAudioRefs.ambienceCalm,
    tense: tacticsAudioRefs.ambienceTense,
} as const;

/**
 * Loop between the cues the clip's own sheet declares (§4.25).
 *
 * Named cues, never seconds: the offsets are authored once in
 * `asset-manifest.ts`, and `renderer/audio` resolves each `{ name }` against the
 * referenced clip's sheet at play time. Restating them here would be a second
 * source of truth that no build gate compares against the first. Setting
 * `loopRegion` implies `loop = true` (Invariant #117).
 */
const AMBIENCE_LOOP_REGION = {
    start: { name: 'loopStart' },
    end: { name: 'loopEnd' },
} as const;

/** Quiet enough to sit under the SFX bus, which plays at 0.4–0.65. */
const AMBIENCE_VOLUME = 0.3;
const AMBIENCE_FADE_IN_MS = 600;
const AMBIENCE_CROSSFADE_MS = 900;

const AMBIENCE_PLAY_OPTIONS: PlayOptions = {
    bus: 'music',
    volume: AMBIENCE_VOLUME,
    // A bed is exactly the voice that must survive a saturated pool; nothing applies
    // this implicitly from the bus or the loop flag (Invariant #123).
    priority: MUSIC_PRIORITY,
    loopRegion: AMBIENCE_LOOP_REGION,
    fadeIn: { durationMs: AMBIENCE_FADE_IN_MS },
};

// The swap owns the fade on both halves and derives it from `durationMs`, so
// `fadeIn` is absent by type (CrossfadeOptions omits it) rather than by omission.
const AMBIENCE_CROSSFADE_OPTIONS: Omit<CrossfadeOptions, 'durationMs'> = {
    bus: 'music',
    volume: AMBIENCE_VOLUME,
    priority: MUSIC_PRIORITY,
    loopRegion: AMBIENCE_LOOP_REGION,
};

export interface TacticsAmbienceProps {
    /** Drives the bed: the local player's turn is calm, the opponent's is tense. */
    readonly isMyTurn: boolean;
}

/**
 * Tactics' ambience bed — the reference adoption of the §4.25 cue sheets and
 * `crossfade`.
 *
 * Two beds, cut to one shape, swapped as the turn passes. Everything it remembers is
 * in refs rather than React state, because nothing renders from any of it — the
 * `data-track` marker comes from the prop.
 *
 * The one thing worth knowing is why the LIVE handle is not enough to tear down. A
 * crossfade hands back only the incoming handle; the outgoing voice is thereafter
 * reachable solely through that record's linked fade-out, so the component holds no
 * name for it. Unmounting mid-swap and stopping just the live handle would release
 * the incoming voice while it is still loading — before the linkage is applied — and
 * the outgoing loop, having nothing left to end it, would play for the rest of the
 * session. `openVoicesRef` is what makes the teardown total.
 *
 * Renders a hidden marker rather than visible UI. The bed has no user-facing
 * control (volume lives in engine settings, on the `music` bus), but a crossfade
 * is otherwise unobservable to a test that cannot listen — so the active bed is
 * mirrored into the DOM for `audio-smoke.spec.ts`, which asserts the swap actually
 * happens rather than merely that nothing warned.
 */
export function TacticsAmbience({ isMyTurn }: TacticsAmbienceProps): React.ReactElement {
    const track: TacticsAmbienceTrack = isMyTurn ? 'calm' : 'tense';
    const audioManager = useAudioManager();
    const { crossfade } = useMusicTrack();

    // The bed the match OPENED on. Frozen at mount so `useSound`'s ref argument is
    // stable — the swaps are crossfades, never a second play().
    const openingTrackRef = useRef<TacticsAmbienceTrack>(track);
    const startBed = useSound(AMBIENCE_REFS[openingTrackRef.current], AMBIENCE_PLAY_OPTIONS);

    const liveHandleRef = useRef<AudioHandle | null>(null);
    const playingTrackRef = useRef<TacticsAmbienceTrack | null>(null);
    // Null until an effect needs it: `useRef(new Set())` would allocate a Set on
    // every render and discard all but the first, and only the effects ever read it.
    const openVoicesRef = useRef<Set<AudioHandle> | null>(null);

    useEffect(() => {
        const started = startBed();
        liveHandleRef.current = started;
        playingTrackRef.current = openingTrackRef.current;
        const openVoices = (openVoicesRef.current ??= new Set<AudioHandle>());
        openVoices.add(started);

        return () => {
            liveHandleRef.current = null;
            playingTrackRef.current = null;
            for (const handle of openVoices) {
                // Stop, not fadeOut: the unmount is a screen leaving, and a release
                // ramp would outlive the component that owns the handle. A handle
                // whose voice is already gone is a no-op, so the set needs no
                // filtering here.
                audioManager.stop(handle);
            }
            openVoices.clear();
        };
    }, [audioManager, startBed]);

    useEffect(() => {
        const outgoing = liveHandleRef.current;
        // An equal track is a rerender that changed something else. The null test
        // narrows the handle for `crossfade`; under the effects as declared it never
        // decides anything, since the mount effect has already run.
        if (outgoing === null || playingTrackRef.current === track) {
            return;
        }
        playingTrackRef.current = track;
        const incoming = crossfade(outgoing, AMBIENCE_REFS[track], {
            ...AMBIENCE_CROSSFADE_OPTIONS,
            durationMs: AMBIENCE_CROSSFADE_MS,
        });
        liveHandleRef.current = incoming;

        const openVoices = (openVoicesRef.current ??= new Set<AudioHandle>());
        // Retiring invalidated entries keeps the set bounded by a swap rather than by
        // the match's turn count.
        for (const handle of openVoices) {
            if (!handle.valid) {
                openVoices.delete(handle);
            }
        }
        openVoices.add(incoming);
    }, [crossfade, track]);

    return <span data-testid="tactics-ambience" data-track={track} hidden />;
}

export default TacticsAmbience;
