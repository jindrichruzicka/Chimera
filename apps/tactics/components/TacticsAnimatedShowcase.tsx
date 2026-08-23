'use client';

import React from 'react';
import { useFrame } from '@react-three/fiber';
import { useClipPlayer, useModelAnimation } from '@chimera-engine/renderer/components/r3f';
import type { ClipMarkerHandlers } from '@chimera-engine/renderer/components/r3f';
import type { ModelInstance } from '@chimera-engine/renderer/assets';
import type { ModelAnimationMetadata } from '@chimera-engine/simulation/content/animationManifest.js';

/**
 * The clip-player adoption surface, mounted in the `/model-showcase/` route's
 * canvas beside the model-seam pair (`TacticsModelShowcase`, which owns the
 * statement of why that route is isolated).
 *
 * Two instances of ONE animated ref, each under a DIFFERENT driver:
 *
 *   - the **played** instance runs `useClipPlayer` with the clip sheet the
 *     manifest authored, so its `top` bone moves — swinging or leaning,
 *     depending on which clip the screen above currently declares;
 *   - the **control** instance runs plain `useModelAnimation`, which owns a
 *     mixer and starts no action, so its bone does not move.
 *
 * Same model, same clip data, same frame loop — so a bone that moved on the
 * control could only have come from a mixer the played instance is driving, and
 * one that did not move on the played instance means the clip never advanced.
 * Neither is expressible with one instance, and neither with two different
 * models.
 *
 * Rule ONE-MIXER-PER-ROOT holds BY CONSTRUCTION here: each root carries exactly
 * one mixer-owning hook, and the two roots are distinct clones (the seam the
 * pair beside this one proves). Binding both hooks to one root is the thing this
 * component is arranged not to be able to do.
 *
 * **Nothing here dispatches.** The marker handlers forward events and reach no
 * `EngineAction`; the rule that no animation event may gate an action is held by
 * parameters that do not exist on `ClipMarkerHandlers` (see `useClipPlayer`'s
 * header). Tactics is `realtime: false`, so no `engine:tick` is ever dispatched
 * on this route: the clip FREE-RUNS off the frame clock and the simulation half
 * of the feature — beat windows, dilation, `onBeat` — is not exercised here at
 * all. The authored `beatWindow` is still verified, at content load, by
 * `content/tacticsAnimations.ts`.
 *
 * **Why the status element is written imperatively.** Marker events arrive
 * inside the frame loop, and §6.3 forbids `setState` there — so what the e2e
 * needs to read is written straight onto a DOM node's data attributes through a
 * ref, once per frame. React owns the element; only its attributes are written
 * from here, and nothing re-renders.
 *
 * **Why the bone rotations are RECORDED and not only published.** A blend is a
 * transient: the bone passes through rotations neither clip can pose alone and
 * is out the other side inside a second or two. A reader outside the window
 * samples on its own schedule, so every rotation between two of its samples is
 * one it cannot see at all — and on a runner slow enough to repaint a handful
 * of times a second, that is most of them. So the frame loop keeps the series
 * itself, in `data-clip-played-bone-z-recording` and its control twin, appended
 * from INSIDE the render and read once by anything outside it. Nothing falls
 * between two entries, because a frame is what puts one there — and what a
 * frame actually contributes is {@link recordSample}, which is not simply one
 * entry per frame.
 */
export interface TacticsAnimatedShowcaseProps {
    /** The clip-player-driven instance. `null` while the load is in flight. */
    readonly playedInstance: ModelInstance | null;
    /** The `useModelAnimation`-driven control instance, of the SAME ref. */
    readonly controlInstance: ModelInstance | null;
    /**
     * The parsed sheet for `playedInstance`'s ref, or `null`. Must be STABLE
     * across renders — it is a dependency of the playback effect, so a fresh
     * object per render would restart the clip on every frame. `useAnimationSheet`
     * memoises what it parses, which is why the screen resolves it there.
     */
    readonly sheet: ModelAnimationMetadata | null;
    /** The clip to play, or `null` to play nothing. */
    readonly clip: string | null;
    /**
     * Marker events, forwarded verbatim in addition to the counting this
     * component does for the status element. Read fresh on every emission.
     */
    readonly handlers?: ClipMarkerHandlers;
    /**
     * The DOM node whose data attributes carry the frame-sampled facts. Absent
     * in the component's own tests, which read the handler call list directly.
     */
    readonly statusRef?: React.RefObject<HTMLElement | null>;
}

/** Placement on the showcase camera — the animated pair sits right of the seam pair. */
const PLAYED_POSITION: readonly [number, number, number] = [0.85, 0, 0];
const CONTROL_POSITION: readonly [number, number, number] = [2.55, 0, 0];

/** The bone the clip rotates; authored in `showcase-rig-animated.glb`. */
const ANIMATED_BONE_NAME = 'top';

/**
 * The most samples one recording keeps.
 *
 * A bound is needed at all because this route stays open for as long as a spec
 * runs and `wave` loops — it moves the bone on every frame, for ever, so nothing
 * collapses it away. Which END the bound drops is the load-bearing half: a
 * transition happens at the START of a recording, so this refuses new samples
 * rather than evicting old ones.
 *
 * Sized against the thing it must not truncate: the authored 1.2 s blend
 * (`tacticsShowcaseLeanClip`), which contributes one sample per repaint. 600 is
 * 10 s of samples at 60 Hz and 2.5 s at 240 Hz, so on either the recording holds
 * the whole blend and over a second of whatever follows it — which is the window
 * a reader waiting for the blend to settle reads in.
 */
const MAX_RECORDED_SAMPLES = 600;

