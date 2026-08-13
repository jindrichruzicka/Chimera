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
 * back to zero (Rule ONE-ACTION-PER-CLIP). That freeze is bookkeeping and says
 * nothing about the screen: `stop` hands the binding back and the model returns
 * to its original state, while `hold` leaves the action posing exactly where it
 * was.
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
 *
 * **The weight ramps are this backend's, not three's.** `fadeIn` and `fadeOut`
 * schedule a multiplier interpolant between HARDCODED endpoints — `fadeOut` from
 * 1, `fadeIn` from 0 — regardless of where the action's weight actually is. Three
 * visible artefacts follow from that: a blend interrupted a quarter of the way in
 * snaps back to nearly full weight, a blend with nothing outgoing dissolves the
 * model out of its rest pose, and a clip that is still fading out cannot be
 * brought back without restarting it at phase 0 and weight 0. So
 * a ramp here is a `(from, to, duration)` on the record, stepped once per
 * {@link MeshClipBackend.advance} and written through `setEffectiveWeight` — it
 * starts wherever the action already is, and this module schedules no three fade
 * interpolant at all. The ramp is stepped by the RAW delta, so a blend length is
 * real time regardless of what the speed stack is doing to the clip.
 *
 * **Rule POSING-RELEASE.** A crossfaded-out playback is terminal — its handle is
 * frozen — but its action is still posing the model while its weight falls, so
 * the record stays owned in `#posing` rather than being dropped on the floor. A
 * posing action holds a `PropertyMixer` binding lent from the component-owned
 * clone (Invariant #21), so ending that posing is not optional: a path that
 * forgot would leave the binding held for the life of the mixer. Ending it is
 * `#stop`, and the cases under `describe('crossfadeTo')` are what say which
 * calls reach it.
 *
 * Two kinds of record pose, and what tells them apart is where their ramp is
 * AIMED, not whether they have one. A record being ramped to 0 is a blend tail:
 * a second blend hard-stops it, and otherwise its arriving ramp is what ends it.
 * Everything else is a HELD pose — a last frame, at the weight it was playing
 * at, indefinitely — and a held pose may well carry a ramp: a `'once'` clip
 * shorter than the blend that brought it in finishes with its own fade-IN still
 * running, and that ramp's arrival settles the pose rather than ending it. A
 * blend fades out of a held pose; a stop, a zero-length fade or `dispose` ends
 * one outright. Both kinds end at `#stop`, and the cases under
 * `describe('crossfadeTo')` are what say which calls reach it.
 */

import { LoopOnce, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, AnimationMixer } from 'three';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { checkedFade, checkedLoopMode, checkedPlaybackSpeed } from './ClipBackend.js';
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

/** A weight ramp this backend drives itself, one step per `advance`. */
interface WeightRamp {
    /** Where the action's weight was when the ramp was installed. */
    readonly fromWeight: number;
    readonly toWeight: number;
    readonly durationSeconds: number;
    elapsedSeconds: number;
}

/** One clip in flight on the mixer, plus the bookkeeping a sample is read from. */
interface LivePlayback {
    readonly clipName: AnimationClipName;
    readonly clip: AnimationClip;
    readonly action: AnimationAction;
    /** Captured when the playback started, so a later `clip.duration` cannot move it. */
    readonly durationSeconds: number;
    readonly loop: AnimationLoopMode;
    /**
     * The rate this playback was STARTED at, which its action is seated back to
     * when it is released. A released action is re-targeted by nothing, so
     * leaving it at whatever the last tick wrote would let it spend a whole fade
     * at Rule STEP-BOUNDED's emergency rate — a `bounded / raw` that was valid
     * for exactly one frame's delta.
     */
    readonly startSpeed: number;
    /** The phase the last `advance` left, which the next one measures its step from. */
    lastPhase: number;
    cycle: number;
    /** `null` while live; the terminal sample once released. */
    frozen: PlayheadSample | null;
    /** The ramp this record's weight is on, or `null` at a settled weight. */
    ramp: WeightRamp | null;
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
    /**
     * The records that are terminal but still posing the model: crossfaded out,
     * frozen, weight falling. Owned here under Rule POSING-RELEASE rather than
     * dropped, because each still lends a `PropertyMixer` binding.
     */
    readonly #posing = new Map<AnimationClipName, LivePlayback>();
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

        this.#stopExisting(clipName);

        const action = this.#mixer.clipAction(clip);
        this.#cached.add(clip);
        action.reset();
        this.#seat(action, loop, speed);
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
            startSpeed: speed,
            lastPhase: 0,
            cycle: 0,
            frozen: null,
            ramp: null,
        };
        this.#live.set(clipName, record);
        return this.#handle(record);
    }

    /**
     * Start `clipName` while fading out every OTHER playback in flight, and
     * every HELD pose.
     *
     * Every other, rather than "the current one": a backend may hold several, and
     * there is no ordering among them that would make one of them THE current
     * playback. Each faded-out playback's handle is terminal from this call
     * onwards, while its action keeps posing under Rule POSING-RELEASE.
     *
     * **A held pose is something to fade out of.** What a blend has to make
     * continuous is what is on the screen, and a `'once'` clip that ended and was
     * held is on the screen exactly as a live clip is — its handle terminal, its
     * action paused on its last frame. Fading out of it is the whole point of a
     * one-shot that ends and blends back: hard-stopping it instead would move the
     * bind-pose flash onto the transition rather than remove it. A record already
     * being ramped to 0 is the other population and keeps being hard-stopped; the
     * split is spelled out under Rule POSING-RELEASE.
     *
     * **A zero-length fade is a cut, and takes a different path.** `fadeOut(0)`
     * is not one: it schedules a degenerate ramp whose action reaches weight 0
     * and `enabled = false` on the next update, while `_deactivateAction` is
     * never called — the `PropertyMixer` binding is never handed back,
     * `restoreOriginalState` never runs, and `action.time` is never reset. So a
     * fade of 0 starts the incoming clip with no ramp and hard-stops every
     * outgoing playback and every held pose, which is what makes it
     * observationally a cut.
     *
     * **What the incoming clip does depends on what is already there.** With
     * something fading out — a live playback or a held pose, since both are on
     * the screen — it ramps in from 0, which is the ordinary crossfade. With
     * nothing fading out it starts at full weight: a ramp from 0 there would
     * dissolve the model out of its rest pose, and one against a pose left at
     * full weight would pop the other way, because three normalizes the
     * accumulation. And when the clip is one this backend is still fading OUT,
     * it is resumed rather than restarted: same action, playhead untouched,
     * weight ramped up from where it already is.
     *
     * **The refusal comes first, the fail-soft guard second.** A bad fade throws
     * whether or not this backend has the clip and whether or not it is disposed;
     * the reverse order would answer a caller's sign error with `null`. The
     * incoming clip is started before anything is released, so an unusable loop
     * mode or speed also refuses with nothing yet released — and so that the
     * binding a swap shares stays lent, which is what stops `restoreOriginalState`
     * firing in the middle of a transition.
     *
     * @throws RangeError  when `fadeSeconds` is negative or not finite, or
     *                     `options` carry an unusable loop mode or speed.
     */
    crossfadeTo(
        clipName: AnimationClipName,
        fadeSeconds: number,
        options?: ClipPlayOptions,
    ): ClipPlayback | null {
        const fade = checkedFade(fadeSeconds);
        if (this.#disposed || !this.#clips.has(clipName)) {
            return null;
        }
        // Checked here as well as inside `play`, because the resume path below
        // does not go through it and a refusal must land before anything is
        // started, resumed or released.
        const loop = checkedLoopMode(options?.loop ?? 'once');
        const speed = checkedPlaybackSpeed(options?.speed ?? 1, 'clip speed');

        const outgoing = [...this.#live.values()].filter((record) => record.clipName !== clipName);
        // A posing record is resumable unless its action is parked on the last
        // frame of a finished `'once'` clip: `clampWhenFinished` holds it there,
        // so resuming would pose that frame for ever and play nothing. Restart
        // is the only answer that plays the clip a caller asked for, and `play`
        // ends the pose on its way through `#stopExisting`.
        const posing = fade > 0 ? this.#posing.get(clipName) : undefined;
        const resumable = posing !== undefined && !isClampedAtEnd(posing) ? posing : undefined;

        const playback =
            resumable === undefined
                ? this.play(clipName, { loop, speed })
                : this.#resume(resumable, loop, speed, fade);
        if (playback === null) {
            return null;
        }

        // The posing set holds two populations and a blend owes them opposite
        // things. One already being ramped to 0 is on its way out under an
        // earlier blend, and is terminal now at whatever weight it reached:
        // overlapping blends must not accumulate actions that nothing will ever
        // re-target. Everything else is a held pose — put there by `hold`, at
        // the weight it was playing at — so a fade ramps it out like any other
        // thing on screen, whether or not a fade-in of its own is still running.
        let fadingOut = 0;
        for (const record of [...this.#posing.values()]) {
            // Defensive rather than a case: both paths that could reach the
            // incoming clip's own posing record take it out first — `#resume`
            // deletes it, `play` stops it through `#stopExisting` — and ramping
            // it to 0 here would fade out the very action the incoming playback
            // has just taken over.
            if (record.clipName === clipName) {
                continue;
            }
            if (fade > 0 && !isFadingOut(record)) {
                this.#rampTo(record, 0, fade);
                fadingOut += 1;
                continue;
            }
            this.#stop(record);
        }

        for (const record of outgoing) {
            if (fade === 0) {
                this.#stop(record);
                continue;
            }
            this.#release(record);
            this.#rampTo(record, 0, fade);
            fadingOut += 1;
        }
        // Counted rather than read off the live set, because a held pose fades
        // out without ever having been in it.
        if (fade > 0 && resumable === undefined && fadingOut > 0) {
            const incoming = this.#live.get(clipName);
            if (incoming !== undefined) {
                incoming.ramp = {
                    fromWeight: 0,
                    toWeight: 1,
                    durationSeconds: fade,
                    elapsedSeconds: 0,
                };
                applyRamp(incoming);
            }
        }
        return playback;
    }

    advance(deltaSeconds: number): void {
        if (this.#disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }
        this.#stepRamps(deltaSeconds);
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
        // call walks two emptied sets, and `uncacheAction` on a clip the mixer
        // no longer holds an action for is itself a no-op.
        this.#disposed = true;
        // The posing set as well as the live one, ahead of the uncache loop.
        // `uncacheAction` would deactivate a posing action too, so the model
        // returns to its original state either way — but only a stop resets the
        // playhead, and a record this backend owns is released by this backend.
        for (const record of [...this.#live.values(), ...this.#posing.values()]) {
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
            hold: () => {
                this.#hold(record);
            },
        };
    }

    /**
     * Release `record` and put its action back — the one way a record's posing
     * ends under Rule POSING-RELEASE, whatever called it.
     *
     * Reaches a FROZEN record, unlike the release below: a crossfaded-out
     * playback is frozen the moment the blend starts and is exactly the thing a
     * caller cancels a blend by stopping. What it must not do is reach an action
     * this record no longer owns — three caches one action per `(clip, root)`,
     * so a later playback of the same clip is driving the very action a stale
     * handle would otherwise stop.
     */
    #stop(record: LivePlayback): void {
        const owned =
            this.#live.get(record.clipName) === record ||
            this.#posing.get(record.clipName) === record;
        this.#release(record);
        if (!owned) {
            return;
        }
        this.#posing.delete(record.clipName);
        record.ramp = null;
        record.action.stop();
    }

    /**
     * End `record` while leaving its action posing what it last wrote.
     *
     * Guarded before it writes anything, and that is not defensive tidiness. A
     * terminal record is exactly a record that is out of the live set — `#release`
     * is what freezes one and what removes it — so this one check is also the
     * "does this record still own its action" check that {@link MeshClipBackend#stop}
     * spells out. It has to be, because three caches ONE action per
     * `(clip, root)` and a stale handle names whatever is playing that clip now:
     * `ClipPlayer` fans its `clip-end` batch out BEFORE it holds, so a handler
     * that replays the clip from `onClipEnd` would otherwise have its fresh
     * playback paused for ever, under a sample reporting an ordinary playhead.
     *
     * The pause is what makes a hold a hold: a released record is out of the live
     * set for BOOKKEEPING while its action is still one the mixer advances, so a
     * held looping clip would otherwise keep animating under a frozen sample.
     * three reads `paused` as an effective time scale of 0.
     */
    #hold(record: LivePlayback): void {
        if (record.frozen !== null) {
            return;
        }
        record.action.paused = true;
        this.#release(record);
    }

    /**
     * Capture `record`'s terminal sample, move it out of the live set and into
     * the posing one, and seat its action back to the rate it started at.
     *
     * A delete by key is exact here: the map holds at most one record per clip
     * name, a record sits in it only while unfrozen, and the guard above returns
     * before this line for a record that is already terminal. The release cannot
     * be deferred past the registration of a replacement either — `play` re-uses
     * three's ONE cached action for the clip, so the outgoing playback has to let
     * go of it before the incoming one resets it.
     *
     * The action is NOT stopped here. It keeps posing the model at a falling
     * weight, which is the whole point of a crossfade; {@link MeshClipBackend#stop}
     * is what ends that.
     */
    #release(record: LivePlayback): void {
        if (record.frozen !== null) {
            return;
        }
        record.frozen = { phase: phaseOf(record), cycle: record.cycle, ended: true };
        this.#live.delete(record.clipName);
        this.#posing.set(record.clipName, record);
        record.action.timeScale = record.startSpeed;
    }

    /**
     * Take over the action a posing `previous` record holds: a new live record
     * on the same action, its playhead untouched, its weight ramped from where
     * it is up to 1.
     *
     * A new record rather than an un-freeze, because `previous`'s handle is
     * terminal and `PlayheadSample.ended` never reverts. The captured divisor
     * comes across unchanged: the action's playhead has been measured against it
     * since the clip started, and swapping in a re-read `clip.duration` here
     * would move the reported phase without the playhead moving at all.
     */
    #resume(
        previous: LivePlayback,
        loop: AnimationLoopMode,
        speed: number,
        fadeSeconds: number,
    ): ClipPlayback {
        this.#posing.delete(previous.clipName);
        this.#seat(previous.action, loop, speed);

        const record: LivePlayback = {
            clipName: previous.clipName,
            clip: previous.clip,
            action: previous.action,
            durationSeconds: previous.durationSeconds,
            loop,
            startSpeed: speed,
            lastPhase: 0,
            cycle: 0,
            frozen: null,
            ramp: null,
        };
        record.lastPhase = phaseOf(record);
        this.#live.set(record.clipName, record);
        this.#rampTo(record, 1, fadeSeconds);
        return this.#handle(record);
    }

    /** Release whatever this backend still holds for `clipName`, live or posing. */
    #stopExisting(clipName: AnimationClipName): void {
        // Posing first: releasing a live record puts it in the posing map under
        // this same key, which would otherwise leave a posing action owned by
        // nothing and running for the life of the mixer.
        const posing = this.#posing.get(clipName);
        if (posing !== undefined) {
            this.#stop(posing);
        }
        const live = this.#live.get(clipName);
        if (live !== undefined) {
            this.#stop(live);
        }
    }

    /**
     * Point `action` at one loop mode and one rate, and un-pause it. Never
     * touches its weight.
     *
     * The un-pause is what lets a HELD action be taken over: `play` reaches
     * `reset()` first, which clears the flag, but a resume does not, and a
     * resumed action that stayed paused would pose its last frame for ever.
     */
    #seat(action: AnimationAction, loop: AnimationLoopMode, speed: number): void {
        action.paused = false;
        action.setLoop(
            loop === 'loop' ? LoopRepeat : LoopOnce,
            loop === 'loop' ? Number.POSITIVE_INFINITY : 1,
        );
        action.clampWhenFinished = loop === 'once';
        action.timeScale = speed;
    }

    /** Ramp `record` from the weight it has now to `toWeight`, and seat it there. */
    #rampTo(record: LivePlayback, toWeight: number, durationSeconds: number): void {
        record.ramp = {
            fromWeight: usableWeight(record.action.getEffectiveWeight()),
            toWeight,
            durationSeconds,
            elapsedSeconds: 0,
        };
        applyRamp(record);
    }

    /**
     * Step every ramp by `deltaSeconds` and end the posing of whatever finished.
     *
     * Runs BEFORE `mixer.update`, so the weight the frame is rendered at is this
     * frame's rather than the previous one's, and a record that reached 0 is
     * deactivated before it can pose anything again.
     */
    #stepRamps(deltaSeconds: number): void {
        // The live pass iterates the map itself: it mutates records and actions,
        // never the maps, and this runs at 60 Hz on a backend that is usually
        // ramping nothing at all.
        for (const record of this.#live.values()) {
            stepRamp(record, deltaSeconds);
        }
        if (this.#posing.size === 0) {
            return;
        }
        // The posing pass needs a snapshot, because ending a record's posing
        // deletes it from the map being walked. A record is released when a
        // FADE-OUT ramp arrives on this step: never merely because it has no
        // ramp, since a held playback poses with none at all and must survive
        // every advance, and never merely because SOME ramp arrived, since a
        // clip that finished before its own fade-in did is held with that ramp
        // still running — its arrival settles the pose rather than ending it.
        // Read before the step, which clears an arriving ramp.
        for (const record of [...this.#posing.values()]) {
            const leaving = isFadingOut(record);
            if (stepRamp(record, deltaSeconds) && leaving) {
                this.#stop(record);
            }
        }
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

/**
 * Whether `record`'s playhead has reached the end of a `'once'` clip.
 *
 * Read off the playhead rather than off `frozen.ended`, which every released
 * record carries: what matters here is where the ACTION is, and
 * `clampWhenFinished` parks a finished `'once'` action at exactly its clip
 * length, so resuming one poses that frame for ever. A `'loop'` clip never
 * qualifies however far it has run, which `resumes a looping posing clip that
 * shared state pushed to phase 1` is what says.
 */
function isClampedAtEnd(record: LivePlayback): boolean {
    return record.loop === 'once' && phaseOf(record) >= 1;
}

/**
 * Whether a blend is taking `record` out — a ramp aimed at 0.
 *
 * The posing set's two populations are told apart here rather than by whether a
 * ramp is present at all: a `'once'` clip shorter than the blend that brought it
 * in finishes while its own fade-IN is still running, so it is HELD with a
 * rising ramp, and the mere presence of one would classify the commonest short
 * one-shot as a blend tail. Only the fade-out paths aim a ramp at 0.
 */
function isFadingOut(record: LivePlayback): boolean {
    return record.ramp !== null && record.ramp.toWeight === 0;
}

/**
 * Move `record`'s ramp on by `deltaSeconds`, clearing it once it has arrived.
 *
 * @returns whether the ramp arrived on THIS call. A record with no ramp arrives
 *          at nothing and answers `false`.
 */
function stepRamp(record: LivePlayback, deltaSeconds: number): boolean {
    const { ramp } = record;
    if (ramp === null) {
        return false;
    }
    ramp.elapsedSeconds += deltaSeconds;
    applyRamp(record);
    if (ramp.elapsedSeconds < ramp.durationSeconds) {
        return false;
    }
    record.ramp = null;
    return true;
}

/**
 * Write `record`'s ramp position onto its action.
 *
 * Linear in real time, and exact at both ends: `from + (to - from) * 1` is `to`
 * itself, so a finished ramp settles on the weight it was aimed at rather than
 * near it. A ramp of no length is already finished — every caller here passes a
 * positive one, and the guard is what keeps a zero from producing `NaN`.
 */
function applyRamp(record: LivePlayback): void {
    const ramp = record.ramp;
    if (ramp === null) {
        return;
    }
    const progress =
        ramp.durationSeconds > 0 ? Math.min(1, ramp.elapsedSeconds / ramp.durationSeconds) : 1;
    record.action.setEffectiveWeight(
        ramp.fromWeight + (ramp.toWeight - ramp.fromWeight) * progress,
    );
}

/**
 * `value` as a weight a ramp can start from. The reading comes from three —
 * `_effectiveWeight` is whatever the last update or the last write left — and a
 * ramp seeded with a non-finite or out-of-range one would put the action at a
 * weight no frame should render.
 */
function usableWeight(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}
