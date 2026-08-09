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
 * Rule SPEED-NON-NEGATIVE: a negative multiplier is REFUSED with a `RangeError`
 * rather than clamped. Reverse playback would invert the phase-increase the
 * scheduler reads a wrap out of, so a sign error must fail where it is written
 * rather than corrupt every mark boundary downstream.
 */

import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { ClipBackend, ClipPlayback, PlayheadSample } from './ClipBackend.js';
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
 * Several clips may be in flight at once — a crossfade has two — and each keeps
 * its own timeline, scheduler and clip speed.
 */
export class ClipPlayer {
    readonly #backend: ClipBackend;
    readonly #getTimeScale: () => number;
    readonly #report: (message: string, cause?: unknown) => void;
    readonly #active = new Map<AnimationClipName, ActiveClip>();
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
        const durationSeconds = this.#backend.getDurationSeconds(request.clipName);
        if (durationSeconds === null) {
            return false;
        }
        // Refused before anything is started or replaced, so a bad speed leaves
        // the player exactly as it was.
        const clipSpeed = checkedSpeed(request.speed ?? 1, 'clip speed');

        const timeline = compileClipTimeline(
            request.sheet ?? null,
            request.clipName,
            durationSeconds,
        );
        const loop = request.loop ?? timeline?.loop;
        const speed = effectiveClipSpeed(clipSpeed, this.#playerSpeed, this.#getTimeScale());

        const playback = this.#backend.play(request.clipName, {
            ...(loop !== undefined ? { loop } : {}),
            speed,
        });
        if (playback === null) {
            return false;
        }

        const sample = playback.sample();
        const replaced = this.#active.get(request.clipName);
        // Registered BEFORE the outgoing playback is released, because releasing
        // fans out and a handler may play this clip again from that fan-out.
        // Registering first makes the handler's entry the one that survives and
        // this call's the one that gets released; the other order overwrites the
        // handler's entry and leaves its playback live on the backend, reachable
        // by nothing but `backend.dispose()`.
        this.#active.set(request.clipName, {
            clipName: request.clipName,
            playback,
            durationSeconds,
            marks: timeline?.marks ?? [],
            handlers: request.handlers ?? {},
            clipSpeed,
            scheduler: initSchedulerState(sample),
            seatedAt: sample,
        });
        if (replaced !== undefined) {
            this.#release(replaced, 'clip-changed');
        }

        for (const warning of timeline?.warnings ?? []) {
            this.#report(warning);
        }
        return true;
    }

    /** Stop `clipName`, closing whatever it had open with `'stopped'`. A no-op if it is not playing. */
    stop(clipName: AnimationClipName): void {
        const entry = this.#active.get(clipName);
        if (entry !== undefined) {
            this.#release(entry, 'stopped');
        }
    }

    /**
     * Re-target one clip's own layer of the speed stack. Takes effect on the next
     * tick, which is where every layer is combined.
     *
     * @throws RangeError  when `speed` is negative or not finite.
     */
    setClipSpeed(clipName: AnimationClipName, speed: number): void {
        const checked = checkedSpeed(speed, 'clip speed');
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
        this.#playerSpeed = checkedSpeed(speed, 'player speed');
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
            if (step.state.terminated) {
                entry.playback.stop();
                this.#forget(entry);
            }
        }
    }

    /**
     * Release every clip with `'released'` and dispose the backend. Idempotent;
     * a disposed player plays and ticks nothing.
     */
    dispose(): void {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        for (const entry of [...this.#active.values()]) {
            this.#release(entry, 'released');
        }
        this.#backend.dispose();
    }

    /** Close one clip out for a reason that came from outside the playhead. */
    #release(entry: ActiveClip, reason: 'stopped' | 'clip-changed' | 'released'): void {
        const step = terminateScheduler(entry.scheduler, reason);
        entry.scheduler = step.state;
        this.#fanOut(entry, step.events);
        entry.playback.stop();
        this.#forget(entry);
    }

    /**
     * Drop `entry` from the active set, unless a handler already replaced it.
     *
     * Deleting by key would take whatever is registered under that name at this
     * moment, and both teardown paths fan out BEFORE they clean up — so a handler
     * that restarts its own clip (the canonical use of `onClipEnd`) would have the
     * playback it just started deleted by the call that invoked it: still live on
     * the backend, never ticked again, and released only by `backend.dispose()`.
     */
    #forget(entry: ActiveClip): void {
        if (this.#active.get(entry.clipName) === entry) {
            this.#active.delete(entry.clipName);
        }
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
 * `value` if it is a usable multiplier, or a `RangeError`. Does NOT clamp: the
 * one ceiling lives on the product in {@link effectiveClipSpeed}, and a second
 * one here would be unobservable behind it.
 */
function checkedSpeed(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(
            `${label} must be a finite number of at least 0, received ${value}; reverse playback is not supported`,
        );
    }
    return value;
}

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
