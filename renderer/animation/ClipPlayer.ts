/**
 * renderer/animation/ClipPlayer.ts
 *
 * Composes the compile half and the marker scheduler into the object a frame
 * loop drives: it owns one {@link ClipBackend}, the clips in flight on it, the
 * three-layer speed stack, and the fan-out of every batch the scheduler returns.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **The handler surface carries no dispatcher.** {@link ClipMarkerHandlers} take
 * a marker event and nothing else — no `SendAction`, no `EngineAction`, no
 * `PlayerId`, no tick — so the rule that no animation event may gate an action
 * (`docs/coding-standards-sections/react-three-fiber.md`) is held by parameters
 * that do not exist rather than by a lint rule someone could disable. Gameplay consequences are beat-driven and belong
 * to the simulation.
 *
 * **Nothing here reads a store, a clock or a snapshot.** The dilation multiplier
 * arrives through the injected `getTimeScale`, and a handler fault leaves through
 * the injected `report`. Both are parameters so this module keeps depending on no
 * package at all, which is what the directory's purity census asserts.
 *
 * ### One tick, six steps, in this order
 *
 * 1. **Scale.** Each playback's rate is `clipSpeed x playerSpeed x timeScale` —
 *    {@link effectiveClipSpeed}. The time scale is read ONCE per tick, so every
 *    clip on the backend is paced against the same reading.
 * 2. **Bound.** Rule STEP-BOUNDED clamps the step to
 *    {@link boundedStepSeconds}, computed PER PLAYBACK against that playback's
 *    own clip length. A single shared minimum would let the shortest clip on a
 *    mixer decide how far a four-second clip may move in one frame. The bound
 *    reaches the backend as a speed, because one `advance` moves every playback
 *    the backend owns and per-playback speed is the only per-clip channel a
 *    shared mixer has.
 * 3. **Sample before advancing.** The scheduler steps FROM where the playhead
 *    actually is, not from where the previous tick left it. The two agree while
 *    nothing else touches the playback and diverge the moment something does — a
 *    crossfade re-seating an action, a backend re-using a playback — and a
 *    playhead that was moved by someone else should fire no marks for the span it
 *    skipped.
 * 4. **Advance.** One `backend.advance(rawDelta)` for the whole backend.
 * 5. **Step.** One `stepScheduler` per playback, which is the only producer of
 *    `clip-end`.
 * 6. **Fan out** in array order, under Rule HANDLER-ISOLATION: a throwing handler
 *    is reported once per `(player, mark)` and never re-thrown, and the events
 *    after it are still delivered. Once per mark rather than once per throw
 *    because a mark that fires every frame would otherwise fill a log with one
 *    fault.
 *
 * **A clip that ends is HELD, not stopped.** The two are terminal alike, and the
 * clip leaves the active set either way; what differs is the screen. Stopping a
 * finished `'once'` clip hands its resources back, which on a mesh backend
 * restores the model's original state synchronously — a bind-pose flash on the
 * same tick the `clip-end` handler runs, undoing the last frame
 * `clampWhenFinished` was holding. So the playback is held and kept, and the
 * pose comes down when a caller asks for it to. Every OTHER teardown here still
 * stops, because "play nothing" legitimately means the model goes back to where
 * it started.
 *
 * Rule SPEED-NON-NEGATIVE applies to both layers this class owns, through the
 * seam's own `checkedPlaybackSpeed` — one definition of the refusal, shared with
 * the backends that make it rather than restated here.
 */

import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { checkedFade, checkedPlaybackSpeed, supportsBlending } from './ClipBackend.js';
import type {
    ClipBackend,
    ClipPlayback,
    PlayheadSample,
    SupportsClipBlending,
} from './ClipBackend.js';
import { compileClipTimeline } from './ClipTimeline.js';
import type { ClipSheetSource, CompiledMark } from './ClipTimeline.js';
import { initSchedulerState, stepScheduler, terminateScheduler } from './clipMarkerScheduler.js';
import type {
    ClipEndEvent,
    MarkerEvent,
    NotifyEvent,
    PassageEndEvent,
    PassageEvent,
    PassageTickEvent,
    SchedulerState,
} from './clipMarkerScheduler.js';

