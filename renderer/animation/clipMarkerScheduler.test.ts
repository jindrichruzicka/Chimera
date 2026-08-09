import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PlayheadSample } from './ClipBackend.js';
import type { CompiledMark, CompiledNotify, CompiledPassage } from './ClipTimeline.js';
import {
    initSchedulerState,
    stepScheduler,
    terminateScheduler,
    type MarkerEvent,
    type SchedulerState,
    type TerminationReason,
} from './clipMarkerScheduler.js';

// ─── fixtures ───────────────────────────────────────────────────────────────────

const notify = (name: string, phase: number): CompiledNotify => ({ kind: 'notify', name, phase });

const passage = (
    name: string,
    fromPhase: number,
    toPhase: number,
    window?: string,
): CompiledPassage =>
    window === undefined
        ? { kind: 'passage', name, fromPhase, toPhase }
        : { kind: 'passage', name, fromPhase, toPhase, window };

const at = (phase: number, cycle = 0, ended = false): PlayheadSample => ({ phase, cycle, ended });

/** Feeds `samples` through one scheduler and keeps every batch separately. */
function drive(
    marks: readonly CompiledMark[],
    samples: readonly PlayheadSample[],
    from: SchedulerState = initSchedulerState(),
): { readonly state: SchedulerState; readonly batches: readonly (readonly MarkerEvent[])[] } {
    let state = from;
    const batches: (readonly MarkerEvent[])[] = [];
    for (const sample of samples) {
        const step = stepScheduler(state, marks, sample);
        state = step.state;
        batches.push(step.events);
    }
    return { state, batches };
}

/** The last batch `drive` produced — the one a single-step case is about. */
function lastBatch(
    marks: readonly CompiledMark[],
    samples: readonly PlayheadSample[],
): readonly MarkerEvent[] {
    const { batches } = drive(marks, samples);
    return batches[batches.length - 1] ?? [];
}

/** A compact rendering of one batch, so an ordering failure reads as a diff. */
function describeBatch(events: readonly MarkerEvent[]): readonly string[] {
    return events.map((event) => {
        switch (event.kind) {
            case 'notify':
                return `notify:${event.name}`;
            case 'passage-start':
                return `start:${event.name}`;
            case 'passage-tick':
                return `tick:${event.name}`;
            case 'passage-end':
                return `end:${event.name}:${event.reason}`;
            case 'clip-end':
                return 'clip-end';
        }
    });
}

// ─── Rule MARK-CROSS ────────────────────────────────────────────────────────────

