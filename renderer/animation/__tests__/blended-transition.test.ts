/**
 * renderer/animation/__tests__/blended-transition.test.ts
 *
 * The whole blend chain, end to end, against real `three`: a `ClipPlayer` over a
 * `MeshClipBackend` over an `AnimationMixer` bound to a real `Object3D`, with two
 * synthesized clips posing the same property to two different values.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why a whole chain rather than another unit.** Every layer's own suite can be
 * green while the blend is invisible: the player can route a duration into
 * `crossfadeTo`, the backend can ramp two weights, and the transition can still
 * hard-stop the outgoing action on the frame the blend starts — which is what a
 * player releasing with `stop` instead of `hold` does. What proves a blend
 * happened is a bound node standing BETWEEN two poses on a frame in the middle of
 * it, and only the assembled chain can be asked that.
 *
 * **Why two clips over the same property.** `attack` drives `.position.x` to 1
 * and `guard` holds it at 0. Under three's normalized accumulation the node then
 * reads the weighted average of the two, so a mid-fade sample is strictly between
 * them — a value neither clip can produce alone, at either weight.
 */

import { describe, expect, it } from 'vitest';

import { AnimationClip, AnimationMixer, Object3D, VectorKeyframeTrack } from 'three';

import type { ClipSheetSource } from '../ClipTimeline.js';
import type { MarkerEvent } from '../clipMarkerScheduler.js';
import { ClipPlayer } from '../ClipPlayer.js';
import { MeshClipBackend } from '../MeshClipBackend.js';

/** Two seconds, so one second of wall clock is half a clip. */
const CLIP_SECONDS = 2;
const FADE_SECONDS = 0.4;

/** `attack` sweeps `.position.x` from 0 to 1 across its length. */
function makeAttack(): AnimationClip {
    return new AnimationClip('attack', CLIP_SECONDS, [
        new VectorKeyframeTrack('.position', [0, CLIP_SECONDS], [0, 0, 0, 1, 0, 0]),
    ]);
}

/** `guard` holds `.position.x` at 0 for its whole length. */
function makeGuard(): AnimationClip {
    return new AnimationClip('guard', CLIP_SECONDS, [
        new VectorKeyframeTrack('.position', [0, CLIP_SECONDS], [0, 0, 0, 0, 0, 0]),
    ]);
}

/** `attack` carries a passage and a notify; `guard` carries nothing. */
const SHEET: ClipSheetSource = {
    clips: {
        attack: {
            durationSeconds: CLIP_SECONDS,
            passages: { swing: { from: { seconds: 0.2 }, to: { seconds: 1.8 } } },
            notifies: { impact: { at: { seconds: 1.5 } } },
        },
    },
};

interface Rig {
    readonly root: Object3D;
    readonly mixer: AnimationMixer;
    readonly backend: MeshClipBackend;
    readonly player: ClipPlayer;
    readonly events: MarkerEvent[];
    /** The clip objects the backend holds, so a case reads THEIR actions. */
    readonly clips: { readonly attack: AnimationClip; readonly guard: AnimationClip };
}

function makeRig(): Rig {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const clips = { attack: makeAttack(), guard: makeGuard() };
    const backend = new MeshClipBackend({ mixer, clips: [clips.attack, clips.guard] });
    const events: MarkerEvent[] = [];
    const player = new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined });
    return { root, mixer, backend, player, events, clips };
}

/** The handlers every case records through. */
function handlersFor(events: MarkerEvent[]): {
    onNotify: (event: MarkerEvent) => void;
    onPassageStart: (event: MarkerEvent) => void;
    onPassageEnd: (event: MarkerEvent) => void;
    onClipEnd: (event: MarkerEvent) => void;
} {
    const record = (event: MarkerEvent): void => {
        events.push(event);
    };
    return {
        onNotify: record,
        onPassageStart: record,
        onPassageEnd: record,
        onClipEnd: record,
    };
}