/**
 * The ceiling on the rate a backend is handed. High enough that no authored
 * slow-motion or speed-up reaches it, and low enough to keep a stray `1e9` from
 * reaching a mixer as one. How far a clip may actually move in a frame is
 * {@link boundedStepSeconds}'s job, not this one's.
 *
 * Applied in exactly one place — {@link effectiveClipSpeed}, on the PRODUCT of
 * the three layers. A second clamp on each layer as it is set would be invisible
 * behind this one, and would silently change what a large clip speed times a
 * small player speed comes to.
 */
export const MAX_CLIP_SPEED = 100;

/**
 * What a caller wants told about a clip. Every field is optional: a clip may be
 * played purely for its visuals.
 *
 * There is deliberately no dispatcher, action, player id or tick on any of these
 * signatures — see the module header.
 */
export interface ClipMarkerHandlers {
    readonly onNotify?: (event: NotifyEvent) => void;
    readonly onPassageStart?: (event: PassageEvent) => void;
    readonly onPassageTick?: (event: PassageTickEvent) => void;
    readonly onPassageEnd?: (event: PassageEndEvent) => void;
    readonly onClipEnd?: (event: ClipEndEvent) => void;
}

/** What a player is built over. Both functions are injected, never imported. */
export interface ClipPlayerOptions {
    /** The backend this player owns; disposed with it. */
    readonly backend: ClipBackend;
    /**
     * The global dilation multiplier, read once per tick. `1` is real time, `0.25`
     * quarter speed. A reading that is not a usable multiplier falls back to real
     * time rather than freezing or reversing every clip on the backend.
     */
    readonly getTimeScale: () => number;
    /** Where a compile warning or a throwing handler is reported. */
    readonly report: (message: string, cause?: unknown) => void;
}

/** One request to start a clip. */
export interface ClipPlayRequest {
    /** Which clip to play. */
    readonly clipName: AnimationClipName;
    /** The sheet carrying this clip's marks, if it has one. A clip with none plays unmarked. */
    readonly sheet?: ClipSheetSource | null;
    /** What to tell the caller about. */
    readonly handlers?: ClipMarkerHandlers;
    /** Overrides the sheet's authored loop mode. */
    readonly loop?: AnimationLoopMode;
    /** The clip's own layer of the speed stack. Defaults to 1. */
    readonly speed?: number;
    /**
     * Seconds to blend out of the outgoing clip and into this one. `0` — the
     * default — cuts.
     *
     * REAL TIME, and deliberately so: it does not compose with the dilation
     * multiplier, so a blend takes as long in a slowed-down scene as it does at
     * full speed. Read by {@link ClipPlayer.transitionTo} — which decides what a
     * duration comes to against the backend and what is in flight, under
     * `describe('transitionTo — the blend')`. {@link ClipPlayer.play} adds a
     * clip rather than replacing what is there, and does not read it at all.
     *
     * @throws RangeError  when negative or not finite, at the layer it was
     *                     written and before anything is started or released.
     */
    readonly blendSeconds?: number;
}

/**
 * The rate one playback runs at: the three layers multiplied, clamped into
 * `[0, MAX_CLIP_SPEED]`.
 *
 * `timeScale` is the one layer that is not validated at its setter — it arrives
 * from an injected getter every tick — so a reading that is not a usable
 * multiplier is treated as real time here. The other two layers cannot be
 * negative or non-finite: {@link ClipPlayer.setClipSpeed} and
 * {@link ClipPlayer.setPlayerSpeed} refuse those outright.
 */
export function effectiveClipSpeed(
    clipSpeed: number,
    playerSpeed: number,
    timeScale: number,
): number {
    const scale = Number.isFinite(timeScale) && timeScale >= 0 ? timeScale : 1;
    return Math.min(MAX_CLIP_SPEED, clipSpeed * playerSpeed * scale);
}

