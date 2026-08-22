import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import {
    compileCueSheet,
    stepCueScheduler,
    type CueEvent,
    type CuePlayheadSample,
    type CuePoint,
} from './cueMarkerScheduler.js';
import { voicePlayheadSeconds, type LoopWindowSeconds } from './voicePlayhead.js';

// ─── fixtures ───────────────────────────────────────────────────────────────────

/** A sheet carrying `cues`, with the `durationSeconds` its parse rule requires. */
const sheetOf = (
    cues: Readonly<Record<string, number>>,
    durationSeconds = 100,
): AudioClipMetadata => ({ cues, durationSeconds });

/** The compiled cue list for `cues`, which is what a step is taken against. */
const cuesOf = (cues: Readonly<Record<string, number>>): readonly CuePoint[] =>
    compileCueSheet(sheetOf(cues));

/** A sample at unwrapped buffer position `unwrappedSeconds`. */
const at = (unwrappedSeconds: number, ended = false): CuePlayheadSample => ({
    unwrappedSeconds,
    ended,
});

const window = (startSeconds: number, endSeconds: number): LoopWindowSeconds => ({
    startSeconds,
    endSeconds,
});

/** Feeds `samples` through one scheduler and keeps every batch separately. */
function drive(
    cues: readonly CuePoint[],
    loop: LoopWindowSeconds | null,
    samples: readonly CuePlayheadSample[],
): { readonly state: CuePlayheadSample; readonly batches: readonly (readonly CueEvent[])[] } {
    let state = samples[0] ?? at(0);
    const batches: (readonly CueEvent[])[] = [];
    for (const sample of samples.slice(1)) {
        const step = stepCueScheduler(state, sample, cues, loop);
        state = step.state;
        batches.push(step.events);
    }
    return { state, batches };
}

/** A compact rendering of one batch, so an ordering failure reads as a diff. */
function describeBatch(events: readonly CueEvent[]): readonly string[] {
    return events.map((event) => (event.kind === 'cue' ? `cue:${event.name}` : event.kind));
}

/** The single batch a one-step case is about. */
function oneStep(
    cues: readonly CuePoint[],
    loop: LoopWindowSeconds | null,
    from: CuePlayheadSample,
    to: CuePlayheadSample,
): readonly string[] {
    return describeBatch(stepCueScheduler(from, to, cues, loop).events);
}

// ─── compileCueSheet ────────────────────────────────────────────────────────────

describe('compileCueSheet — the parsed sheet, in Rule MARK-ORDER order', () => {
    it('sorts ascending by seconds', () => {
        expect(cuesOf({ outro: 8, intro: 2, chorus: 5 })).toEqual([
            { name: 'intro', seconds: 2 },
            { name: 'chorus', seconds: 5 },
            { name: 'outro', seconds: 8 },
        ]);
    });

    it('breaks a seconds tie lexicographically by name', () => {
        expect(cuesOf({ zulu: 4, alpha: 4, mike: 4 }).map((cue) => cue.name)).toEqual([
            'alpha',
            'mike',
            'zulu',
        ]);
    });

    it('reads an absent sheet, and a sheet carrying no cues, as no cues at all', () => {
        expect(compileCueSheet(null)).toEqual([]);
        expect(compileCueSheet({ durationSeconds: 10 })).toEqual([]);
    });

    it('drops a non-finite cue rather than seating it in the sort', () => {
        // `parseAudioCueSheet` never produces one; a hand-built sheet can, and a
        // NaN in the comparator makes the whole ORDER unspecified rather than
        // just misplacing that one cue.
        expect(cuesOf({ good: 1, bad: Number.NaN, worse: Number.POSITIVE_INFINITY })).toEqual([
            { name: 'good', seconds: 1 },
        ]);
    });

    it('leaves the sheet it was handed alone', () => {
        const cues = Object.freeze({ b: 2, a: 1 });
        const sheet = Object.freeze({ cues, durationSeconds: 10 }) as AudioClipMetadata;

        expect(() => compileCueSheet(sheet)).not.toThrow();
        expect(cues).toEqual({ b: 2, a: 1 });
    });
});

// ─── Rule MARK-CROSS ────────────────────────────────────────────────────────────

