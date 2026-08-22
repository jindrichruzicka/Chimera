/**
 * renderer/audio/cueMarkerScheduler.ts
 *
 * Turns a stream of playhead samples into `cue` / `loop` / `end` emissions against
 * one clip's parsed cue sheet (§4.25 — Audio System). Pure and framework-free: no
 * `AudioContext`, no React, no three.js, no clock of its own — the caller supplies
 * every sample and owns the state it threads through.
 *
 * A **sibling** of `renderer/animation/clipMarkerScheduler.ts`, not a reuse of it.
 * The rules carry over and are borrowed by name so the two read as one family; the
 * TIMELINE is what differs, and is why the module is not shared. Audio cues are
 * absolute buffer SECONDS with an asymmetric entry pass into a loop window that need
 * not be the whole buffer, where a clip timeline is normalized PHASE in `[0, 1]` with
 * cycle counts. There are no passages here — a cue is a point, and nothing in this
 * feature authors a sub-passage vocabulary — so the seven-reason close-out, the
 * per-step progress and the open list all have nothing to be about.
 *
 * **The handler record carries no dispatcher**, and neither does any event: nothing
 * here names a `SendAction`, a `PlayerId`, an `EngineAction` or a simulation step.
 * Audio is renderer-only (Invariant #63) and a cue firing is not a gameplay event —
 * a game wanting a MECHANICAL consequence of a musical moment authors it beat-side.
 * The rule is held by parameters that do not exist, because a parameter that does not
 * exist cannot be `eslint-disable`d, and `__tests__/cue-handler-no-dispatch.test.ts`
 * pins both halves of it: what a handler is HANDED and what it is DECLARED to take.
 *
 * ### The sample is UNWRAPPED, and that is the whole design
 *
 * A sample carries the position the playhead would hold if the loop did not exist:
 * the entry offset plus elapsed context time, which is what
 * {@link voicePlayheadSeconds} computes before folding. One monotonic fact rather
 * than a position plus a pass counter that could disagree with it — and it is what
 * makes every rule below exact rather than approximate, because the number of passes
 * a step crossed is a subtraction on it instead of a guess from a position that went
 * backwards. The caller already holds it: it is `startOffsetSeconds + (now −
 * startedAtContextTime)`, taken from the schedule facts Invariant #122 names.
 *
 * ### The rules
 *
 * **MARK-CROSS.** An ordinary step covers the half-open span `(last, next]`, so a cue
 * sitting exactly on a step's end fires on that step and not again on the next.
 *
 * **CLOSE-BEFORE-WRAP.** A step that wrapped is split in two — `(last, loopEnd]` then
 * `[loopStart, next]` — with `loop` emitted BETWEEN the halves, so the wrap instant is
 * covered exactly once per side it is named from. Both halves are CLOSED on the
 * window's own bounds, and that is not a preference: `loopEnd` and `loopStart` are the
 * SAME instant at a wrap, the reader commits to `loopEnd` for it, and
 * {@link nextCueContextTime} answers a next arrival for a cue at either bound on every
 * pass. Closing both keeps this module agreeing with both — which is what
 * `fadeOut({ toCue: 'end' })` on a whole-buffer loop rests on. They are distinct cues
 * at one instant rather than one cue at two positions, so nothing double-fires; a cue
 * the two halves genuinely share is caught by MARK-ONCE-PER-STEP below. For which
 * bounds the animation sibling closes, read the `span(...)` calls its `stepScheduler`
 * makes on the wrap path — the phase timeline puts the answer somewhere else.
 *
 * **MARK-ONCE-PER-STEP.** One enormous delta — a backgrounded tab, where the rAF
 * sampler stops and the audio does not — costs at most one emission per cue and one
 * `loop`, never one batch per skipped cycle. A step that crossed two or more passes
 * sweeps the WHOLE window after the wrap rather than only up to where it landed: the
 * playhead really did cross every cue in it, and bounding the second half at the
 * landing position would silently drop every cue between there and `loopEnd`. That is
 * the one place this module is more complete than its sibling, whose second half is
 * always bounded by the landing phase.
 *
 * **MARK-ORDER.** Ascending by seconds, ties broken lexicographically by name.
 * {@link compileCueSheet} establishes the order once, per clip, rather than per step.
 */

import type {
    AudioClipMetadata,
    AudioCueName,
} from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { LoopWindowSeconds } from './voicePlayhead.js';

/** One authored cue, resolved to buffer-local seconds. */
export interface CuePoint {
    /** The cue's name — its key in the clip's `cues` record. */
    readonly name: AudioCueName;
    /** Its offset into the DECODED buffer, in seconds. */
    readonly seconds: number;
}