describe('a blended clip transition, over real three', () => {
    it('poses the node strictly between the two clips while the blend runs', () => {
        const { root, player, events } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'loop',
            handlers: handlersFor(events),
        });
        // Half the clip in, so `attack` alone poses 0.5 — clear of both the
        // rest pose and the value `guard` holds.
        player.tick(1);
        const attackAlone = root.position.x;
        expect(attackAlone).toBeCloseTo(0.5, 6);

        player.transitionTo({ clipName: 'guard', loop: 'loop', blendSeconds: FADE_SECONDS });
        player.tick(FADE_SECONDS / 2);

        // Halfway through the fade both actions carry weight 0.5, and three's
        // normalized accumulation averages them — a value NEITHER clip can pose
        // on its own. A cut would read `guard`'s 0 here, and a transition that
        // hard-stopped the outgoing action would read the same 0.
        const blended = root.position.x;
        expect(blended).toBeGreaterThan(0);
        expect(blended).toBeLessThan(attackAlone);
    });

    it('finishes at the incoming clip alone, with the outgoing action released', () => {
        const { root, mixer, player, events, clips } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'loop',
            handlers: handlersFor(events),
        });
        player.tick(1);
        // The backend's OWN clip objects: three caches one action per
        // (clip, root), so a freshly built clip of the same name would allocate
        // a second action and answer about nothing.
        const attackAction = mixer.clipAction(clips.attack);
        const guardAction = mixer.clipAction(clips.guard);

        player.transitionTo({ clipName: 'guard', loop: 'loop', blendSeconds: FADE_SECONDS });
        player.tick(FADE_SECONDS);
        player.tick(0.5);

        // Weights, not just the pose: one contributor normalizes to its own pose
        // at ANY weight, so `x === 0` alone cannot tell "released" from "still
        // posing at 0".
        expect(guardAction.getEffectiveWeight()).toBe(1);
        expect(attackAction.getEffectiveWeight()).toBe(0);
        expect(attackAction.isRunning()).toBe(false);
        expect(root.position.x).toBe(0);
        expect(player.activeClips).toEqual(['guard']);
    });

    it('closes every open passage once, on the transition frame, and then goes quiet', () => {
        const { player, events } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'loop',
            handlers: handlersFor(events),
        });
        player.tick(1);
        expect(events).toEqual([{ kind: 'passage-start', name: 'swing' }]);
        events.length = 0;

        player.transitionTo({ clipName: 'guard', loop: 'loop', blendSeconds: FADE_SECONDS });

        // Synchronously inside the call, once, and for the reason a replacement
        // closes a passage.
        expect(events).toEqual([{ kind: 'passage-end', name: 'swing', reason: 'clip-changed' }]);

        // …and the outgoing clip is finished with. Its notify sits at phase 0.75
        // and its action is still posing through the fade, so a player that kept
        // the entry would fire the notify below and end the clip after it.
        events.length = 0;
        player.tick(FADE_SECONDS);
        player.tick(1);
        player.tick(1);
        expect(events).toEqual([]);
    });

    it('blends back into a clip it blended out of', () => {
        const { root, player, events } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'loop',
            handlers: handlersFor(events),
        });
        player.tick(1);
        player.transitionTo({ clipName: 'guard', loop: 'loop', blendSeconds: FADE_SECONDS });
        // Past the end of the first fade, so `attack` is released and only
        // `guard` is posing.
        player.tick(FADE_SECONDS);
        expect(root.position.x).toBe(0);

        player.transitionTo({ clipName: 'attack', loop: 'loop', blendSeconds: FADE_SECONDS });
        player.tick(FADE_SECONDS / 2);

        // The second transition of an A→B→A alternation has to blend as well as
        // the first. `attack` restarts at phase 0 and reaches 0.1 by here, and
        // `guard` poses 0; at half weight each the node reads their average.
        // Under a cut it reads `attack` alone at 0.1, so the two are a factor of
        // two apart and the exact value is what separates them.
        expect(root.position.x).toBeCloseTo(0.05, 6);
    });

    it('replays a once clip that already ended, rather than resuming its held pose', () => {
        const { root, player, events } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'once',
            handlers: handlersFor(events),
        });
        // Past the end: the clip is out of the active set and holding its last
        // frame, which is `attack`'s pose at 1.
        player.tick(2.5);
        expect(root.position.x).toBe(1);
        expect(player.activeClips).toEqual([]);
        events.length = 0;

        player.transitionTo({ clipName: 'attack', loop: 'once', blendSeconds: FADE_SECONDS });
        player.tick(0.5);

        // A blend into a clip the player is POSING would have the backend resume
        // the held action where it stopped — clamped at the end of a finished
        // clip, for ever, with `clip-end` firing again on the next tick. The
        // request falls to the cut path instead, and a cut restarts.
        expect(root.position.x).toBeCloseTo(0.25, 6);
        expect(player.activeClips).toEqual(['attack']);
        expect(events).toEqual([]);
    });

    it('cuts when the same transition asks for no blend', () => {
        const { root, player, events } = makeRig();
        player.play({
            clipName: 'attack',
            sheet: SHEET,
            loop: 'loop',
            handlers: handlersFor(events),
        });
        player.tick(1);

        player.transitionTo({ clipName: 'guard', loop: 'loop' });
        player.tick(FADE_SECONDS / 2);

        // The negative control for the first case: at the same moment of the
        // same transition, with no blend asked for, the node is on `guard`'s
        // pose outright rather than between the two.
        expect(root.position.x).toBe(0);
    });
});