describe('Rule MARK-CROSS — a step covers the half-open (last, next]', () => {
    const cues = cuesOf({ hit: 0.5 });

    it('fires a cue sitting exactly on the step end, and does not fire it again', () => {
        // The mutation control for the interval itself: widening `(a, b]` to
        // `[a, b]` puts 0.5 in BOTH steps, so the second batch stops being empty.
        const { batches } = drive(cues, null, [at(0), at(0.5), at(0.75)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['cue:hit']);
        expect(describeBatch(batches[1] ?? [])).toEqual([]);
    });

    it('does not fire a cue the step has not reached yet', () => {
        expect(oneStep(cues, null, at(0), at(0.4))).toEqual([]);
    });

    it('fires a cue strictly inside the step', () => {
        expect(oneStep(cues, null, at(0), at(0.6))).toEqual(['cue:hit']);
    });

    it('fires nothing for a step that does not advance', () => {
        // A paused `AudioContext`: `currentTime` stops, so every sample repeats.
        expect(oneStep(cues, null, at(0.5), at(0.5))).toEqual([]);
        expect(oneStep(cues, window(0, 1), at(0.5), at(0.5))).toEqual([]);
    });

    it('fires nothing for a backwards step on a voice that does not loop', () => {
        expect(oneStep(cues, null, at(0.8), at(0.2))).toEqual([]);
    });

    it('seats on the first sample rather than sweeping from zero', () => {
        // A voice that entered the buffer at 5 s never played the cue at 1 s.
        expect(oneStep(cuesOf({ early: 1 }), null, at(5), at(6))).toEqual([]);
    });
});

// ─── Rule MARK-ORDER ────────────────────────────────────────────────────────────

describe('Rule MARK-ORDER — ascending by seconds, ties broken lexicographically by name', () => {
    it('emits the cues one step crossed in ascending order of seconds', () => {
        const cues = cuesOf({ third: 0.9, first: 0.2, second: 0.5 });

        expect(oneStep(cues, null, at(0), at(1))).toEqual(['cue:first', 'cue:second', 'cue:third']);
    });

    it('breaks a seconds tie by name', () => {
        const cues = cuesOf({ zulu: 0.5, alpha: 0.5 });

        expect(oneStep(cues, null, at(0), at(1))).toEqual(['cue:alpha', 'cue:zulu']);
    });
});

// ─── Rule CLOSE-BEFORE-WRAP ─────────────────────────────────────────────────────

describe('Rule CLOSE-BEFORE-WRAP — pre-wrap cues, then loop, then post-wrap cues', () => {
    const loop = window(1, 3);

    it('splits a wrapping step in two, with loop between the halves', () => {
        const cues = cuesOf({ late: 2.75, early: 1.25 });

        expect(oneStep(cues, loop, at(2.5), at(3.5))).toEqual(['cue:late', 'loop', 'cue:early']);
    });

    it('emits loop for a step that wraps and crosses no cue at all', () => {
        expect(oneStep(cuesOf({ far: 2 }), loop, at(2.5), at(3.25))).toEqual(['loop']);
    });

    it('fires a cue AT loopEnd once per pass, on the step that reaches it', () => {
        // The audio timeline's own convention, and the one that separates this
        // module from its animation sibling: the window is CLOSED at `loopEnd`,
        // which is what `nextCueContextTime` treats as reachable and what
        // `fadeOut({ toCue: 'end' })` on a whole-buffer loop rests on.
        const cues = cuesOf({ tail: 3 });
        const { batches } = drive(cues, loop, [at(2.5), at(3), at(4.5), at(5)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['cue:tail']);
        expect(describeBatch(batches[1] ?? [])).toEqual(['loop']);
        expect(describeBatch(batches[2] ?? [])).toEqual(['cue:tail']);
    });

    it('fires a cue AT loopStart on the wrap that returns to it', () => {
        // The post-wrap half is CLOSED at `loopStart`, so a cue there is reached
        // once per pass — which is what `nextCueContextTime` answers for it.
        expect(oneStep(cuesOf({ top: 1 }), loop, at(2.5), at(3.5))).toEqual(['loop', 'cue:top']);
    });

    it('plays an intro cue below loopStart on the entry pass and never again', () => {
        const cues = cuesOf({ fanfare: 0.5 });
        const { batches } = drive(cues, loop, [at(0), at(0.75), at(3.5), at(5.5), at(7.5)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['cue:fanfare']);
        expect(
            batches
                .slice(1)
                .flatMap(describeBatch)
                .filter((e) => e !== 'loop'),
        ).toEqual([]);
    });

    it('does not call the entry into the loop window a wrap', () => {
        // The step that carries the playhead out of the intro and into the window
        // has crossed no wrap instant — `loopEnd` is still ahead of it. The pass
        // count is what has to say so: every intro position sits more than one
        // period below `loopEnd`, so a count taken without its entry-pass floor
        // goes NEGATIVE there and this ordinary step reports a wrap it never made.
        const cues = cuesOf({ fanfare: 0.5, chorus: 2.5 });

        expect(oneStep(cues, loop, at(0.25), at(1.5))).toEqual(['cue:fanfare']);
    });

    it('never fires a cue beyond loopEnd, which the playhead never reaches', () => {
        const cues = cuesOf({ unreachable: 4 });
        const { batches } = drive(cues, loop, [at(0), at(3.5), at(5.5), at(7.5), at(9.5)]);

        expect(batches.flatMap(describeBatch).filter((e) => e !== 'loop')).toEqual([]);
    });

    it('emits no loop for a window carrying no period', () => {
        // A degenerate window advances nowhere: `voicePlayheadSeconds` sits the
        // playhead on `loopEnd` and `nextCueContextTime` offers it no next pass,
        // so there is nothing for a wrap to be.
        const cues = cuesOf({ mid: 1.5, tail: 2 });
        const { batches } = drive(cues, window(2, 2), [at(0), at(3), at(9)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['cue:mid', 'cue:tail']);
        expect(describeBatch(batches[1] ?? [])).toEqual([]);
    });
});

// ─── Rule MARK-ONCE-PER-STEP ────────────────────────────────────────────────────

describe('Rule MARK-ONCE-PER-STEP — one enormous delta costs one emission per cue', () => {
    const loop = window(1, 3);

    it('emits each cue at most once and loop at most once across many cycles', () => {
        const cues = cuesOf({ a: 1.25, b: 2, c: 2.75 });

        // Twelve periods in one step — a tab backgrounded while the audio played on.
        // Each of the three cues once, and one `loop`, rather than twelve batches.
        expect(oneStep(cues, loop, at(1.5), at(25.5))).toEqual(['cue:b', 'cue:c', 'loop', 'cue:a']);
    });

    // The fixtures that separate the whole-window second half from a second half
    // bounded at the landing position. Every step below starts at 2.75 and lands at
    // 1.25, so the cue at 2 is above the narrowed half and below the pre-wrap half's
    // `(2.75, 3]`: neither half reaches it, yet the playhead crossed it every pass.
    // TWO is the boundary the `passes >= 2` fork turns on and needs a fixture of its
    // own — at three alone, tightening the fork to `>= 3` changes real behaviour and
    // nothing notices. The property test below cannot stand in for either: it bounds
    // over-emission only, so every narrowing of a sweep satisfies it.
    it.each([
        { landing: 5.25, passes: 2 },
        { landing: 7.25, passes: 3 },
    ])('fires a cue sitting BETWEEN the two halves after $passes passes', ({ landing }) => {
        const cues = cuesOf({ between: 2 });

        expect(oneStep(cues, loop, at(2.75), at(landing))).toEqual(['loop', 'cue:between']);
    });

    it('does NOT widen the post-wrap half on a single-pass step', () => {
        // The other side of that boundary: one pass, so a cue the step has not
        // reached in the NEW pass must stay silent.
        const cues = cuesOf({ ahead: 2.75 });

        expect(oneStep(cues, loop, at(2.9), at(3.5))).toEqual(['loop']);
    });

    it('emits no cue twice and no more than one loop, over any step sequence', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0.1, max: 4, noNaN: true }),
                fc.array(fc.double({ min: 0, max: 30, noNaN: true }), {
                    minLength: 2,
                    maxLength: 20,
                }),
                (period, rawSamples) => {
                    const loopWindow = window(1, 1 + period);
                    const cues = cuesOf({ a: 0.5, b: 1, c: 1 + period / 2, d: 1 + period });
                    const samples = [...rawSamples].sort((x, y) => x - y).map((u) => at(u));

                    for (const events of drive(cues, loopWindow, samples).batches) {
                        const names = events.flatMap((e) => (e.kind === 'cue' ? [e.name] : []));
                        expect(new Set(names).size).toBe(names.length);
                        expect(events.filter((e) => e.kind === 'loop').length).toBeLessThanOrEqual(
                            1,
                        );
                    }
                },
            ),
        );
    });
});

