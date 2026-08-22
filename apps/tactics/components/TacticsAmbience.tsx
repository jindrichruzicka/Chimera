'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
    MUSIC_PRIORITY,
    useAudioCues,
    useAudioManager,
    useMusicTrack,
    useSound,
    type AudioHandle,
    type AudioManager,
    type CueAlignedCrossfadeOptions,
    type PlayOptions,
} from '@chimera-engine/renderer/audio';

import { tacticsAudioRefs } from '../asset-manifest.js';

/** Which of the two ambience beds. Both DOM markers below carry one of these. */
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

/**
 * Where a swap hands over: the end of the phrase the bed is already looping on.
 *
 * Aliased from the loop region rather than written again, so the two can never name
 * different cues. The same cue that bounds the loop now also bounds the swap, which is
 * why this task needs no cue sheet, no manifest entry and no `validate-assets` change.
 */
const AMBIENCE_SWAP_CUE = AMBIENCE_LOOP_REGION.end;

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
// `fadeIn` is absent by type — the options this extends omit it — rather than by
// oversight.
const AMBIENCE_SWAP_OPTIONS: Omit<CueAlignedCrossfadeOptions, 'durationMs'> = {
    bus: 'music',
    volume: AMBIENCE_VOLUME,
    priority: MUSIC_PRIORITY,
    loopRegion: AMBIENCE_LOOP_REGION,
    atCue: AMBIENCE_SWAP_CUE,
};

/** A swap that is scheduled but has not sounded yet. */
interface PendingSwap {
    readonly track: TacticsAmbienceTrack;
    readonly incoming: AudioHandle;
}

/** The bed that is playing, kept with the manager that minted its handle. */
interface LiveBed {
    readonly manager: AudioManager;
    readonly handle: AudioHandle;
}

export interface TacticsAmbienceProps {
    /** Drives the bed: the local player's turn is calm, the opponent's is tense. */
    readonly isMyTurn: boolean;
}

/**
 * Tactics' ambience bed — the reference adoption of the §4.25 cue sheets and
 * cue-aligned transitions.
 *
 * Two beds, cut to one shape. The turn passing does not swap them: it ARMS the swap
 * at the bed's own `loopEnd`, and the music finishes its phrase before handing over.
 * That split is the feature — `crossfadeAtCue` schedules the handover natively
 * against `AudioContext.currentTime`, and the component learns it happened from a
 * cue emission, which is a frame late and therefore fit for moving a marker but not
 * for starting audio.
 *
 * **Two markers, because there are two facts.** `data-track` is the bed the turn
 * calls for and changes the instant the turn does; `data-playing-track` names the bed
 * the handover was armed to reach, and moves at the first `loopEnd` after the arm.
 * Collapsing them would delete the turn-signal claim `TacticsGameHud.test.tsx`
 * measures, and the gap between them IS the deferral.
 *
 * Neither marker is a claim about what is audible at that instant, and it is worth
 * being exact about the two ways it is not. Through the 900 ms of the swap BOTH beds
 * sound, one rising and one falling. And the engine reads the arrival when the
 * incoming clip decodes, so an arm placed close to a wrap can be booked for the NEXT
 * arrival while this settles on the imminent one — the marker then leads the audio by
 * a phase. Nothing here can close that: a swap hands back a handle, not the instant
 * it was booked for. `ambience-cue-aligned.spec.ts` makes its load-bearing claim
 * against `source.start` for exactly this reason, and its marker claim separately.
 *
 * **An armed swap is neither re-targeted nor cancelled.** By the time it is armed the
 * incoming voice is already scheduled to start at the cue, so a turn that changes
 * back before the phrase ends is served by the NEXT swap rather than by unpicking
 * this one. Two turns inside one phrase therefore make one handover, not two beds.
 * The guard is a comparison against the bed that is PLAYING rather than the one last
 * asked for: a second arm is refused while a swap is pending, and once it lands the
 * component compares again and arms whatever the turn now wants.
 *
 * The one thing worth knowing is why the LIVE handle is not enough to tear down. A
 * swap hands back only the incoming handle; the outgoing voice is thereafter
 * reachable solely through that record's linked fade-out, so the component holds no
 * name for it. Arming adds a second case: between the arm and the cue there is a
 * voice that exists, is scheduled, and has not sounded — dropped at unmount it would
 * start at the cue into a screen that is gone, and play for the rest of the session.
 * `openVoicesRef` takes every handle the manager hands back, at the moment it hands
 * it back, which is what makes the teardown total in both cases.
 */
