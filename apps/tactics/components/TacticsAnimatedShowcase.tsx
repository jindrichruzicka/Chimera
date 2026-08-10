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
 *     manifest authored, so its `top` bone swings;
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

        element.dataset['clipNotifies'] = String(tally.current.notifies);
        element.dataset['clipPassageStarts'] = String(tally.current.passageStarts);
        element.dataset['clipPassageEnds'] = String(tally.current.passageEnds);
        element.dataset['clipPassageEndReason'] = tally.current.lastPassageEndReason;
        element.dataset['clipPlayedBoneZ'] = boneRotationZ(playedInstance);
        element.dataset['clipControlBoneZ'] = boneRotationZ(controlInstance);
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
