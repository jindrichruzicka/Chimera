/**
 * renderer/animation/clipMarkerScheduler.ts
 *
 * Turns a stream of {@link PlayheadSample}s into `notify` / `passage-start` /
 * `passage-tick` / `passage-end` / `clip-end` emissions against one compiled
 * timeline. Pure and framework-free: no three.js, no React, no DOM, no clock of
 * its own — the caller supplies every sample and owns the state it threads
 * through.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **The handler surface carries no dispatcher.** Nothing in this module names a
 * `SendAction`, a `PlayerId`, an `EngineAction` or a tick: the rule that no
 * animation event may gate an action (`docs/coding-standards-sections/react-three-fiber.md`, on Invariants #42/#43
 * and #56-#58) is held by a parameter that does not exist, and a parameter that
 * does not exist cannot be `eslint-disable`d. Gameplay consequences are beat-driven and live in the
 * simulation; this is the visual half.
 *
 * ### The rules, and the one measurement that shaped two of them
 *
 * **MARK-CROSS.** An ordinary step covers the half-open span
 * `(lastPhase, nextPhase]`. Half-open at the bottom so a mark sitting exactly on
 * a step's end fires on that step and not again on the next one.
 *
 * **CLOSE-BEFORE-WRAP.** A step whose `cycle` advanced is split in two —
 * `(lastPhase, 1)` then `[0, nextPhase]` — with every passage still open closed
 * as `'looped'` BETWEEN them. Phase 1 belongs to neither half: on a looping clip
 * the playhead passes through the loop point rather than resting on it, and the
 * instant it passes through is covered exactly once, by the `0` that opens the
 * second half. Two consequences worth stating rather than discovering. A passage
 * authored to run to the very end of a LOOPING clip closes as `'looped'` every
 * cycle — it never reaches its end, because the clip loops first. And a
 * loop-point mark belongs at phase 0 rather than at phase 1 — see the wrap cases
 * in `clipMarkerScheduler.test.ts`.
 *
 * That asymmetry is not a preference: closing the pre-wrap span at 1 turns the
 * `'looped'` cases in `clipMarkerScheduler.test.ts` into `'reached-end'` ones,
 * because `compileClipTimeline` clamps every phase into `[0, 1]` and a passage
 * that runs to the loop point therefore has its end inside a span closed there.
 *
 * **MARK-ONCE-PER-STEP.** A notify and a passage's start are each emitted at
 * most once per step, even when the step crossed twenty-five cycles and the two
 * wrap halves overlap, so one enormous delta costs at most
 * `notifies + 3 x passages` events rather than one batch per skipped cycle. A
 * passage's END is governed by the open list instead — see the comment on it in
 * {@link sweep}.
 *
 * **PASSAGE-START-NOT-TICK / PASSAGE-TICK-EVERY-STEP / PASSAGE-CONTAINED.** The
 * step that opens a passage does not also tick it; every later step ticks it,
 * including a zero-advance hit-stop step; and a passage that opens and closes
 * inside one step emits `passage-start` then `passage-end` with no tick at all.
 *
 * **MARK-ORDER.** Ascending by phase; ties broken lexicographically by name; one
 * mark's own boundaries always start before end.
 *
 * **Rule PCR — passage close, exactly once.** Every `passage-start` is answered
 * by exactly one `passage-end`, whichever of the seven reasons ends it. Two
 * functions produce closures and their responsibilities do not overlap:
 * {@link stepScheduler} owns `'reached-end'`, `'looped'` and `'clip-ended'`, and
 * is the ONLY producer of `clip-end`; {@link terminateScheduler} owns the four
 * reasons that come from outside the playhead and cannot emit `clip-end` at all,
 * because its parameter type does not admit the reasons that would justify one.
 */

