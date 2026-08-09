/**
 * renderer/animation/MeshClipBackend.ts
 *
 * The {@link ClipBackend} over a three.js `AnimationMixer`: skinned meshes,
 * skeletal clips, real blending.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Composition, and an injected mixer.** This class holds an `AnimationMixer`;
 * it subclasses neither it nor `AnimationAction`. The mixer arrives through the
 * constructor because one mixer belongs to one root and may carry more binders
 * than this backend — so its lifetime, and its `timeScale`, belong to whoever
 * allocated it. {@link MeshClipBackend.dispose} therefore releases exactly what
 * this backend allocated: the actions it asked the mixer to cache, and nothing
 * else. It never stops all actions and never uncaches the root.
 *
 * **Where a speed lands, and what must stay at 1.** `setSpeed` writes one number
 * onto that playback's `AnimationAction.timeScale`; the mixer's own `timeScale`
 * belongs to whoever allocated the mixer and is never written here, only READ —
 * {@link wrapsCrossed} needs it to size a step. The two compose
 * multiplicatively —
 * `AnimationMixer.update` begins `deltaTime *= this.timeScale`, and each action
 * then scales by its own — which is exactly why a caller driving this backend
 * through `ClipPlayer` has to leave `mixer.timeScale` at 1: `ClipPlayer.tick`
 * has already folded clip speed, player speed and the global time scale into the
 * single multiplier it hands `setSpeed`, so a mixer-level scale would apply two
 * of those layers a second time. Rule SPEED-NON-NEGATIVE holds here as it does
 * across the seam: a negative or non-finite multiplier is REFUSED with a
 * `RangeError` rather than clamped.
 *
 * **`ended` is derived from state, never from three's `finished` event.** That
 * event fires nothing at all when an action is stopped, re-targeted or
 * crossfaded out, so an event-driven terminal condition would be total only for
 * the paths three announces. Here a playback is ended when its own clamped
 * playhead has reached the end of a `'once'` clip, or when it was released; both
 * are readable at any moment from `action.time` and this backend's own records,
 * and neither needs a listener. This module registers none.
 *
 * **One driver per playback.** The wrap count below is derived from the deltas
 * that came through {@link MeshClipBackend.advance}, so an `update` the mixer's
 * owner performs on its own moves `action.time` with no wrap accounted for. A
 * mixer carrying playbacks from here is driven from here.
 *
 * **A released playback freezes.** `AnimationAction.stop()` calls `reset()`,
 * which puts `action.time` back to 0, and three caches ONE action per
 * `(clip, root)` pair — so a second `play` of the same clip re-targets the same
 * object. A handle whose playback has been released therefore keeps answering
 * from a captured sample rather than from an action that has moved on or gone
 * back to zero (Rule ONE-ACTION-PER-CLIP).
 *
 * **`cycle` is counted from the step, not from the phase.** three reports a
 * wrapped `action.time` and nothing about how it got there, and the one step
 * `ClipPlayer`'s Rule STEP-BOUNDED clamps to — exactly one clip length — comes
 * back on the phase it started from. {@link wrapsCrossed} says why that makes a
 * phase comparison unusable here.
 *
 * **Ping-pong never reaches an action.** `AnimationLoopMode` spells `'once'` and
 * `'loop'`, and the mapping below is exhaustive over those two; any other value
 * is refused with a `RangeError` instead of falling through to a default.
 */

import { LoopOnce, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, AnimationMixer } from 'three';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { checkedLoopMode, checkedPlaybackSpeed } from './ClipBackend.js';
import type {
    ClipBackend,
    ClipPlayOptions,
    ClipPlayback,
    PlayheadSample,
    SupportsClipBlending,
} from './ClipBackend.js';

/** What a mesh backend is built over. */
export interface MeshClipBackendOptions {
    /**
     * The mixer to drive. Allocated, `timeScale`d and released by its owner; this
     * backend caches actions on it, calls `update`, and reads its `timeScale` to
     * size a step — it writes nothing on it.
     */
    readonly mixer: AnimationMixer;
    /**
     * The clips this backend can play, keyed by `AnimationClip.name`. A clip of no
     * usable length is not a clip this backend has — dividing a playhead by a zero
     * duration would make every phase `NaN`. The first entry under a name wins.
     */
    readonly clips: readonly AnimationClip[];
}

/** One clip in flight on the mixer, plus the bookkeeping a sample is read from. */
interface LivePlayback {
    readonly clipName: AnimationClipName;
    readonly clip: AnimationClip;
    readonly action: AnimationAction;
    /** Captured when the playback started, so a later `clip.duration` cannot move it. */
    readonly durationSeconds: number;
    readonly loop: AnimationLoopMode;
    /** The phase the last `advance` left, which the next one measures its step from. */
    lastPhase: number;
    cycle: number;
    /** `null` while live; the terminal sample once released. */
    frozen: PlayheadSample | null;
}