/**
 * Where the playhead is, in UNWRAPPED buffer seconds — see the module header. The
 * state a caller threads between two steps is the previous one of these.
 */
export interface CuePlayheadSample {
    /** `startOffsetSeconds + (now − startedAtContextTime)`, before any loop fold. */
    readonly unwrappedSeconds: number;
    /**
     * Whether this sample is the voice's LAST. What ends a voice belongs to the caller,
     * which is why this is a fact ON the sample rather than something derived here: a
     * looping voice ends too, when whatever bounded it arrives.
     */
    readonly ended: boolean;
}

/** A named cue was crossed. */
export interface CueCrossedEvent {
    readonly kind: 'cue';
    /** The cue's name — its key in the clip's `cues` record. */
    readonly name: AudioCueName;
}

/** The playhead wrapped from the loop window's end back to its start. */
export interface CueLoopEvent {
    readonly kind: 'loop';
}

/** The voice finished. Always the last event of its batch. */
export interface CueEndEvent {
    readonly kind: 'end';
}

/** Everything one step can emit. */
export type CueEvent = CueCrossedEvent | CueLoopEvent | CueEndEvent;

/**
 * What an observer is handed. Every member takes its event and returns nothing:
 * there is no second argument, no context object and no return channel, so a
 * handler has nothing to reach a game's authoritative state WITH. That absence is
 * the enforcement — see the module header.
 */
export interface CueHandlers {
    /** A named cue was crossed. */
    readonly onCue?: (event: CueCrossedEvent) => void;
    /** The playhead wrapped back to the loop window's start. */
    readonly onLoop?: (event: CueLoopEvent) => void;
    /** The voice finished. */
    readonly onEnd?: (event: CueEndEvent) => void;
}

/** One call's result: the next state, and the batch to fan out, in order. */
export interface CueSchedulerStep {
    readonly state: CuePlayheadSample;
    readonly events: readonly CueEvent[];
}

/**
 * A clip's cues in Rule MARK-ORDER order — ascending by seconds, ties broken
 * lexicographically by name — established ONCE per clip so a step is a filter over a
 * sorted list rather than a sort per sample.
 *
 * Consumes {@link parseAudioCueSheet}'s output as it stands: this authors no cue
 * vocabulary of its own, so `validate-assets` and Invariant #125 are untouched. A
 * non-finite second is dropped rather than sorted, since `parseAudioCueSheet` never
 * produces one and a `NaN` reaching the comparator would leave the whole ORDER
 * unspecified rather than misplacing that one cue.
 *
 * @param sheet  The parsed sheet, or `null` for a clip that has none. Never mutated.
 */
export function compileCueSheet(sheet: AudioClipMetadata | null): readonly CuePoint[] {
    const cues = sheet?.cues;
    if (cues === undefined) {
        return [];
    }
    return Object.entries(cues)
        .filter(([, seconds]) => Number.isFinite(seconds))
        .map(([name, seconds]) => ({ name, seconds }))
        .sort(byCueOrder);
}

/**
 * Advance the scheduler to `next` and return everything the step crossed.
 *
 * Pure: `previous`, `cues` and `loopWindow` are read and never written, and the
 * returned state is `next` itself — the sample IS the state, so there is nothing to
 * seat beyond handing the first sample in as `previous`. That seat matters: a voice
 * that entered its buffer at 5 s never played the cue at 1 s, and a scheduler starting
 * from 0 would fire it.
 *
 * `ended` latches. Once a sample carries it, `end` is emitted last and every later
 * step returns the same state and an empty batch.
 *
 * @param previous    The state the previous call returned, or the first sample.
 * @param next        The sample taken after the context clock advanced.
 * @param cues        {@link compileCueSheet}'s output for this clip.
 * @param loopWindow  The EFFECTIVE loop window as started, or `null` when the voice
 *                    does not loop.
 */