import type {
    AnimationMarkName,
    AnimationWindowName,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { PlayheadSample } from './ClipBackend.js';
import type { CompiledMark, CompiledPassage } from './ClipTimeline.js';

/**
 * Why a passage closed. All seven ship from the first release: this is public
 * API under the locked `1.X.Y` scheme, and adding a member later breaks every
 * exhaustive `switch` a game wrote against it.
 *
 * - `'reached-end'` — the playhead crossed the passage's own end.
 * - `'looped'` — the clip wrapped while the passage was still open.
 * - `'clip-ended'` — a `'once'` clip stopped with the passage still open.
 * - `'stopped'` — the player stopped this clip.
 * - `'clip-changed'` — the playback was replaced by another, of this clip or of
 *   the one that took its place.
 * - `'seeked'` — the playhead was moved somewhere the passage cannot follow.
 * - `'released'` — the player, or the backend under it, was disposed.
 */
export type PassageEndReason =
    | 'reached-end'
    | 'looped'
    | 'clip-ended'
    | 'stopped'
    | 'clip-changed'
    | 'seeked'
    | 'released';

/**
 * The reasons {@link terminateScheduler} accepts: the four that come from
 * outside the playhead. The three the playhead itself produces are excluded at
 * the type level, so a stopped, re-targeted, seeked or disposed clip cannot
 * claim it reached its end — and no caller but {@link stepScheduler} can put a
 * `clip-end` on the wire.
 */
export type TerminationReason = Exclude<PassageEndReason, 'reached-end' | 'looped' | 'clip-ended'>;

/** An instant inside a clip was crossed. */
export interface NotifyEvent {
    readonly kind: 'notify';
    /** The mark's name — its key in the clip sheet's `notifies` record. */
    readonly name: AnimationMarkName;
}

/** A passage opened. */
export interface PassageEvent {
    readonly kind: 'passage-start';
    /** The mark's name — its key in the clip sheet's `passages` record. */
    readonly name: AnimationMarkName;
    /** The gameplay window this passage claims, when it claims one. */
    readonly window?: AnimationWindowName;
}

/** A passage that was already open is still open one step later. */
export interface PassageTickEvent {
    readonly kind: 'passage-tick';
    /** The mark's name — its key in the clip sheet's `passages` record. */
    readonly name: AnimationMarkName;
    /** How far through the passage the playhead is, clamped into `[0, 1]`. */
    readonly progress: number;
    /** The gameplay window this passage claims, when it claims one. */
    readonly window?: AnimationWindowName;
}

/** A passage closed, for one of the seven reasons. */
export interface PassageEndEvent {
    readonly kind: 'passage-end';
    /** The mark's name — its key in the clip sheet's `passages` record. */
    readonly name: AnimationMarkName;
    /** Which of the seven closures this was. */
    readonly reason: PassageEndReason;
    /** The gameplay window this passage claimed, when it claimed one. */
    readonly window?: AnimationWindowName;
}

/** A `'once'` clip reached its end and stopped. Always the last event of its batch. */
export interface ClipEndEvent {
    readonly kind: 'clip-end';
}

/** Everything one step can emit. */
export type MarkerEvent =
    | NotifyEvent
    | PassageEvent
    | PassageTickEvent
    | PassageEndEvent
    | ClipEndEvent;

/**
 * Everything the scheduler remembers between two samples. Immutable: every
 * function here returns a fresh value and leaves the one it was given alone.
 */
export interface SchedulerState {
    /** The passages currently open, in the order they opened. Unwound LIFO. */
    readonly open: readonly CompiledPassage[];
    /** Where the last sample put the playhead. */
    readonly lastPhase: number;
    /** The last sample's cycle count, against which a wrap is detected. */
    readonly lastCycle: number;
    /** Once true, every further step emits nothing. */
    readonly terminated: boolean;
}

/** One call's result: the next state, and the batch to fan out, in order. */
export interface SchedulerStep {
    readonly state: SchedulerState;
    readonly events: readonly MarkerEvent[];
}

/**
 * A scheduler seated at `from`, with nothing open and nothing terminated.
 *
 * The seat matters: a playback that starts mid-clip would otherwise have its
 * first step sweep from phase 0 and fire every mark it never played through.
 */
export function initSchedulerState(from?: PlayheadSample): SchedulerState {
    return {
        open: [],
        lastPhase: from?.phase ?? 0,
        lastCycle: from?.cycle ?? 0,
        terminated: false,
    };
}

/**
 * Advance the scheduler to `next` and return everything that crossed.
 *
 * The ONLY producer of `clip-end`. When `next.ended` latches true, one call
 * returns one batch: the marks the step crossed, then the LIFO unwind of
 * whatever is still open as `passage-end('clip-ended')`, then `clip-end` last —
 * and the returned state is terminated. A passage whose end the sweep already
 * crossed is removed from `open` by the sweep, so the unwind, which reads only
 * what survives there, cannot close it a second time.
 *
 * @param state  The state the previous call returned. Never mutated.
 * @param marks  The compiled timeline's marks. Never mutated, never re-validated.
 * @param next   The sample taken AFTER the backend advanced.
 */
export function stepScheduler(
    state: SchedulerState,
    marks: readonly CompiledMark[],
    next: PlayheadSample,
): SchedulerStep {
    if (state.terminated) {
        return { state, events: [] };
    }

    const events: MarkerEvent[] = [];
    const pass: SweepPass = {
        open: [...state.open],
        emitted: new Set<string>(),
        started: new Set<AnimationMarkName>(),
        events,
    };

    if (next.ended) {
        // The ending sweep is the ordinary one, bounded by where the playhead
        // actually stopped rather than by a hard 1. A backend whose `'once'` clip
        // stops below phase 1 leaves a passage authored to the clip end still
        // open, which is the case the forced unwind below is for.
        sweep(marks, span(state.lastPhase, false, next.phase, true), pass);
        unwind(pass, 'clip-ended');
        events.push({ kind: 'clip-end' });
        return { state: seat([], next, true), events };
    }

    if (next.cycle > state.lastCycle) {
        sweep(marks, span(state.lastPhase, false, 1, false), pass);
        unwind(pass, 'looped');
        sweep(marks, span(0, true, next.phase, true), pass);
    } else {
        sweep(marks, span(state.lastPhase, false, next.phase, true), pass);
    }

    // Rule PASSAGE-START-NOT-TICK is the only exclusion this needs: everything
    // still open either survived from the entry state or was pushed by a start in
    // this step, and `started` names exactly the second group. A second conjunct
    // testing membership of the entry state would have no fixture that trips it
    // alone.
    for (const passage of pass.open) {
        if (pass.started.has(passage.name)) {
            continue;
        }
        events.push(tickOf(passage, next.phase));
    }

    return { state: seat(pass.open, next, false), events };
}

/**
 * Close every open passage for a reason that came from outside the playhead.
 *
 * Emits no `clip-end`: a clip that was stopped, re-targeted, seeked or released
 * did not reach its end, and {@link TerminationReason} is what stops a caller
 * saying otherwise. A scheduler that has already terminated is left alone.
 *
 * @param state   The state to close out. Never mutated.
 * @param reason  Which of the four outside reasons this is.
 */
export function terminateScheduler(
    state: SchedulerState,
    reason: TerminationReason,
): SchedulerStep {
    if (state.terminated) {
        return { state, events: [] };
    }

    const events: MarkerEvent[] = [];
    for (let index = state.open.length - 1; index >= 0; index -= 1) {
        const passage = state.open[index];
        if (passage !== undefined) {
            events.push(endOf(passage, reason));
        }
    }

    return {
        state: {
            open: [],
            lastPhase: state.lastPhase,
            lastCycle: state.lastCycle,
            terminated: true,
        },
        events,
    };
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** A span of phase, with each end independently open or closed. */
interface Span {
    readonly from: number;
    readonly includeFrom: boolean;
    readonly to: number;
    readonly includeTo: boolean;
}

function span(from: number, includeFrom: boolean, to: number, includeTo: boolean): Span {
    return { from, includeFrom, to, includeTo };
}

function covers(range: Span, phase: number): boolean {
    const aboveFrom = range.includeFrom ? phase >= range.from : phase > range.from;
    const belowTo = range.includeTo ? phase <= range.to : phase < range.to;
    return aboveFrom && belowTo;
}

/** What the boundaries of one step mutate as the segments are swept in order. */
interface SweepPass {
    /** The open list as it stands mid-step. */
    open: CompiledPassage[];
    /** `kind:name` for every notify and start this STEP has already emitted. */
    readonly emitted: Set<string>;
    /** Passages this step opened, which Rule PASSAGE-START-NOT-TICK excludes from ticking. */
    readonly started: Set<AnimationMarkName>;
    /** The batch being built. */
    readonly events: MarkerEvent[];
}

/** Which end of which mark a crossing is. Ordered start → notify → end within one name. */
type BoundaryKind = 'start' | 'notify' | 'end';

const BOUNDARY_ORDER: Readonly<Record<BoundaryKind, number>> = { start: 0, notify: 1, end: 2 };

interface Crossing {
    readonly phase: number;
    readonly kind: BoundaryKind;
    readonly mark: CompiledMark;
}

/**
 * Emit every boundary `range` covers, in Rule MARK-ORDER order, skipping any
 * this step already emitted.
 *
 * Boundaries are collected and sorted rather than walked in `marks` order: a
 * passage sits in that array at its START phase, so its end would otherwise be
 * emitted next to its start instead of at the phase it actually sits on.
 */
function sweep(marks: readonly CompiledMark[], range: Span, pass: SweepPass): void {
    const crossings: Crossing[] = [];
    for (const mark of marks) {
        if (mark.kind === 'notify') {
            if (covers(range, mark.phase)) {
                crossings.push({ phase: mark.phase, kind: 'notify', mark });
            }
            continue;
        }
        if (covers(range, mark.fromPhase)) {
            crossings.push({ phase: mark.fromPhase, kind: 'start', mark });
        }
        if (covers(range, mark.toPhase)) {
            crossings.push({ phase: mark.toPhase, kind: 'end', mark });
        }
    }
    crossings.sort(byMarkOrder);

    for (const crossing of crossings) {
        const key = `${crossing.kind}:${crossing.mark.name}`;
        if (pass.emitted.has(key)) {
            continue;
        }
        if (crossing.mark.kind === 'notify') {
            pass.events.push({ kind: 'notify', name: crossing.mark.name });
            pass.emitted.add(key);
            continue;
        }
        const isOpen = pass.open.some((open) => open.name === crossing.mark.name);
        if (crossing.kind === 'start') {
            if (isOpen) {
                continue;
            }
            pass.open.push(crossing.mark);
            pass.started.add(crossing.mark.name);
            pass.events.push(startOf(crossing.mark));
            pass.emitted.add(key);
            continue;
        }
        if (!isOpen) {
            // An end nothing opened, which closes nothing.
            continue;
        }
        // Deliberately NOT added to `emitted`. An end is already idempotent —
        // the `isOpen` test above is what stops it firing twice — while the
        // ledger would stop the SECOND lifecycle of a passage the wrap re-opened
        // from closing, leaving it open with the playhead already past its end.
        // A passage still costs at most three events per step: whichever of a
        // start, a natural close and a forced close the step reaches.
        pass.open = pass.open.filter((open) => open.name !== crossing.mark.name);
        pass.events.push(endOf(crossing.mark, 'reached-end'));
    }
}

function byMarkOrder(a: Crossing, b: Crossing): number {
    if (a.phase !== b.phase) {
        return a.phase - b.phase;
    }
    if (a.mark.name !== b.mark.name) {
        return a.mark.name < b.mark.name ? -1 : 1;
    }
    return BOUNDARY_ORDER[a.kind] - BOUNDARY_ORDER[b.kind];
}

/** Close everything still open, LIFO, and empty the open list. */
function unwind(pass: SweepPass, reason: PassageEndReason): void {
    for (let index = pass.open.length - 1; index >= 0; index -= 1) {
        const passage = pass.open[index];
        if (passage !== undefined) {
            pass.events.push(endOf(passage, reason));
        }
    }
    pass.open = [];
}

function seat(
    open: readonly CompiledPassage[],
    next: PlayheadSample,
    terminated: boolean,
): SchedulerState {
    return { open, lastPhase: next.phase, lastCycle: next.cycle, terminated };
}

function startOf(passage: CompiledPassage): PassageEvent {
    return {
        kind: 'passage-start',
        name: passage.name,
        ...(passage.window !== undefined ? { window: passage.window } : {}),
    };
}

function endOf(passage: CompiledPassage, reason: PassageEndReason): PassageEndEvent {
    return {
        kind: 'passage-end',
        name: passage.name,
        reason,
        ...(passage.window !== undefined ? { window: passage.window } : {}),
    };
}

function tickOf(passage: CompiledPassage, phase: number): PassageTickEvent {
    // `marks` is a parameter, so a span that does not advance can reach here even
    // though `compileClipTimeline` drops one. Reported as complete rather than as
    // the `NaN` or `Infinity` the division would otherwise produce.
    const width = passage.toPhase - passage.fromPhase;
    const progress = width > 0 ? clamp01((phase - passage.fromPhase) / width) : 1;
    return {
        kind: 'passage-tick',
        name: passage.name,
        progress,
        ...(passage.window !== undefined ? { window: passage.window } : {}),
    };
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}