/**
 * Plays clips through an `AnimationMixer`, and blends between them.
 *
 * Several clips may be in flight at once — a crossfade has two — but only one per
 * clip name, because three caches one action per `(clip, root)`.
 */
export class MeshClipBackend implements ClipBackend, SupportsClipBlending {
    readonly #mixer: AnimationMixer;
    readonly #clips = new Map<AnimationClipName, AnimationClip>();
    readonly #live = new Map<AnimationClipName, LivePlayback>();
    /** The clips this backend asked the mixer to cache an action for. */
    readonly #cached = new Set<AnimationClip>();
    #disposed = false;

    constructor(options: MeshClipBackendOptions) {
        this.#mixer = options.mixer;
        for (const clip of options.clips) {
            if (!isUsableDuration(clip.duration) || this.#clips.has(clip.name)) {
                continue;
            }
            this.#clips.set(clip.name, clip);
        }
    }

    getDurationSeconds(clipName: AnimationClipName): number | null {
        return this.#clips.get(clipName)?.duration ?? null;
    }

    /**
     * @throws RangeError  when `options.loop` is not a loop mode this backend maps,
     *                     or `options.speed` is negative or not finite. Both are
     *                     checked before anything is started or replaced.
     */
    play(clipName: AnimationClipName, options?: ClipPlayOptions): ClipPlayback | null {
        if (this.#disposed) {
            return null;
        }
        const clip = this.#clips.get(clipName);
        if (clip === undefined) {
            return null;
        }
        const loop = checkedLoopMode(options?.loop ?? 'once');
        const speed = checkedPlaybackSpeed(options?.speed ?? 1, 'clip speed');

        const replaced = this.#live.get(clipName);
        if (replaced !== undefined) {
            this.#stop(replaced);
        }

        const action = this.#mixer.clipAction(clip);
        this.#cached.add(clip);
        action.reset();
        action.setLoop(
            loop === 'loop' ? LoopRepeat : LoopOnce,
            loop === 'loop' ? Number.POSITIVE_INFINITY : 1,
        );
        action.clampWhenFinished = loop === 'once';
        action.timeScale = speed;
        // `reset()` restores `enabled` and the playhead but not the weight, so an
        // action that was faded out would come back invisible without this.
        action.setEffectiveWeight(1);
        action.play();

        const record: LivePlayback = {
            clipName,
            clip,
            action,
            durationSeconds: clip.duration,
            loop,
            lastPhase: 0,
            cycle: 0,
            frozen: null,
        };
        this.#live.set(clipName, record);
        return this.#handle(record);
    }