describe('Rule MARK-CROSS — a step covers the half-open (lastPhase, nextPhase]', () => {
    it('fires a notify sitting exactly on the step end, and does not fire it again', () => {
        // The mutation control for the interval itself: widening `(a, b]` to
        // `[a, b]` puts 0.5 in BOTH steps, so the second batch stops being empty.
        const { batches } = drive([notify('hit', 0.5)], [at(0.5), at(0.75)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['notify:hit']);
        expect(describeBatch(batches[1] ?? [])).toEqual([]);
    });

    it('does not fire a notify the step has not reached yet', () => {
        expect(describeBatch(lastBatch([notify('hit', 0.5)], [at(0.4)]))).toEqual([]);
    });

    it('fires a notify strictly inside the step', () => {
        expect(describeBatch(lastBatch([notify('hit', 0.5)], [at(0.6)]))).toEqual(['notify:hit']);
    });

    it('fires nothing for a backwards move that did not loop', () => {
        // A seek: `cycle` did not change, so this is not a wrap, and the span the
        // step covers is empty rather than the whole clip taken backwards.
        const { batches } = drive([notify('hit', 0.5)], [at(0.8), at(0.2)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['notify:hit']);
        expect(describeBatch(batches[1] ?? [])).toEqual([]);
    });
});

// ─── Rule MARK-ORDER ────────────────────────────────────────────────────────────

describe('Rule MARK-ORDER — ascending phase, ties broken lexicographically by name', () => {
    it('orders a passage end by its own phase, not by where its mark sits', () => {
        // `marks` is deliberately NOT in the order the events come out in: a
        // passage sits in the array at its START phase, so a scheduler walking
        // the array would emit `end:span` before `notify:mid`.
        const marks = [passage('span', 0.1, 0.9), notify('mid', 0.5)];

        expect(describeBatch(lastBatch(marks, [at(1)]))).toEqual([
            'start:span',
            'notify:mid',
            'end:span:reached-end',
        ]);
    });

    it('breaks a phase tie by name, whatever order the marks arrive in', () => {
        const marks = [notify('zulu', 0.5), notify('alpha', 0.5), notify('mike', 0.5)];

        expect(describeBatch(lastBatch(marks, [at(0.6)]))).toEqual([
            'notify:alpha',
            'notify:mike',
            'notify:zulu',
        ]);
    });

    it('opens a passage before it closes it when both boundaries share a phase', () => {
        // One mark's own boundaries are ordered start → end regardless of name,
        // because the reverse would close a passage that is not open yet and then
        // leave the start with nothing to balance it.
        expect(describeBatch(lastBatch([passage('span', 0.4, 0.4)], [at(0.5)]))).toEqual([
            'start:span',
            'end:span:reached-end',
        ]);
    });
});

// ─── Rule MARK-ONCE-PER-STEP ────────────────────────────────────────────────────

describe('Rule MARK-ONCE-PER-STEP — a many-cycle step costs one batch, not one per cycle', () => {
    it('fires a notify once for a step that crossed twenty-five cycles', () => {
        // A 10 s delta on a 0.4 s clip, expressed as the sample a backend reports
        // for it. The notify sits inside both halves of the wrap.
        const { batches } = drive([notify('hit', 0.5)], [at(0.2), at(0.9, 25)]);

        expect(describeBatch(batches[1] ?? [])).toEqual(['notify:hit']);
    });

    it('bounds a many-cycle step at notifies + 3 x passages', () => {
        const marks = [notify('hit', 0.5), passage('span', 0.3, 1)];
        const { batches } = drive(marks, [at(0.4), at(0.9, 25)]);

        expect(describeBatch(batches[1] ?? [])).toEqual([
            'notify:hit',
            'end:span:looped',
            'start:span',
        ]);
        // An upper bound, not a tight one: each passage can contribute at most a
        // forced close, a re-open and a natural close within the one step.
        expect((batches[1] ?? []).length).toBeLessThanOrEqual(1 + 3 * 1);
    });
});

// ─── Rule CLOSE-BEFORE-WRAP ─────────────────────────────────────────────────────

describe('Rule CLOSE-BEFORE-WRAP — two segments with the looped closures between them', () => {
    const marks = [
        notify('early', 0.05),
        passage('alpha', 0.1, 1),
        passage('bravo', 0.3, 1),
        notify('mid', 0.5),
        notify('late', 0.9),
    ];

    it('emits the pre-wrap marks, then the LIFO looped closures, then the post-wrap marks', () => {
        const { batches } = drive(marks, [at(0.6), at(0.15, 1)]);

        expect(describeBatch(batches[0] ?? [])).toEqual([
            'notify:early',
            'start:alpha',
            'start:bravo',
            'notify:mid',
        ]);
        // `late` at 0.9 is the mutation control for the split: merging the wrap
        // into one interval leaves it in no segment at all.
        expect(describeBatch(batches[1] ?? [])).toEqual([
            'notify:late',
            'end:bravo:looped',
            'end:alpha:looped',
            'notify:early',
            'start:alpha',
        ]);
    });

    it('closes a passage naturally when its end is crossed before the loop point', () => {
        const { batches } = drive(
            [passage('alpha', 0.1, 0.8), passage('bravo', 0.3, 1)],
            [at(0.6), at(0.15, 1)],
        );

        expect(describeBatch(batches[1] ?? [])).toEqual([
            'end:alpha:reached-end',
            'end:bravo:looped',
            'start:alpha',
        ]);
    });

    it('does not re-open a passage the same step already started and looped shut', () => {
        // Both wrap halves cover this passage's start. Firing it twice would put
        // the passage back open with its own end already behind the playhead, and
        // would push one passage past the three-events-per-step bound.
        const { state, batches } = drive([passage('span', 0.3, 1)], [at(0.1), at(0.9, 1)]);

        expect(describeBatch(batches[1] ?? [])).toEqual(['start:span', 'end:span:looped']);
        expect(state.open).toEqual([]);
    });

    it('closes a passage the wrap re-opened, rather than leaving it open past its end', () => {
        // Both halves cover this passage's whole span, so the step contains two
        // complete lifecycles of it: the one it entered open, and the one the new
        // cycle began. Suppressing the second close would leave it open with the
        // playhead at 0.9, well past its end at 0.7.
        const { state, batches } = drive([passage('span', 0.3, 0.7)], [at(0.5), at(0.9, 1)]);

        expect(describeBatch(batches[1] ?? [])).toEqual([
            'end:span:reached-end',
            'start:span',
            'end:span:reached-end',
        ]);
        expect(state.open).toEqual([]);
    });

    it('fires a mark sitting exactly on phase 0 after the wrap, and not before it', () => {
        // The loop point is covered exactly once, by the `0` that OPENS the
        // second segment. Making that bound exclusive silences a mark authored
        // there for the whole life of the clip.
        const { batches } = drive([notify('loop-point', 0)], [at(0.6), at(0.15, 1)]);

        expect(describeBatch(batches[0] ?? [])).toEqual([]);
        expect(describeBatch(batches[1] ?? [])).toEqual(['notify:loop-point']);
    });

    it('treats a cycle that went backwards as a seek rather than as a wrap', () => {
        // Only an INCREASE is a wrap. A backend that re-used a playback object and
        // reset its counter would otherwise replay the whole tail of the clip.
        const { batches } = drive([notify('late', 0.9)], [at(0.6, 4), at(0.15, 2)]);

        expect(describeBatch(batches[1] ?? [])).toEqual([]);
    });

    it('carries the passage window onto the looped closure', () => {
        const { batches } = drive([passage('alpha', 0.1, 1, 'hit')], [at(0.6), at(0.15, 1)]);

        expect(batches[1]?.[0]).toEqual({
            kind: 'passage-end',
            name: 'alpha',
            reason: 'looped',
            window: 'hit',
        });
    });
});

// ─── passage lifecycle ──────────────────────────────────────────────────────────

describe('Rules PASSAGE-CONTAINED, PASSAGE-START-NOT-TICK and PASSAGE-TICK-EVERY-STEP', () => {
    it('emits start then reached-end with no tick for a passage wholly inside one step', () => {
        expect(describeBatch(lastBatch([passage('span', 0.3, 0.4)], [at(0.5)]))).toEqual([
            'start:span',
            'end:span:reached-end',
        ]);
    });

    it('does not tick a passage on the step that started it', () => {
        expect(describeBatch(lastBatch([passage('span', 0.3, 0.9)], [at(0.5)]))).toEqual([
            'start:span',
        ]);
    });

    it('ticks an open passage on a zero-advance step, with progress in [0, 1]', () => {
        // The hit-stop case: the delta scaled to nothing, so the sample did not
        // move. The passage is still open, so it still reports.
        const { batches } = drive([passage('span', 0.25, 0.75)], [at(0.5), at(0.5)]);

        expect(batches[1]).toEqual([{ kind: 'passage-tick', name: 'span', progress: 0.5 }]);
    });

    it('carries the passage window onto the tick', () => {
        const { batches } = drive([passage('span', 0.25, 0.75, 'hit')], [at(0.5), at(0.5)]);

        expect(batches[1]).toEqual([
            { kind: 'passage-tick', name: 'span', progress: 0.5, window: 'hit' },
        ]);
    });

    it('clamps tick progress into [0, 1] for a playhead outside the passage span', () => {
        // Reachable through a backwards move that does not loop: nothing crossed
        // the passage end, so it stays open, but the playhead is now before its
        // start and the raw quotient is negative.
        const { batches } = drive([passage('span', 0.4, 0.8)], [at(0.5), at(0.1)]);

        expect(batches[1]).toEqual([{ kind: 'passage-tick', name: 'span', progress: 0 }]);
    });

    it('reports progress 1 for a zero-width span carried in a caller-built state', () => {
        // The scheduler's own transitions cannot leave a zero-width passage open —
        // its two boundaries share a phase, so any step that opens it closes it —
        // but `SchedulerState` is a public interface and `marks` is a parameter,
        // so a caller that keeps one can hand this pair back.
        const zero = passage('span', 0.4, 0.4);
        const seeded: SchedulerState = {
            open: [zero],
            lastPhase: 0.5,
            lastCycle: 0,
            terminated: false,
        };

        expect(stepScheduler(seeded, [zero], at(0.3)).events).toEqual([
            { kind: 'passage-tick', name: 'span', progress: 1 },
        ]);
    });

    it('reports progress 1 for a span that does not advance rather than dividing by zero', () => {
        // `compileClipTimeline` drops a passage whose end is not after its start,
        // but `marks` is a parameter and this scheduler never re-validates it. The
        // end boundary is crossed first here and closes nothing, so the passage
        // opens at 0.6 and is still open on the next step.
        const { batches } = drive([passage('span', 0.6, 0.4)], [at(0.7), at(0.8)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['start:span']);
        expect(batches[1]).toEqual([{ kind: 'passage-tick', name: 'span', progress: 1 }]);
    });

    it('does not tick a passage after it closed', () => {
        const { batches } = drive([passage('span', 0.1, 0.5)], [at(0.3), at(0.6), at(0.7)]);

        expect(describeBatch(batches[1] ?? [])).toEqual(['end:span:reached-end']);
        expect(describeBatch(batches[2] ?? [])).toEqual([]);
    });
});

// ─── clip end ───────────────────────────────────────────────────────────────────

describe('clip end — stepScheduler owns it, and owns it alone', () => {
    it('closes a passage that reaches its end as reached-end, then ends the clip', () => {
        // The overlap control. Running the forced unwind BEFORE the sweep reports
        // `clip-ended` here; running it after without removing what the sweep
        // closed reports the passage twice.
        const batch = lastBatch([passage('span', 0.5, 1)], [at(0.7), at(1, 0, true)]);

        expect(describeBatch(batch)).toEqual(['end:span:reached-end', 'clip-end']);
        expect(batch.filter((event) => event.kind === 'passage-end')).toHaveLength(1);
    });

    it('force-closes what the sweep left open as clip-ended, LIFO, with clip-end last', () => {
        const marks = [passage('alpha', 0.2, 0.8), passage('bravo', 0.3, 1), passage('c', 0.4, 1)];
        const batch = lastBatch(marks, [at(0.5), at(0.9, 0, true)]);

        expect(describeBatch(batch)).toEqual([
            'end:alpha:reached-end',
            'end:c:clip-ended',
            'end:bravo:clip-ended',
            'clip-end',
        ]);
    });

    it('fires the marks the ending step crossed before it unwinds', () => {
        const marks = [notify('hit', 0.85), passage('span', 0.3, 1)];
        const batch = lastBatch(marks, [at(0.5), at(0.9, 0, true)]);

        expect(describeBatch(batch)).toEqual(['notify:hit', 'end:span:clip-ended', 'clip-end']);
    });

    it('leaves nothing open and terminates', () => {
        const { state } = drive([passage('span', 0.3, 1)], [at(0.5), at(0.9, 0, true)]);

        expect(state.open).toEqual([]);
        expect(state.terminated).toBe(true);
    });

    it('returns an empty batch for every further step once terminated', () => {
        const { batches } = drive(
            [notify('hit', 0.5), passage('span', 0.3, 1)],
            [at(0.2), at(0.9, 0, true), at(0.6, 1), at(0.95, 1, true)],
        );

        expect(describeBatch(batches[2] ?? [])).toEqual([]);
        expect(describeBatch(batches[3] ?? [])).toEqual([]);
    });

    it('ends the clip even when no passage was ever open', () => {
        expect(describeBatch(lastBatch([], [at(1, 0, true)]))).toEqual(['clip-end']);
    });
});

// ─── the seven termination reasons ──────────────────────────────────────────────

describe('every PassageEndReason has a case the others cannot satisfy', () => {
    it('reached-end — the passage end is crossed on an ordinary step', () => {
        // One cycle throughout, `ended` never set, no terminate call.
        expect(describeBatch(lastBatch([passage('span', 0.2, 0.6)], [at(0.4), at(0.7)]))).toEqual([
            'end:span:reached-end',
        ]);
    });

    it('looped — the clip wrapped while the passage was still open', () => {
        // The passage runs to the loop point, so nothing crossed its end, and
        // `ended` is false so the clip-ended branch cannot run.
        expect(describeBatch(lastBatch([passage('span', 0.2, 1)], [at(0.4), at(0.1, 1)]))).toEqual([
            'end:span:looped',
        ]);
    });

    it('clip-ended — the sample latched ended with the passage still open', () => {
        // No cycle change, and the passage end at phase 1 is past the sample, so
        // neither the looped nor the reached-end branch can run.
        expect(
            describeBatch(lastBatch([passage('span', 0.2, 1)], [at(0.4), at(0.8, 0, true)])),
        ).toEqual(['end:span:clip-ended', 'clip-end']);
    });

    it.each([['stopped'], ['clip-changed'], ['seeked'], ['released']] as const)(
        '%s — terminateScheduler unwinds without ending the clip',
        (reason) => {
            const { state } = drive([passage('span', 0.2, 0.9)], [at(0.4)]);
            const step = terminateScheduler(state, reason);

            expect(describeBatch(step.events)).toEqual([`end:span:${reason}`]);
            expect(step.state.terminated).toBe(true);
            expect(step.state.open).toEqual([]);
        },
    );
});

describe('terminateScheduler', () => {
    it('unwinds several open passages LIFO and emits no clip-end', () => {
        const { state } = drive(
            [passage('alpha', 0.1, 0.9), passage('bravo', 0.2, 0.9), passage('c', 0.3, 0.9)],
            [at(0.5)],
        );

        expect(describeBatch(terminateScheduler(state, 'stopped').events)).toEqual([
            'end:c:stopped',
            'end:bravo:stopped',
            'end:alpha:stopped',
        ]);
    });

    it('carries the passage window onto the forced closure', () => {
        const { state } = drive([passage('span', 0.1, 0.9, 'hit')], [at(0.5)]);

        expect(terminateScheduler(state, 'released').events).toEqual([
            { kind: 'passage-end', name: 'span', reason: 'released', window: 'hit' },
        ]);
    });

    it('is a no-op once the scheduler has terminated', () => {
        const { state } = drive([passage('span', 0.1, 0.9)], [at(0.5)]);
        const once = terminateScheduler(state, 'stopped');

        expect(terminateScheduler(once.state, 'released').events).toEqual([]);
    });

    it('refuses to close a terminated state even when one still carries open passages', () => {
        // `SchedulerState` is a public interface, so this shape is constructible
        // by any caller that keeps one. Without the terminated guard the
        // no-op case above passes anyway — a terminated state normally has an
        // empty `open`, and an empty unwind emits nothing either way.
        const { state } = drive([passage('span', 0.1, 0.9)], [at(0.5)]);
        const inconsistent: SchedulerState = { ...state, terminated: true };
        const step = terminateScheduler(inconsistent, 'released');

        expect(state.open).toHaveLength(1);
        expect(step.events).toEqual([]);
        expect(step.state).toBe(inconsistent);
    });

    it('refuses the three reasons only stepScheduler may produce', () => {
        const state = initSchedulerState();

        // The type-level replacement for a terminate that could also emit
        // `clip-end`: a stopped, re-targeted or disposed clip cannot claim it
        // reached its end.
        // @ts-expect-error 'clip-ended' is not a TerminationReason
        terminateScheduler(state, 'clip-ended');
        // @ts-expect-error 'reached-end' is not a TerminationReason
        terminateScheduler(state, 'reached-end');
        // @ts-expect-error 'looped' is not a TerminationReason
        terminateScheduler(state, 'looped');
    });
});

// ─── initSchedulerState ─────────────────────────────────────────────────────────

describe('initSchedulerState', () => {
    it('starts empty, live and seated at the clip start', () => {
        expect(initSchedulerState()).toEqual({
            open: [],
            lastPhase: 0,
            lastCycle: 0,
            terminated: false,
        });
    });

    it('seats itself at the sample it is given', () => {
        expect(initSchedulerState(at(0.4, 3, true))).toEqual({
            open: [],
            lastPhase: 0.4,
            lastCycle: 3,
            terminated: false,
        });
    });
});

// ─── Rule PCR ───────────────────────────────────────────────────────────────────

describe('Rule PCR — every opened passage is closed exactly once, on the event list', () => {
    /** Names opened by a `passage-start`, in order. */
    const opened = (events: readonly MarkerEvent[]): readonly string[] =>
        events.filter((event) => event.kind === 'passage-start').map((event) => event.name);

    /** Names closed by a `passage-end`, in order. */
    const closed = (events: readonly MarkerEvent[]): readonly string[] =>
        events.filter((event) => event.kind === 'passage-end').map((event) => event.name);

    const arbitraryMarks = fc
        .uniqueArray(
            fc.record({
                name: fc.string({ minLength: 1, maxLength: 3 }),
                a: fc.integer({ min: 0, max: 20 }),
                b: fc.integer({ min: 0, max: 20 }),
            }),
            { selector: (mark) => mark.name, maxLength: 5 },
        )
        .map((raw): readonly CompiledMark[] =>
            raw.map((mark) =>
                mark.a === mark.b
                    ? notify(mark.name, mark.a / 20)
                    : passage(
                          mark.name,
                          Math.min(mark.a, mark.b) / 20,
                          Math.max(mark.a, mark.b) / 20,
                      ),
            ),
        );

    const arbitraryScript = fc.array(
        fc.record({
            phase: fc.integer({ min: 0, max: 20 }).map((step) => step / 20),
            cycleStep: fc.integer({ min: 0, max: 2 }),
            ended: fc.boolean(),
        }),
        { minLength: 1, maxLength: 12 },
    );

    it('closes every name that entered state.open, exactly once, across every interruption', () => {
        fc.assert(
            fc.property(
                arbitraryMarks,
                arbitraryScript,
                fc.integer({ min: 0, max: 12 }),
                fc.constantFrom<TerminationReason>('stopped', 'clip-changed', 'seeked', 'released'),
                (marks, script, interruptAt, reason) => {
                    let state = initSchedulerState();
                    let cycle = 0;
                    const events: MarkerEvent[] = [];

                    script.forEach((entry, index) => {
                        if (index === interruptAt) {
                            const interrupted = terminateScheduler(state, reason);
                            state = interrupted.state;
                            events.push(...interrupted.events);
                        }
                        cycle += entry.cycleStep;
                        const step = stepScheduler(state, marks, {
                            phase: entry.phase,
                            cycle,
                            ended: entry.ended,
                        });
                        state = step.state;
                        events.push(...step.events);
                    });

                    // Whatever is still open at the end of the script is closed by
                    // the release a player performs on dispose, so the ledger below
                    // balances over a COMPLETE life rather than a truncated one.
                    events.push(...terminateScheduler(state, 'released').events);

                    // Sorted, because the LIFO unwinds reverse the open order: the
                    // claim is exactly-once, not same-order.
                    expect([...closed(events)].sort()).toEqual([...opened(events)].sort());
                },
            ),
            { numRuns: 400 },
        );
    });

    it('is asserted on the emitted list because clearing open emits nothing', () => {
        // The control the acceptance criterion names: `terminated => open is
        // empty` is satisfiable by dropping the array on the floor, and the
        // dropped array is invisible to every assertion except the event list.
        const { state } = drive([passage('span', 0.2, 0.9)], [at(0.5)]);
        const dropped: SchedulerState = { ...state, open: [] };

        expect(state.open).toHaveLength(1);
        expect(terminateScheduler(dropped, 'stopped').events).toEqual([]);
        expect(terminateScheduler(state, 'stopped').events).toHaveLength(1);
    });
});

// ─── purity ─────────────────────────────────────────────────────────────────────

describe('purity', () => {
    it('mutates neither the state nor the marks it was handed', () => {
        const marks: readonly CompiledMark[] = Object.freeze([
            Object.freeze(notify('hit', 0.5)),
            Object.freeze(passage('span', 0.2, 0.9, 'hit')),
        ]);
        const before = initSchedulerState();
        const beforeSnapshot = structuredClone(before);
        const marksSnapshot = structuredClone(marks);

        const opened = stepScheduler(before, marks, at(0.6));
        stepScheduler(opened.state, marks, at(0.95, 0, true));
        stepScheduler(opened.state, marks, at(0.1, 1));
        terminateScheduler(opened.state, 'stopped');

        expect(before).toEqual(beforeSnapshot);
        expect(marks).toEqual(marksSnapshot);
        expect(opened.state.open).toHaveLength(1);
    });

    it('returns a state that is not the one it was given', () => {
        const before = initSchedulerState();

        expect(stepScheduler(before, [], at(0.5)).state).not.toBe(before);
    });
});
