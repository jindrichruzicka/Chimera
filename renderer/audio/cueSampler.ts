/**
 * renderer/audio/cueSampler.ts
 *
 * The on-demand frame chain behind `AudioManager.observeCues` (§4.25 — Audio System).
 * It owns three things and nothing else: WHEN a frame exists, WHICH voices are
 * observed, and WHO is handed each step's batch. The cue maths belong to
 * {@link stepCueScheduler}, and reading a voice's playhead belongs to the manager —
 * both arrive through seams rather than being reached for.
 *
 * **The chain exists only while an observation does.** It is started by the FIRST
 * observation, re-armed from inside its own callback, and cancelled by the last
 * unsubscribe, so a game that never observes a cue pays no frame cost at all. That is
 * the shape of the design rather than an optimisation of it: cue observation is a
 * feedback channel a game opts into, and an audio manager that samples a playhead every
 * frame regardless is charging every game for one game's feature.
 *
 * **It is not `useFrame`.** The audio barrel is not r3f-bound and cue observation has to
 * work on a menu screen with no `<Canvas>` mounted, where a `useFrame` loop does not
 * exist. `InputManager` already owns a `requestAnimationFrame` chain in the renderer
 * with no r3f involvement at all.
 *
 * **The frame callback declares no parameter.** A `requestAnimationFrame` callback is
 * handed a `performance.now()` timestamp, and a sampler that read it would derive a
 * playhead from the wall clock instead of from `AudioContext.currentTime` — the very
 * thing Invariant #122 exists to prevent. A callback declaring one does not satisfy the
 * seam below, so the only clock reachable from here is the one the manager reads in
 * {@link ReadVoiceCuePlayhead}.
 *
 * **Nothing here schedules audio.** No node, no ramp, no stop: an observation is
 * feedback, and a transition that must land ON a cue is a scheduled op rather than a
 * callback that fires a frame late.
 */

import {
    stepCueScheduler,
    type CueEvent,
    type CueHandlers,
    type CuePlayheadSample,
    type CuePoint,
} from './cueMarkerScheduler.js';
import type { LoopWindowSeconds } from './voicePlayhead.js';

/**
 * The per-frame clock the chain runs on — `requestAnimationFrame` in a browser, and a
 * double under test, so no test here has to install one or wait for a real frame.
 */
export interface FrameSource {
    /** Schedule `callback` for the next frame; the returned id is what {@link cancel} takes. */
    request(callback: () => void): number;
    /** Cancel a scheduled frame. An id whose frame already fired is a no-op. */
    cancel(id: number): void;
}

/** What the sampler reads for one voice, once per frame. */
export interface VoiceCueReading {
    /** Where the playhead is, UNWRAPPED — see {@link CuePlayheadSample}. */
    readonly sample: CuePlayheadSample;
    /** The EFFECTIVE loop window as started, or `null` when the voice does not loop. */
    readonly loopWindow: LoopWindowSeconds | null;
}

/**
 * The owning manager's side of the sampler: this voice's playhead now, or `null` when
 * it has none — still loading, or scheduled to start later. A `null` reading leaves the
 * scheduler UNSEATED rather than seating it at zero, which is what stops a voice that
 * enters its buffer at 5 s from firing every cue behind it on the frame it starts.
 */
export type ReadVoiceCuePlayhead = (voiceId: string) => VoiceCueReading | null;

export interface CueSamplerOptions {
    readonly frameSource: FrameSource;
    readonly readVoice: ReadVoiceCuePlayhead;
}

/** `requestAnimationFrame`, where there is one. */
export const browserFrameSource: FrameSource = {
    request(callback: () => void): number {
        // A non-browser host (a unit run, the main process) has no frames to give. The
        // chain then holds an id that never fires, which is the honest outcome: there is
        // no clock to sample against and nothing to poll instead.
        return typeof requestAnimationFrame === 'undefined' ? 0 : requestAnimationFrame(callback);
    },
    cancel(id: number): void {
        if (typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(id);
        }
    },
};

/** The unsubscribe handed back for an observation that was never made. */
const NO_OBSERVATION = (): void => {
    return;
};

/**
 * One observer of one voice. A record per CALL rather than the handler object itself,
 * so a caller passing one shared handler record to two voices — or twice to the same
 * voice — gets two subscriptions, and unsubscribing one leaves the other standing.
 */
interface CueSubscription {
    readonly handlers: CueHandlers;
    /** Whether this subscription's containment has already been reported. */
    reported: boolean;
}

/** Everything one observed voice carries between frames. */
interface CueObservation {
    /** The clip's cues in Rule MARK-ORDER order, compiled once when observation begins. */
    readonly cues: readonly CuePoint[];
    readonly subscriptions: Set<CueSubscription>;
    /** The previous sample, or `null` until the voice first has a playhead. */
    state: CuePlayheadSample | null;
}

export class CueSampler {
    private readonly frameSource: FrameSource;
    private readonly readVoice: ReadVoiceCuePlayhead;
    private readonly observations = new Map<string, CueObservation>();

    private frameId: number | null = null;
    private disposed = false;

    public constructor(options: CueSamplerOptions) {
        this.frameSource = options.frameSource;
        this.readVoice = options.readVoice;
    }

    /**
     * Observe `voiceId`'s cues until the returned unsubscribe is called, the voice is
     * released, or the sampler is disposed.
     *
     * `compileCues` runs only for the voice's FIRST observer — the cue sheet is a property
     * of the clip, and so is the scheduler state threaded through it, which is also why a
     * second observer joining mid-play is seated where the voice already is rather than
     * replaying what it has passed.
     */
    public observe(
        voiceId: string,
        compileCues: () => readonly CuePoint[],
        handlers: CueHandlers,
    ): () => void {
        if (this.disposed) {
            return NO_OBSERVATION;
        }

        const existing = this.observations.get(voiceId);
        const observation: CueObservation = existing ?? {
            cues: compileCues(),
            subscriptions: new Set(),
            state: null,
        };
        if (existing === undefined) {
            this.observations.set(voiceId, observation);
        }

        const subscription: CueSubscription = { handlers, reported: false };
        observation.subscriptions.add(subscription);
        this.syncChain();

        return () => {
            this.unsubscribe(voiceId, observation, subscription);
        };
    }