    /**
     * Start `clipName` while fading out every OTHER playback in flight.
     *
     * Every other, rather than "the current one": a backend may hold several, and
     * there is no ordering among them that would make one of them THE current
     * playback. Each faded-out playback is terminal from this call onwards — three
     * keeps its action alive at falling weight, and disables it once the weight
     * reaches zero, but nothing will re-target it.
     *
     * @throws RangeError  when `fadeSeconds` is negative or not finite, or
     *                     `options` carry an unusable loop mode or speed.
     */
    crossfadeTo(
        clipName: AnimationClipName,
        fadeSeconds: number,
        options?: ClipPlayOptions,
    ): ClipPlayback | null {
        if (this.#disposed || !this.#clips.has(clipName)) {
            return null;
        }
        const fade = checkedFade(fadeSeconds);
        const outgoing = [...this.#live.values()].filter((record) => record.clipName !== clipName);

        const playback = this.play(clipName, options);
        if (playback === null) {
            return null;
        }
        this.#live.get(clipName)?.action.fadeIn(fade);
        for (const record of outgoing) {
            record.action.fadeOut(fade);
            this.#release(record);
        }
        return playback;
    }

    advance(deltaSeconds: number): void {
        if (this.#disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }
        this.#mixer.update(deltaSeconds);
        for (const record of this.#live.values()) {
            const phase = phaseOf(record);
            record.cycle += wrapsCrossed(record, deltaSeconds, this.#mixer.timeScale);
            record.lastPhase = phase;
        }
    }

    /**
     * Freeze every playback, stop its action and uncache it. Idempotent; a
     * disposed backend plays and advances nothing.
     *
     * `uncacheAction` per clip rather than `stopAllAction` or `uncacheRoot`: the
     * mixer may carry actions this backend never allocated, and those belong to
     * whoever did.
     */
    dispose(): void {
        // Idempotent by construction rather than by an early return: a second
        // call walks an emptied live set, and `uncacheAction` on a clip the mixer
        // no longer holds an action for is itself a no-op.
        this.#disposed = true;
        for (const record of [...this.#live.values()]) {
            this.#stop(record);
        }
        for (const clip of this.#cached) {
            this.#mixer.uncacheAction(clip);
        }
    }

    /** The handle a caller holds. Reads through `record`, so it survives its release. */
    #handle(record: LivePlayback): ClipPlayback {
        return {
            clipName: record.clipName,
            sample: () => sampleOf(record),
            setSpeed: (speed: number) => {
                // Checked even for a released playback, so a sign error is refused
                // wherever it is written; applied only while the action is still
                // this playback's to re-target.
                const checked = checkedPlaybackSpeed(speed, 'clip speed');
                if (record.frozen === null) {
                    record.action.timeScale = checked;
                }
            },
            stop: () => {
                this.#stop(record);
            },
        };
    }

    /** Release `record` and put its action back. A no-op once it is terminal. */
    #stop(record: LivePlayback): void {
        if (record.frozen !== null) {
            return;
        }
        this.#release(record);
        record.action.stop();
    }

    /**
     * Capture `record`'s terminal sample and drop it from the live set.
     *
     * A delete by key is exact here: the map holds at most one record per clip
     * name, a record sits in it only while unfrozen, and the guard above returns
     * before this line for a record that is already terminal. The release cannot
     * be deferred past the registration of a replacement either — `play` re-uses
     * three's ONE cached action for the clip, so the outgoing playback has to let
     * go of it before the incoming one resets it.
     */
    #release(record: LivePlayback): void {
        if (record.frozen !== null) {
            return;
        }
        record.frozen = { phase: phaseOf(record), cycle: record.cycle, ended: true };
        this.#live.delete(record.clipName);
    }
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** The playhead right now, or the sample captured when this playback was released. */
function sampleOf(record: LivePlayback): PlayheadSample {
    if (record.frozen !== null) {
        return record.frozen;
    }
    const phase = phaseOf(record);
    return { phase, cycle: record.cycle, ended: record.loop === 'once' && phase >= 1 };
}

/**
 * `action.time` as a phase in `[0, 1]`.
 *
 * Both guards defend against state this backend does not own. The divisor is the
 * duration CAPTURED when the playback started, while three keeps reading
 * `clip.duration` live — and the clip list is shared by reference with the asset
 * cache (`ModelInstance` hands back the cached asset's `animations`), so
 * `clip.duration` is public, mutable state. Lengthen a clip mid-playback and
 * `action.time` runs past the captured divisor; the clamp is what keeps the
 * seam's `[0, 1]` promise when it does. A non-finite reading likewise comes from
 * outside — the mixer is shared, and its owner may update it with any delta —
 * and 0 is the one answer that keeps the promise.
 *
 * A finished `LoopOnce` action is held at exactly `duration` by
 * `clampWhenFinished`, so phase 1 is reached rather than merely approached: a
 * mark compiled to phase 1 fires.
 */
function phaseOf(record: LivePlayback): number {
    const raw = record.action.time / record.durationSeconds;
    if (!Number.isFinite(raw)) {
        return 0;
    }
    return Math.min(1, raw);
}

/**
 * How many cycle boundaries `record` crossed during the `mixer.update` that just
 * ran.
 *
 * Counted from the step the playback was ASKED to take, not from the phase it
 * came back with. A phase DECREASE cannot carry this: a step of exactly one clip
 * length — which is the step `ClipPlayer`'s Rule STEP-BOUNDED clamps to — leaves
 * the playhead on the phase it started from, and a step worth several cycles
 * comes back as one wrapped `action.time` with nothing to say how many it
 * crossed. A backend blind to the first would hand the scheduler an unchanged
 * sample and drop every mark in the clip for that frame.
 *
 * The step is `deltaSeconds` through both scales three applies —
 * `AnimationMixer.update` begins `deltaTime *= this.timeScale`, and each action
 * then scales by its own effective one — so the difference in whole cycles
 * between where the playhead was and where it was sent counts the boundaries.
 *
 * `'once'` returns 0 outright: a clip that cannot wrap cannot count one, however
 * far past its end it is driven. `Math.max` and the finite guard hold the
 * seam's "never decreases" promise against a `mixer.timeScale` this backend does
 * not own — that value is the mixer owner's, and it can be anything at all.
 */
function wrapsCrossed(record: LivePlayback, deltaSeconds: number, mixerTimeScale: number): number {
    if (record.loop === 'once') {
        return 0;
    }
    const stepPhases =
        (deltaSeconds * mixerTimeScale * record.action.getEffectiveTimeScale()) /
        record.durationSeconds;
    if (!Number.isFinite(stepPhases)) {
        return 0;
    }
    return Math.max(0, Math.floor(record.lastPhase + stepPhases) - Math.floor(record.lastPhase));
}

function isUsableDuration(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

/** `value` if it is a usable fade length, or a `RangeError`. */
function checkedFade(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(
            `crossfade length must be a finite number of at least 0, received ${value}`,
        );
    }
    return value;
}