/**
 * Rule STEP-BOUNDED: how far one playback may move in a single step.
 *
 * Bounded by the clip's OWN length, so an enormous delta — a resumed tab, a
 * stalled frame — costs one wrap rather than a batch per skipped cycle, while a
 * long clip sharing a backend with a short one keeps its own bound.
 */
export function boundedStepSeconds(
    scaledDeltaSeconds: number,
    clipDurationSeconds: number,
): number {
    return Math.min(scaledDeltaSeconds, clipDurationSeconds);
}

/** One clip in flight, with everything the tick pass needs about it. */
interface ActiveClip {
    readonly clipName: AnimationClipName;
    readonly playback: ClipPlayback;
    readonly durationSeconds: number;
    readonly marks: readonly CompiledMark[];
    readonly handlers: ClipMarkerHandlers;
    clipSpeed: number;
    scheduler: SchedulerState;
    /** The sample taken before the shared advance, which the next step is seated at. */
    seatedAt: PlayheadSample;
}

/**
 * Drives clips on one backend and turns their playheads into marker events.
 *
 * Several clips may be in flight at once, each with its own timeline, scheduler
 * and clip speed: {@link ClipPlayer.play} adds one and leaves the rest alone.
 * {@link ClipPlayer.transitionTo} is the other shape — become the only clip —
 * and {@link ClipPlayer.stopAll} is how a caller plays nothing.
 */
export class ClipPlayer {
    readonly #backend: ClipBackend;
    readonly #getTimeScale: () => number;
    readonly #report: (message: string, cause?: unknown) => void;
    readonly #active = new Map<AnimationClipName, ActiveClip>();
    /**
     * The playbacks a clip END left posing: terminal, out of the active set, and
     * still on their last frame. Held here rather than dropped, because the
     * backend's resources are behind them and only this player knows when they
     * stop being wanted.
     */
    readonly #posing = new Map<AnimationClipName, ClipPlayback>();
    /**
     * The playbacks a BLEND left fading out. Kept apart from the map above, and
     * that separation is load-bearing rather than tidy: `transitionTo` refuses to
     * blend into a clip it is POSING — a finished clip resumed mid-hold stays on
     * its last frame for ever — while a clip that is fading out is exactly the
     * one a backend can resume, so reading one map for both would downgrade every
     * second transition of an A/B alternation to a cut.
     *
     * An entry outlives its fade: nothing prunes it when the ramp arrives,
     * because the handle is terminal either way and its `stop` is then a no-op.
     * It exists so `stopAll` and `dispose` can reach a blend that is still on
     * screen.
     */
    readonly #fading = new Map<AnimationClipName, ClipPlayback>();
    /** Marks whose handler already reported a fault, so it reports once, not once a frame. */
    readonly #reportedMarks = new Set<AnimationMarkName>();
    #reportedClipEnd = false;
    #playerSpeed = 1;
    #disposed = false;

    constructor(options: ClipPlayerOptions) {
        this.#backend = options.backend;
        this.#getTimeScale = options.getTimeScale;
        this.#report = options.report;
    }