/** One instance's frame-by-frame rotation series, scoped to a declared clip. */
interface BoneRecording {
    /** The clip the samples belong to. A change RESTARTS the recording. */
    clip: string | null;
    /** The samples taken so far, consecutive repeats collapsed. */
    samples: string[];
    /** `samples` as the attribute carries it — joined once per append, not per frame. */
    text: string;
}

function emptyRecording(): BoneRecording {
    return { clip: null, samples: [], text: '' };
}

/**
 * Take one frame's `sample` into `recording`, restarting it when `clip` changed.
 *
 * Two samples are dropped, for two different reasons. An EMPTY one is not a
 * rotation — it is the "no instance, or no bone by that name" signal
 * {@link boneRotationZ} publishes — and recording it would put a value in the
 * series that no reader can compare against a pose. A REPEAT of the entry
 * before it visits no rotation its predecessor did not, so dropping it loses
 * nothing a reader asking "was this rotation ever posed" can use, and it is
 * what stops a held pose from filling the cap.
 */
function recordSample(recording: BoneRecording, clip: string | null, sample: string): void {
    if (recording.clip !== clip) {
        recording.clip = clip;
        recording.samples = [];
        recording.text = '';
    }
    if (sample === '') return;
    if (recording.samples.length >= MAX_RECORDED_SAMPLES) return;
    if (recording.samples[recording.samples.length - 1] === sample) return;

    recording.samples.push(sample);
    recording.text = recording.samples.join(',');
}

/** What the frame loop writes out, accumulated from marker events. */
interface MarkerTally {
    notifies: number;
    passageStarts: number;
    passageEnds: number;
    lastPassageEndReason: string;
}

export function TacticsAnimatedShowcase({
    playedInstance,
    controlInstance,
    sheet,
    clip,
    handlers,
    statusRef,
}: TacticsAnimatedShowcaseProps): React.ReactElement {
    const tally = React.useRef<MarkerTally>({
        notifies: 0,
        passageStarts: 0,
        passageEnds: 0,
        lastPassageEndReason: '',
    });
    const playedRecording = React.useRef<BoneRecording>(emptyRecording());
    const controlRecording = React.useRef<BoneRecording>(emptyRecording());

    // Read fresh on every emission by `useClipPlayer`, so this wrapper may be
    // rebuilt without restarting the clip in flight.
    const latestHandlers = React.useRef(handlers);
    React.useEffect(() => {
        latestHandlers.current = handlers;
    });

    const countingHandlers = React.useMemo<ClipMarkerHandlers>(
        () => ({
            onNotify: (event) => {
                tally.current.notifies += 1;
                latestHandlers.current?.onNotify?.(event);
            },
            onPassageStart: (event) => {
                tally.current.passageStarts += 1;
                latestHandlers.current?.onPassageStart?.(event);
            },
            onPassageTick: (event) => {
                latestHandlers.current?.onPassageTick?.(event);
            },
            onPassageEnd: (event) => {
                tally.current.passageEnds += 1;
                tally.current.lastPassageEndReason = event.reason;
                latestHandlers.current?.onPassageEnd?.(event);
            },
            onClipEnd: (event) => {
                latestHandlers.current?.onClipEnd?.(event);
            },
        }),
        [],
    );

    // Both hooks are called unconditionally — rules of hooks: each instance
    // transitions between null and non-null across renders of one mounted
    // component, and both hooks are null-safe.
    useClipPlayer(playedInstance, sheet, { clip, handlers: countingHandlers });
    useModelAnimation(controlInstance);

    // Registered unconditionally and inert until there is a node to write to.
    // No `setState` — see the module header.
    useFrame(() => {
        const element = statusRef?.current;
        if (element === null || element === undefined) return;

        const played = boneRotationZ(playedInstance);
        const control = boneRotationZ(controlInstance);
        recordSample(playedRecording.current, clip, played);
        recordSample(controlRecording.current, clip, control);

        element.dataset['clipNotifies'] = String(tally.current.notifies);
        element.dataset['clipPassageStarts'] = String(tally.current.passageStarts);
        element.dataset['clipPassageEnds'] = String(tally.current.passageEnds);
        element.dataset['clipPassageEndReason'] = tally.current.lastPassageEndReason;
        element.dataset['clipPlayedBoneZ'] = played;
        element.dataset['clipControlBoneZ'] = control;
        element.dataset['clipPlayedBoneZRecording'] = playedRecording.current.text;
        element.dataset['clipControlBoneZRecording'] = controlRecording.current.text;
        // The RECORDER's own clip, not the prop: read from the prop this would
        // say the same thing whether or not the restart above ever ran, and the
        // restart is what scopes a recording to one ask.
        element.dataset['clipRecordingClip'] = playedRecording.current.clip ?? '';
    });

    return (
        <>
            {playedInstance !== null && (
                <primitive object={playedInstance.root} position={PLAYED_POSITION} />
            )}
            {controlInstance !== null && (
                <primitive object={controlInstance.root} position={CONTROL_POSITION} />
            )}
        </>
    );
}

/**
 * The animated bone's Z rotation, as a fixed-precision string, or `''` when
 * there is no instance yet.
 *
 * `Object3D.rotation` tracks the quaternion the mixer writes, so reading the
 * Euler is reading the clip's own output. Fixed precision rather than raw:
 * the value crosses into a DOM attribute, and an exponent-notation float would
 * make the two samples an e2e compares differ for the wrong reason.
 */
function boneRotationZ(instance: ModelInstance | null): string {
    if (instance === null) return '';
    const bone = instance.root.getObjectByName(ANIMATED_BONE_NAME);
    return bone === undefined ? '' : bone.rotation.z.toFixed(4);
}