export function TacticsAmbience({ isMyTurn }: TacticsAmbienceProps): React.ReactElement {
    const track: TacticsAmbienceTrack = isMyTurn ? 'calm' : 'tense';
    const audioManager = useAudioManager();
    const { crossfadeAtCue } = useMusicTrack();

    // The bed the match OPENED on. Frozen at mount so `useSound`'s ref argument is
    // stable — the swaps are crossfades, never a second play().
    const openingTrackRef = useRef<TacticsAmbienceTrack>(track);
    const startBed = useSound(AMBIENCE_REFS[openingTrackRef.current], AMBIENCE_PLAY_OPTIONS);

    // State rather than refs, unlike everything below: the marker renders from
    // `playingTrack`, and `useAudioCues` keys its subscription on the handle, so both
    // have to be values a render can see.
    const [liveBed, setLiveBed] = useState<LiveBed | null>(null);
    const [playingTrack, setPlayingTrack] = useState<TacticsAmbienceTrack>(openingTrackRef.current);

    // A handle minted by one manager names nothing to any other, and the two do not
    // change together: the provider swapping a manager gives this render a new
    // `crossfadeAtCue` while `liveBed` still holds the old manager's voice — the mount
    // effect below has not run yet. Armed in that window, the swap would be refused by
    // an engine that has never heard of the handle, and the pending slot would then sit
    // there refusing every later arm. Recomputed rather than stored so it cannot go
    // stale, and it stays reference-stable, since it is `liveBed` or nothing.
    const bed = liveBed !== null && liveBed.manager === audioManager ? liveBed : null;

    const pendingSwapRef = useRef<PendingSwap | null>(null);
    // Null until an effect needs it: `useRef(new Set())` would allocate a Set on
    // every render and discard all but the first, and only the effects ever read it.
    const openVoicesRef = useRef<Set<AudioHandle> | null>(null);

    useEffect(() => {
        const started = startBed();
        setLiveBed({ manager: audioManager, handle: started });
        const openVoices = (openVoicesRef.current ??= new Set<AudioHandle>());
        openVoices.add(started);

        return () => {
            // Dropped rather than left standing: this cleanup also runs when the
            // provider hands down a different manager, and a swap armed against the
            // one being replaced would otherwise refuse every future arm and then
            // settle the live handle onto a voice from a manager nobody holds.
            pendingSwapRef.current = null;
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
        // Compared against the bed that is PLAYING, not against the last one asked
        // for. That is what makes a turn which flips back inside a phrase a no-op here
        // rather than a second arm, and what makes the reconciliation after a swap
        // lands fall out of the same comparison. The null test covers both the commit
        // before the bed starts and the one after a manager swap, and narrows the handle
        // for `crossfadeAtCue`.
        if (bed === null || playingTrack === track || pendingSwapRef.current !== null) {
            return;
        }

        const incoming = crossfadeAtCue(bed.handle, AMBIENCE_REFS[track], {
            ...AMBIENCE_SWAP_OPTIONS,
            durationMs: AMBIENCE_CROSSFADE_MS,
        });
        pendingSwapRef.current = { track, incoming };

        const openVoices = (openVoicesRef.current ??= new Set<AudioHandle>());
        // Retiring invalidated entries keeps the set bounded by a swap rather than by
        // the match's turn count.
        for (const handle of openVoices) {
            if (!handle.valid) {
                openVoices.delete(handle);
            }
        }
        openVoices.add(incoming);
    }, [bed, crossfadeAtCue, playingTrack, track]);

    // Observation is how the component finds out the schedule ran; it schedules
    // nothing itself. A `null` handle — before the bed starts, and on the commit a
    // manager swap lands — observes nothing, so this needs no condition around it.
    useAudioCues(bed?.handle ?? null, {
        onCue: (event) => {
            // The beds cross `intro` and `outro` on every pass too. Only the cue the
            // swap was armed at is the instant the engine scheduled the handover for.
            if (event.name === AMBIENCE_SWAP_CUE.name) {
                settleSwap();
            }
        },
        // Cue resolution is fail-soft (Invariant #118): an unreachable `atCue` makes
        // the engine swap at once and stop the outgoing voice, so the cue this is
        // waiting for never arrives. `end` is what that path does emit, and it is the
        // only thing that keeps the marker off a bed that has stopped.
        onEnd: () => {
            settleSwap();
        },
    });

    function settleSwap(): void {
        const pending = pendingSwapRef.current;
        if (pending === null) {
            return;
        }
        pendingSwapRef.current = null;
        setLiveBed({ manager: audioManager, handle: pending.incoming });
        setPlayingTrack(pending.track);
    }

    return (
        <span
            data-testid="tactics-ambience"
            data-track={track}
            data-playing-track={playingTrack}
            hidden
        />
    );
}

export default TacticsAmbience;