    /** The clips in flight, in the order they started. */
    get activeClips(): readonly AnimationClipName[] {
        return [...this.#active.keys()];
    }

    /**
     * Start `request.clipName`, replacing any live playback of the same clip.
     *
     * @returns `false` when the backend has no such clip, in which case nothing
     *          changed — a live playback of that clip keeps running.
     * @throws RangeError  when `request.speed` is negative or not finite.
     */
    play(request: ClipPlayRequest): boolean {
        if (this.#disposed) {
            return false;
        }
        const started = this.#start(request);
        if (started === null) {
            return false;
        }
        if (started.replaced !== undefined) {
            this.#release(started.replaced, 'clip-changed');
        }
        // After the new playback is registered, so the backend has already taken
        // the clip's action over: what is released here is the bookkeeping, and
        // on a backend where the two share one action the release is a no-op.
        this.#releasePosing(request.clipName);

        for (const warning of started.warnings) {
            this.#report(warning);
        }
        return true;
    }

    /**
     * Start `request.clipName` as the ONLY clip: every other clip in flight is
     * closed with `'clip-changed'`, and everything on screen that is not being
     * played comes down with them.
     *
     * The order below is the whole of this method's contract.
     *
     * 1. **Every refusal first.** A bad speed or an unusable blend length throws
     *    and an unplayable clip answers `false`, with nothing started, released
     *    or held — same as {@link ClipPlayer.play}.
     * 2. **Start the incoming playback**, so a backend that shares one resource
     *    across a swap has the incoming clip holding it before the outgoing lets
     *    go.
     * 3. **Register the incoming entry**, and only THEN release the others.
     *    Releasing fans out, and a handler that plays a clip from that fan-out
     *    must win — that is what `#forget`'s identity check exists for. The other
     *    order overwrites the handler's entry and strands its playback.
     *
     * The release of the others is unconditional. `play` releases only the entry
     * of the same name and a backend's `play` stops only that clip's playback, so
     * a transition that leaned on either would leave both clips live at full
     * weight for ever: an averaged pose that never resolves, the outgoing clip's
     * marks firing indefinitely, and a `passage-start` a `'loop'` clip never
     * closes.
     *
     * @returns `false` when the backend has no such clip, or the player is
     *          disposed — a caller telling those apart reads
     *          {@link ClipPlayer.isDisposed}.
     * @throws RangeError  when `request.speed` is negative or not finite, or
     *                     `request.blendSeconds` is.
     */
    transitionTo(request: ClipPlayRequest): boolean {
        if (this.#disposed) {
            return false;
        }
        // Before the branch and before any mutation: a bare `blendSeconds > 0`
        // would send a negative or `NaN` duration down the cut path and lose the
        // refusal entirely, on a backend that cannot blend as much as on one
        // that can.
        const fade = checkedFade(request.blendSeconds ?? 0);
        // Captured before the incoming entry is registered, so the list cannot
        // contain it however the map is keyed.
        const others = [...this.#active.values()].filter(
            (entry) => entry.clipName !== request.clipName,
        );
        // Nothing a blend could mean is left when the incoming clip is the one
        // already in flight; and a clip in `#posing` is one a clip END left on
        // its last frame, which a backend asked to blend into resumes exactly
        // there — for ever, on a clip that is finished. Both fall to the cut
        // path, which restarts. A clip that is FADING is not excluded: resuming
        // one is what a backend does well, and is the case `#fading` is kept
        // apart from `#posing` for.
        const blendingBackend =
            fade > 0 &&
            !this.#active.has(request.clipName) &&
            !this.#posing.has(request.clipName) &&
            supportsBlending(this.#backend)
                ? this.#backend
                : null;
        const started = this.#start(
            request,
            blendingBackend === null ? null : { backend: blendingBackend, fadeSeconds: fade },
        );
        if (started === null) {
            return false;
        }
        // The poses of the OTHER clips come down now: the incoming clip is
        // started, so a backend sharing one resource across the swap has already
        // handed it over.
        this.#releaseEveryPose();
        if (started.replaced !== undefined) {
            this.#release(started.replaced, 'clip-changed');
        }
        for (const entry of others) {
            // HELD on the blending arm. The backend has already released these
            // playbacks into its own posing set, with a weight ramp running on
            // each; stopping them here would hand their resources back on the
            // frame the blend started, and there would be nothing on screen to
            // fade out of. Kept in `#fading` so `stopAll` and `dispose` can
            // reach a blend that is still on screen.
            this.#release(entry, 'clip-changed', blendingBackend !== null);
            if (blendingBackend !== null) {
                this.#fading.set(entry.clipName, entry.playback);
            }
        }

        for (const warning of started.warnings) {
            this.#report(warning);
        }
        return true;
    }

    /**
     * Stop every clip with `'stopped'` and take down everything on screen that
     * is not being played. Idempotent, and the player stays usable.
     *
     * The verb a caller needs to play NOTHING: stopping by name is unusable when
     * the names are exactly what the caller has stopped tracking.
     */
    stopAll(): void {
        for (const entry of [...this.#active.values()]) {
            this.#release(entry, 'stopped');
        }
        this.#releaseEveryPose();
    }

    /**
     * Stop `clipName`, closing whatever it had open with `'stopped'`. A no-op if
     * it is not playing.
     *
     * It also takes down whatever of this clip is still on screen without being
     * played: a last frame a clip end left, and a blend still fading out.
     * Nothing is fanned out on those paths, and not by choice — what `#posing`
     * and `#fading` hold is a backend handle rather than an entry, so there is
     * no scheduler left to close and no handlers to close it to.
     */
    stop(clipName: AnimationClipName): void {
        const entry = this.#active.get(clipName);
        if (entry !== undefined) {
            this.#release(entry, 'stopped');
            return;
        }
        this.#releasePosing(clipName);
    }

    /**
     * Re-target one clip's own layer of the speed stack. Takes effect on the next
     * tick, which is where every layer is combined.
     *
     * @throws RangeError  when `speed` is negative or not finite.
     */
    setClipSpeed(clipName: AnimationClipName, speed: number): void {
        const checked = checkedPlaybackSpeed(speed, 'clip speed');
        const entry = this.#active.get(clipName);
        if (entry !== undefined) {
            entry.clipSpeed = checked;
        }
    }

    /**
     * Re-target the player-wide layer of the speed stack.
     *
     * @throws RangeError  when `speed` is negative or not finite.
     */
    setPlayerSpeed(speed: number): void {
        this.#playerSpeed = checkedPlaybackSpeed(speed, 'player speed');
    }

    /**
     * Advance every clip in flight by `rawDeltaSeconds` of wall clock and fan out
     * what crossed. A delta that is not a positive finite number is treated as
     * zero: open passages still tick, nothing moves.
     */
    tick(rawDeltaSeconds: number): void {
        if (this.#disposed) {
            return;
        }
        const raw = Number.isFinite(rawDeltaSeconds) && rawDeltaSeconds > 0 ? rawDeltaSeconds : 0;
        const entries = [...this.#active.values()];
        const timeScale = this.#getTimeScale();

        for (const entry of entries) {
            const multiplier = effectiveClipSpeed(entry.clipSpeed, this.#playerSpeed, timeScale);
            const wanted = raw * multiplier;
            const bounded = boundedStepSeconds(wanted, entry.durationSeconds);
            // The unbounded case sets the multiplier ITSELF rather than the
            // arithmetically equal `bounded / raw`, whose round trip through a
            // division is not exact.
            entry.playback.setSpeed(bounded === wanted ? multiplier : bounded / raw);
            entry.seatedAt = entry.playback.sample();
        }

        this.#backend.advance(raw);

        for (const entry of entries) {
            const step = stepScheduler(
                seatedAt(entry.scheduler, entry.seatedAt),
                entry.marks,
                entry.playback.sample(),
            );
            entry.scheduler = step.state;
            this.#fanOut(entry, step.events);
            if (step.state.terminated && this.#forget(entry)) {
                // HELD, not stopped: a `'once'` clip that reached its end is
                // being clamped on its last frame, and stopping it here restores
                // the model's original state synchronously — a bind-pose flash on
                // the same tick the `clip-end` handler runs.
                //
                // Only when this entry is still the registered one. A handler
                // that replayed the clip during the fan-out above has already had
                // this playback released as the one it replaced, and holding a
                // pose for a clip that is playing again would keep a backend
                // resource behind a handle nothing will ask for.
                entry.playback.hold();
                this.#posing.set(entry.clipName, entry.playback);
            }
        }
    }

    /**
     * Whether {@link ClipPlayer.dispose} has run.
     *
     * Exists because `play` answers `false` for a disposed player and `false` for
     * a clip the backend cannot play, and a CALLER has to tell those apart: the
     * second is an authoring fault worth reporting, the first is a player its
     * owner already replaced. A React binding that re-allocates on one input
     * while playing on another sees the old player for exactly one commit, and
     * without this it reports a fault against a clip that is perfectly fine.
     */
    get isDisposed(): boolean {
        return this.#disposed;
    }

    /**
     * Release every clip with `'released'`, take down everything on screen that
     * is not being played, and dispose the backend. Idempotent; a disposed player
     * plays and ticks nothing.
     */
    dispose(): void {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        for (const entry of [...this.#active.values()]) {
            this.#release(entry, 'released');
        }
        // Before the backend's own dispose rather than leaning on it: what a
        // held playback holds is a resource of the backend's, and a player that
        // walked away from it would depend on the implementation sweeping up.
        this.#releaseEveryPose();
        this.#backend.dispose();
    }

    /**
     * Close one clip out for a reason that came from outside the playhead.
     *
     * @param hold  Leave what the playback poses on screen instead of releasing
     *              it — for a clip something else is already fading out of. The
     *              scheduler is closed either way: this entry is terminal, and
     *              nothing about the pose changes that.
     */
    #release(
        entry: ActiveClip,
        reason: 'stopped' | 'clip-changed' | 'released',
        hold = false,
    ): void {
        const step = terminateScheduler(entry.scheduler, reason);
        entry.scheduler = step.state;
        this.#fanOut(entry, step.events);
        if (hold) {
            entry.playback.hold();
        } else {
            entry.playback.stop();
        }
        this.#forget(entry);
    }

    /**
     * Compile, start and register `request`, or `null` when the backend has no
     * such clip. Releases nothing — every caller owns what it takes down.
     *
     * @returns the registered entry, whatever entry it displaced under the same
     *          name, and the compile warnings its caller reports once its own
     *          teardown is done.
     * @throws RangeError  when `request.speed` is negative or not finite, before
     *                     anything is started or registered.
     */
    #start(
        request: ClipPlayRequest,
        blend: {
            readonly backend: SupportsClipBlending;
            readonly fadeSeconds: number;
        } | null = null,
    ): {
        readonly entry: ActiveClip;
        readonly replaced: ActiveClip | undefined;
        readonly warnings: readonly string[];
    } | null {
        const durationSeconds = this.#backend.getDurationSeconds(request.clipName);
        if (durationSeconds === null) {
            return null;
        }
        // Refused before anything is started or replaced, so a bad speed leaves
        // the player exactly as it was.
        const clipSpeed = checkedPlaybackSpeed(request.speed ?? 1, 'clip speed');

        const timeline = compileClipTimeline(
            request.sheet ?? null,
            request.clipName,
            durationSeconds,
        );
        const loop = request.loop ?? timeline?.loop;
        // The folded stack on the first frame too, so a clip declared at half
        // speed does not play one frame at 1x and get corrected on the next.
        const speed = effectiveClipSpeed(clipSpeed, this.#playerSpeed, this.#getTimeScale());

        const options = {
            ...(loop !== undefined ? { loop } : {}),
            // The same seat both paths owe the incoming clip: the folded stack,
            // so a clip declared at half speed plays at half speed through a
            // blend as well as through a cut.
            speed,
        };
        // The narrowing travels with the value rather than being re-derived
        // here: a second `supportsBlending` test would be a copy of the caller's
        // predicate that nothing could make disagree, and the seam warns about
        // exactly that shape.
        const playback =
            blend === null
                ? this.#backend.play(request.clipName, options)
                : blend.backend.crossfadeTo(request.clipName, blend.fadeSeconds, options);
        if (playback === null) {
            return null;
        }

        const sample = playback.sample();
        const replaced = this.#active.get(request.clipName);
        const entry: ActiveClip = {
            clipName: request.clipName,
            playback,
            durationSeconds,
            marks: timeline?.marks ?? [],
            handlers: request.handlers ?? {},
            clipSpeed,
            scheduler: initSchedulerState(sample),
            seatedAt: sample,
        };
        // Registered BEFORE the caller releases anything, because releasing fans
        // out and a handler may play this clip again from that fan-out.
        // Registering first makes the handler's entry the one that survives and
        // this call's the one that gets released; the other order overwrites the
        // handler's entry and leaves its playback live on the backend, reachable
        // by nothing but `backend.dispose()`.
        this.#active.set(request.clipName, entry);
        return { entry, replaced, warnings: timeline?.warnings ?? [] };
    }

    /** Take down everything on screen that is not being played. */
    #releaseEveryPose(): void {
        for (const clipName of [...this.#posing.keys(), ...this.#fading.keys()]) {
            this.#releasePosing(clipName);
        }
    }

    /**
     * Take down whatever of `clipName` is on screen without being played — a last
     * frame a clip end left, a blend still fading out — and forget it. A no-op
     * when there is neither.
     */
    #releasePosing(clipName: AnimationClipName): void {
        for (const held of [this.#posing, this.#fading]) {
            const playback = held.get(clipName);
            if (playback !== undefined) {
                held.delete(clipName);
                playback.stop();
            }
        }
    }

    /**
     * Drop `entry` from the active set, unless a handler already replaced it.
     *
     * Deleting by key would take whatever is registered under that name at this
     * moment, and both teardown paths fan out BEFORE they clean up — so a handler
     * that restarts its own clip (the canonical use of `onClipEnd`) would have the
     * playback it just started deleted by the call that invoked it: still live on
     * the backend, never ticked again, and released only by `backend.dispose()`.
     *
     * @returns whether `entry` was still the registered one — which is also the
     *          answer to "is this playback's teardown still this call's to do".
     */
    #forget(entry: ActiveClip): boolean {
        if (this.#active.get(entry.clipName) !== entry) {
            return false;
        }
        this.#active.delete(entry.clipName);
        return true;
    }

    /** Deliver one batch in array order, isolating each handler from the next. */
    #fanOut(entry: ActiveClip, events: readonly MarkerEvent[]): void {
        for (const event of events) {
            try {
                deliver(entry.handlers, event);
            } catch (error) {
                this.#reportHandlerFault(event, error);
            }
        }
    }

    #reportHandlerFault(event: MarkerEvent, cause: unknown): void {
        if (event.kind === 'clip-end') {
            if (this.#reportedClipEnd) {
                return;
            }
            this.#reportedClipEnd = true;
            this.#report(
                'An animation clip-end handler threw; further throws from it are not reported.',
                cause,
            );
            return;
        }
        if (this.#reportedMarks.has(event.name)) {
            return;
        }
        this.#reportedMarks.add(event.name);
        this.#report(
            `An animation marker handler for "${event.name}" threw; further throws from that mark are not reported.`,
            cause,
        );
    }
}

// ─── internals ──────────────────────────────────────────────────────────────────

/**
 * `state` seated at where the playhead actually is. Returns the state unchanged
 * when the two already agree, which is every tick nothing else touched the
 * playback.
 */
function seatedAt(state: SchedulerState, sample: PlayheadSample): SchedulerState {
    return state.lastPhase === sample.phase && state.lastCycle === sample.cycle
        ? state
        : { ...state, lastPhase: sample.phase, lastCycle: sample.cycle };
}

function deliver(handlers: ClipMarkerHandlers, event: MarkerEvent): void {
    switch (event.kind) {
        case 'notify':
            handlers.onNotify?.(event);
            return;
        case 'passage-start':
            handlers.onPassageStart?.(event);
            return;
        case 'passage-tick':
            handlers.onPassageTick?.(event);
            return;
        case 'passage-end':
            handlers.onPassageEnd?.(event);
            return;
        case 'clip-end':
            handlers.onClipEnd?.(event);
            return;
    }
}