// ─── the end of a non-looping voice ─────────────────────────────────────────────

describe('end — a non-looping voice finished', () => {
    const cues = cuesOf({ outro: 2 });

    it('emits the cues the step crossed, then end last', () => {
        expect(oneStep(cues, null, at(1), at(3, true))).toEqual(['cue:outro', 'end']);
    });

    it('emits nothing at all on any step after the end', () => {
        // `ghost` sits AHEAD of where the voice ended, so the two steps after the
        // end sweep across it. Without the latch they fire it — which is what
        // separates this from a sequence whose later steps cross nothing anyway.
        const withGhost = cuesOf({ outro: 2, ghost: 4 });
        const { batches } = drive(withGhost, null, [at(1), at(3, true), at(5), at(9)]);

        expect(describeBatch(batches[0] ?? [])).toEqual(['cue:outro', 'end']);
        expect(describeBatch(batches[1] ?? [])).toEqual([]);
        expect(describeBatch(batches[2] ?? [])).toEqual([]);
    });

    it('keeps the ended sample as the state, so the latch survives', () => {
        const { state } = drive(cues, null, [at(1), at(3, true), at(5)]);

        expect(state).toEqual({ unwrappedSeconds: 3, ended: true });
    });

    it('carries the playhead forward as the next state on an ordinary step', () => {
        expect(stepCueScheduler(at(1), at(2), cues, null).state).toEqual({
            unwrappedSeconds: 2,
            ended: false,
        });
    });
});