    /**
     * End every observation of `voiceId`: `end` to each observer, then the voice is
     * dropped. The single place an observation ends, so `end` is emitted exactly once
     * however the voice got here — a natural finish, `stop`, preemption, or a sample that
     * reached the voice's scheduled stop before the native release arrived.
     */
    public endVoice(voiceId: string): void {
        const observation = this.observations.get(voiceId);
        if (observation === undefined) {
            return;
        }

        this.observations.delete(voiceId);
        const subscriptions = Array.from(observation.subscriptions);
        observation.subscriptions.clear();
        for (const subscription of subscriptions) {
            invokeHandler(subscription, { kind: 'end' });
        }
        this.syncChain();
    }

    /**
     * Cancel the chain and forget every observation, whatever is still subscribed.
     *
     * No `end` is emitted: the voices did not reach one, the audio graph is going away
     * under their observers rather than a track finishing, and a React observer being
     * unmounted alongside the manager has nothing to do with the event. `stopAll()` is
     * the call that ends voices an observer outlives, and it does emit one.
     */
    public dispose(): void {
        this.disposed = true;
        for (const observation of this.observations.values()) {
            // Emptied as well as forgotten, exactly as {@link endVoice} empties the one it
            // ends. Dropping the map alone would leave a frame ALREADY RUNNING — a handler
            // can be what called this — fanning the rest of its batch out to observers of
            // an observation that no longer exists.
            observation.subscriptions.clear();
        }
        this.observations.clear();
        this.syncChain();
    }

    private unsubscribe(
        voiceId: string,
        observation: CueObservation,
        subscription: CueSubscription,
    ): void {
        if (!observation.subscriptions.delete(subscription)) {
            // Already gone: unsubscribed twice, or the voice ended first. Returning here
            // is what keeps a second call from reaching the observers still standing.
            return;
        }

        if (observation.subscriptions.size === 0) {
            this.observations.delete(voiceId);
        }
        this.syncChain();
    }

    /**
     * Bring the chain into line with what is observed: running while any voice is, idle
     * otherwise. Idempotent and called after every change, so the two states cannot
     * drift — and so a last unsubscribe followed by a fresh observation in the SAME turn
     * arms a new frame rather than leaving a cancelled chain behind.
     */
    private syncChain(): void {
        const wanted = this.observations.size > 0;
        if (wanted === (this.frameId !== null)) {
            return;
        }

        if (this.frameId !== null) {
            this.frameSource.cancel(this.frameId);
            this.frameId = null;
            return;
        }
        this.frameId = this.frameSource.request(this.onFrame);
    }

    private readonly onFrame = (): void => {
        this.frameId = null;
        // A snapshot: a handler may observe another voice or release one, and the frame
        // it is running in owns the set it started with.
        for (const [voiceId, observation] of Array.from(this.observations)) {
            this.stepVoice(voiceId, observation);
        }
        this.syncChain();
    };

    private stepVoice(voiceId: string, observation: CueObservation): void {
        const reading = this.readVoice(voiceId);
        if (reading === null) {
            return;
        }

        const previous = observation.state;
        if (previous === null) {
            // The seat: a first sample has no span behind it to have crossed.
            observation.state = reading.sample;
            return;
        }

        const step = stepCueScheduler(
            previous,
            reading.sample,
            observation.cues,
            reading.loopWindow,
        );
        observation.state = step.state;
        if (step.events.length > 0) {
            this.fanOut(voiceId, observation, step.events);
        }
    }

    private fanOut(
        voiceId: string,
        observation: CueObservation,
        events: readonly CueEvent[],
    ): void {
        // A `cue` or a `loop` goes to the observers present when the batch began, minus
        // any that unsubscribed inside it. An `end` does not come from here at all — it is
        // {@link endVoice}'s, and reaches whoever is subscribed at the moment it closes
        // the observation, which is the batch's own last event.
        const subscriptions = Array.from(observation.subscriptions);
        for (const event of events) {
            if (event.kind === 'end') {
                // Always the last event of its batch, and the one place a sample can end
                // an observation — routed through the release path so that both spell
                // "ended" the same way.
                this.endVoice(voiceId);
                return;
            }

            for (const subscription of subscriptions) {
                if (observation.subscriptions.has(subscription)) {
                    invokeHandler(subscription, event);
                }
            }
        }
    }
}

/**
 * Hand one event to one observer, containing a throw.
 *
 * The chain re-arms itself at the END of its own callback, so an exception escaping a
 * handler would not merely lose that event — it would take cue observation down for
 * every voice and every other observer, permanently. Reported once per subscription
 * rather than once per throw: this runs on every frame a game paints, and a handler that
 * throws on each one would bury the console under copies of a single defect.
 */
function invokeHandler(subscription: CueSubscription, event: CueEvent): void {
    const { handlers } = subscription;
    try {
        if (event.kind === 'cue') {
            handlers.onCue?.(event);
        } else if (event.kind === 'loop') {
            handlers.onLoop?.(event);
        } else {
            handlers.onEnd?.(event);
        }
    } catch {
        if (subscription.reported) {
            return;
        }
        subscription.reported = true;
        console.warn(
            'Audio cue handler threw; the event is dropped and the voice keeps being observed. Later throws from this subscription are not reported.',
        );
    }
}