export function stepCueScheduler(
    previous: CuePlayheadSample,
    next: CuePlayheadSample,
    cues: readonly CuePoint[],
    loopWindow: LoopWindowSeconds | null,
): CueSchedulerStep {
    if (previous.ended) {
        return { state: previous, events: [] };
    }

    const events: CueEvent[] = [];
    const emitted = new Set<AudioCueName>();

    if (loopWindow === null) {
        // No loop: the unwrapped position IS the buffer position, passed once.
        sweep(cues, span(previous.unwrappedSeconds, next.unwrappedSeconds, false), emitted, events);
    } else {
        sweepLooping(cues, loopWindow, previous, next, emitted, events);
    }

    if (next.ended) {
        events.push({ kind: 'end' });
    }
    return { state: next, events };
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** A span of buffer seconds, closed at the top and optionally closed at the bottom. */
interface Span {
    readonly from: number;
    readonly includeFrom: boolean;
    readonly to: number;
}

function span(from: number, to: number, includeFrom: boolean): Span {
    return { from, includeFrom, to };
}

function covers(range: Span, seconds: number): boolean {
    const aboveFrom = range.includeFrom ? seconds >= range.from : seconds > range.from;
    return aboveFrom && seconds <= range.to;
}

/**
 * The looping half of one step: fold both ends into the window, count the passes the
 * step crossed, and sweep either one span or the two CLOSE-BEFORE-WRAP halves.
 */
function sweepLooping(
    cues: readonly CuePoint[],
    loopWindow: LoopWindowSeconds,
    previous: CuePlayheadSample,
    next: CuePlayheadSample,
    emitted: Set<AudioCueName>,
    events: CueEvent[],
): void {
    const { startSeconds: loopStart, endSeconds: loopEnd } = loopWindow;
    const passes =
        wrapsBefore(next.unwrappedSeconds, loopWindow) -
        wrapsBefore(previous.unwrappedSeconds, loopWindow);
    const from = foldIntoWindow(previous.unwrappedSeconds, loopWindow);
    const to = foldIntoWindow(next.unwrappedSeconds, loopWindow);

    if (passes <= 0) {
        sweep(cues, span(from, to, false), emitted, events);
        return;
    }

    sweep(cues, span(from, loopEnd, false), emitted, events);
    events.push({ kind: 'loop' });
    // Rule MARK-ONCE-PER-STEP: two or more passes means the playhead crossed every
    // cue in the window, so the second half is the whole of it rather than the part
    // up to where the step landed.
    sweep(cues, span(loopStart, passes >= 2 ? loopEnd : to, true), emitted, events);
}

/**
 * Emit every cue `range` covers, in Rule MARK-ORDER order, skipping any this step
 * already emitted. `cues` arrives sorted, so a filter over it preserves that order.
 */
function sweep(
    cues: readonly CuePoint[],
    range: Span,
    emitted: Set<AudioCueName>,
    events: CueEvent[],
): void {
    for (const cue of cues) {
        if (!covers(range, cue.seconds) || emitted.has(cue.name)) {
            continue;
        }
        emitted.add(cue.name);
        events.push({ kind: 'cue', name: cue.name });
    }
}

/**
 * `unwrapped` folded into the loop window — the same fold {@link voicePlayheadSeconds}
 * applies, including its wrap convention, and pinned against it in
 * `cueMarkerScheduler.test.ts`. A boundary the two disagree about would be invisible
 * while each is checked against a table of its own.
 */
function foldIntoWindow(unwrapped: number, loopWindow: LoopWindowSeconds): number {
    const { startSeconds: loopStart, endSeconds: loopEnd } = loopWindow;
    if (unwrapped <= loopEnd) {
        return unwrapped; // still in the ENTRY pass, which may start before `loopStart`.
    }
    const period = loopEnd - loopStart;
    if (period <= 0) {
        return loopEnd; // a window carrying no period advances nowhere.
    }
    const phase = (unwrapped - loopStart) % period;
    // A zero phase is a wrap instant, which the reader names `loopEnd` rather than
    // `loopStart` — the closed-window convention a cue AT `loopEnd` depends on.
    return phase === 0 ? loopEnd : loopStart + phase;
}

/**
 * How many wraps lie strictly before `unwrapped`. The wrap instants are `loopEnd`,
 * `loopEnd + period`, `loopEnd + 2·period`, … and a wrap has HAPPENED only once the
 * playhead has left the instant: at `loopEnd` exactly the playhead is still on
 * `loopEnd`, which is why this counts strictly and a step ending there emits no `loop`.
 * A window carrying no period never wraps at all.
 */
function wrapsBefore(unwrapped: number, loopWindow: LoopWindowSeconds): number {
    const { startSeconds: loopStart, endSeconds: loopEnd } = loopWindow;
    const period = loopEnd - loopStart;
    if (period <= 0 || unwrapped <= loopEnd) {
        return 0;
    }
    return Math.ceil((unwrapped - loopEnd) / period);
}

function byCueOrder(a: CuePoint, b: CuePoint): number {
    if (a.seconds !== b.seconds) {
        return a.seconds - b.seconds;
    }
    return a.name < b.name ? -1 : 1;
}