// ─── agreement with the playhead reader ─────────────────────────────────────────

describe('the fold agrees with voicePlayheadSeconds at every position', () => {
    // Both modules fold an unwrapped position into the loop window, and a
    // boundary they disagree about is invisible while each is checked against a
    // table of its own. Positions are binary fractions, so the arithmetic below
    // is exact and a cue can sit exactly on the folded position.
    const loop = window(1, 3);
    const timeline = { startOffsetSeconds: 0, loopWindowSeconds: loop };
    const started = { startedAtContextTime: 0, bufferDurationSeconds: 1000 };

    it.each([0.5, 1, 2.5, 3, 3.5, 5, 5.25, 7])(
        'fires the cue sitting where the reader says the playhead is at u=%s',
        (unwrapped) => {
            const position = voicePlayheadSeconds(timeline, started, unwrapped);
            expect(position, 'the reader must place the playhead somewhere').not.toBeNull();

            const events = oneStep(
                cuesOf({ here: position! }),
                loop,
                at(unwrapped - 0.25),
                at(unwrapped),
            );

            expect(events).toContain('cue:here');
        },
    );
});

// ─── purity ─────────────────────────────────────────────────────────────────────

describe('the scheduler mutates nothing it is handed', () => {
    it('leaves the state, the cue list and the window untouched', () => {
        const cues = Object.freeze(cuesOf({ a: 1.5, b: 2.5 }).map((cue) => Object.freeze(cue)));
        const loop = Object.freeze(window(1, 3));
        const previous = Object.freeze(at(1.25));
        const next = Object.freeze(at(3.5));

        const step = stepCueScheduler(previous, next, cues, loop);

        expect(step.events.length).toBeGreaterThan(0);
        expect(previous).toEqual({ unwrappedSeconds: 1.25, ended: false });
        expect(next).toEqual({ unwrappedSeconds: 3.5, ended: false });
        expect(cues).toEqual([
            { name: 'a', seconds: 1.5 },
            { name: 'b', seconds: 2.5 },
        ]);
        expect(loop).toEqual({ startSeconds: 1, endSeconds: 3 });
    });
});
