/**
 * renderer/audio/voicePlayhead.test.ts
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #122 — a voice's cue-relative timing is derived from `startedAtContextTime`,
 *          `startOffsetSeconds`, the decoded buffer duration and the effective loop
 *          window, never from a wall-clock timer. This module holds no clock of its
 *          own at all: `now` arrives as a parameter, which is what makes both
 *          directions testable with no fake timers and no `AudioContext`.
 *
 * The two directions are pinned against EACH OTHER as well as against tables. A
 * hand-computed table alone cannot say they agree — each would keep its own idea of
 * where a pass ends — and the round-trip property is what turns a boundary
 * disagreement into a failure rather than into two individually plausible answers.
 *
 * The property's three classes are counted and asserted non-empty. Every generated
 * shape is legal but not every one is reachable: `nextCueContextTime` answers `null`
 * for a cue the playhead never gets to, and a round-trip over an empty class would be
 * green while proving nothing.
 *
 * Values are generated on a quarter-second grid so every sum, difference and
 * remainder below is exact in binary floating point. `toBeCloseTo` is still what the
 * property asserts with, because the claim is about agreement rather than about bit
 * patterns; the table tests use exact equality, where the grid makes it honest.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    nextCueContextTime,
    voicePlayheadSeconds,
    type LoopWindowSeconds,
    type StartedTimeline,
    type VoiceTimeline,
} from './voicePlayhead.js';

/** The decoded length every fixture below shares, in seconds. */
const DURATION = 10;

/** The context time every fixture's voice starts at. */
const T0 = 10;

function timeline(
    startOffsetSeconds: number,
    loopWindowSeconds: LoopWindowSeconds | null = null,
): VoiceTimeline {
    return { startOffsetSeconds, loopWindowSeconds };
}

function started(startedAtContextTime = T0, bufferDurationSeconds = DURATION): StartedTimeline {
    return { startedAtContextTime, bufferDurationSeconds };
}

/** The `[2, 6]` window an intro-then-loop clip runs, entered at the buffer start. */
const INTRO_THEN_LOOP = timeline(0, { startSeconds: 2, endSeconds: 6 });

describe('voicePlayheadSeconds', () => {
    it('reports the entry offset at the voice’s own start instant', () => {
        // Not `0`: the playhead is where `source.start(when, offset)` put it, and a
        // voice entered at its chorus is already 2 s into the buffer.
        expect(voicePlayheadSeconds(timeline(2), started(), T0)).toBe(2);
    });

    it('advances one buffer second per context second while the voice does not loop', () => {
        expect(voicePlayheadSeconds(timeline(2), started(), T0 + 3.5)).toBe(5.5);
    });

    it('answers null before a scheduled start rather than a negative offset', () => {
        // A voice whose `source.start(when)` is still ahead has no playhead at all. The
        // subtraction would otherwise hand back an offset BEHIND the entry point, which
        // reads as a legitimate position inside the buffer.
        expect(voicePlayheadSeconds(timeline(2), started(T0 + 2), T0)).toBeNull();
    });

    it('still reports the buffer end on the last instant a non-looping voice plays', () => {
        // Closed at the decoded duration, so `'end'` names a position the voice reaches
        // rather than one it has already left.
        expect(voicePlayheadSeconds(timeline(2), started(), T0 + 8)).toBe(DURATION);
    });

    it('answers null once a non-looping voice has run past its buffer end', () => {
        expect(voicePlayheadSeconds(timeline(2), started(), T0 + 8.25)).toBeNull();
    });

    it('plays the entry pass out to loopEnd before any wrap', () => {
        // Entered at 0 with a [2, 6] window: the intro is played once, so 5 s in the
        // playhead is at 5 — inside the buffer but outside the loop window.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 5)).toBe(5);
    });

    it('wraps into the loop window once the entry pass has run out', () => {
        // 7 s in: the entry pass ended at 6, so the playhead is 1 s into the next pass.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 7)).toBe(3);
    });

    it('keeps wrapping over arbitrarily many passes', () => {
        // 19 s in — four wraps past the one above, and the same position.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 19)).toBe(3);
    });

    it('names loopEnd rather than loopStart at the instant the playhead wraps', () => {
        // The wrap instant is loopEnd and loopStart at once. Reporting loopEnd is the
        // same convention that makes a cue AT loopEnd reachable rather than never
        // reached — pick the other one and `{ toCue: 'end' }` on a loop becomes a cut.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 6)).toBe(6);
        // A whole period later it is still a wrap, and still loopEnd. This is the pass
        // the entry-pass branch cannot answer, so it pins the wrap arithmetic itself.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 10)).toBe(6);
    });

    it('ignores the buffer end on a looping voice whose window is shorter than it', () => {
        // 51 s in, five times the buffer's own length. A loop never runs past loopEnd,
        // so the decoded duration bounds a NON-looping voice only; applying it here
        // would silence a bed that is still playing.
        expect(voicePlayheadSeconds(INTRO_THEN_LOOP, started(), T0 + 51)).toBe(3);
    });

    it('holds at loopEnd on a zero-length loop window', () => {
        // A window that carries no period advances nowhere; the playhead sits on it.
        expect(
            voicePlayheadSeconds(
                timeline(3, { startSeconds: 3, endSeconds: 3 }),
                started(),
                T0 + 5,
            ),
        ).toBe(3);
    });
});

/**
 * The other half of a scheduled start: a voice given a future `startedAtContextTime` has
 * not entered its buffer, so an arrival before that instant is not one — while the instant
 * it begins IS.
 *
 * Two of these eight are red against the body this branch replaced, which compared only
 * against `now`: a cue behind the entry point of a non-looping voice, answered with an
 * instant in the gap before the first sample, and the same cue on a loop, answered a whole
 * period early. Two fence the collapse — a cue ahead of the entry still arrives when it
 * arrives, and a voice already playing still searches from `now`, which is every voice
 * there was before a start could be scheduled.
 *
 * The last four sit ON a bound, where the two comparators pull apart, and the baseline
 * cannot drive them: the replaced body compares against `now` alone and happens to answer
 * all four correctly. The first fix this branch wrote did not — comparing against the
 * later of `now` and the start discarded the arrival at the start itself, `null` on the
 * non-looping arm and a whole period late on the looping one. So the mutants are what pin
 * them: `cueSeconds > entrySeconds` for the `>=` reds the two on the entry point, and
 * `reachedAt >= now` for the `>` reds one on each arm — the comparator is written twice,
 * so a fixture on one arm leaves the other unmeasured.
 */
describe('nextCueContextTime on a voice scheduled ahead of the clock', () => {
    /** Four seconds ahead of `now`, which every fixture below leaves at `T0`. */
    const SCHEDULED = T0 + 4;

    it('answers null for a cue behind the entry point of a voice that has not started', () => {
        // Entered at 5 with no loop, so position 3 is never played. Searching from `now`
        // would name 12 — an instant two seconds BEFORE the first sample, and one the
        // playhead is never at.
        expect(nextCueContextTime(timeline(5), started(SCHEDULED), 3, T0)).toBeNull();
    });

    it('answers the real arrival for a cue ahead of the entry point of a scheduled voice', () => {
        // The other side of the same comparison: position 7 is two seconds of play past
        // the entry, so it arrives two seconds after the scheduled start.
        expect(nextCueContextTime(timeline(5), started(SCHEDULED), 7, T0)).toBe(SCHEDULED + 2);
    });

    it('sends a cue behind the entry point of a scheduled LOOP one period on', () => {
        // Window [3, 8], entered at 5: the entry pass runs 5 → 8, wraps to 3, and only
        // then reaches 4 — one period after the naive 13 that searching from `now` would
        // let through, and three seconds after the voice becomes audible at all.
        const record = timeline(5, { startSeconds: 3, endSeconds: 8 });
        expect(nextCueContextTime(record, started(SCHEDULED), 4, T0)).toBe(SCHEDULED + 4);
    });

    it('leaves a started voice searching from now, not from its own start', () => {
        // The collapse that keeps every pre-scheduling answer intact: with the start
        // behind the clock the later of the two IS `now`, so a cue the playhead has
        // already gone past on this pass waits for the next one rather than being
        // reported behind it.
        const record = timeline(0, { startSeconds: 2, endSeconds: 6 });
        expect(nextCueContextTime(record, started(T0), 3, T0 + 4)).toBe(T0 + 7);
    });

    it('names the scheduled start itself for a cue sitting ON the entry point', () => {
        // The boundary the two directions have to agree about, and the one place `now` and
        // the voice's own start pull opposite ways: `now` is where the playhead already IS,
        // so a cue sitting on it waits a whole pass, while a scheduled start is where the
        // playhead first WILL be — an arrival there is still ahead, and discarding it would
        // answer "never" for the cue a cue-aligned transition is most likely to name.
        expect(voicePlayheadSeconds(timeline(5), started(SCHEDULED), SCHEDULED)).toBe(5);
        expect(nextCueContextTime(timeline(5), started(SCHEDULED), 5, T0)).toBe(SCHEDULED);
    });

    it('names the scheduled start itself for a cue on the entry point of a LOOP', () => {
        // The same instant on the looping arm, where the cost of discarding it is a whole
        // period rather than a `null`: the entry pass would be skipped and the answer would
        // land on the next wrap.
        const record = timeline(5, { startSeconds: 3, endSeconds: 8 });
        expect(voicePlayheadSeconds(record, started(SCHEDULED), SCHEDULED)).toBe(5);
        expect(nextCueContextTime(record, started(SCHEDULED), 5, T0)).toBe(SCHEDULED);
    });

    it('answers null for a cue a non-looping playhead is sitting exactly on', () => {
        // The other half of the asymmetry, and the reason the two comparators cannot be
        // one: `now` is where the playhead already IS, so a cue there has arrived rather
        // than being about to, and a non-looping voice has no next pass to offer instead.
        // The looping arm answers the same instant one period on; only the entry bound
        // admits a cue it lands exactly on.
        expect(voicePlayheadSeconds(timeline(0), started(T0), T0 + 4)).toBe(4);
        expect(nextCueContextTime(timeline(0), started(T0), 4, T0 + 4)).toBeNull();
    });

    it('sends a cue a LOOPING playhead is sitting exactly on a whole period on', () => {
        // The looping half of the same bound, and the reason it needs its own fixture: the
        // clock comparator is written twice, once per arm, and this arm answers with the
        // next pass where the other answers `null`. Window [2, 6] entered at 0, so the
        // playhead is at 4 four seconds in and back there one period later.
        const record = timeline(0, { startSeconds: 2, endSeconds: 6 });
        expect(voicePlayheadSeconds(record, started(T0), T0 + 4)).toBe(4);
        expect(nextCueContextTime(record, started(T0), 4, T0 + 4)).toBe(T0 + 8);
    });
});

describe('the playhead reader and nextCueContextTime agree at every boundary', () => {
    /**
     * One legal voice-and-question shape, on a quarter-second grid over a 10 s buffer.
     *
     * The entry offset is drawn the way `startVoice` writes it: below `loopStart` for
     * an intro pass, or folded into `[loopStart, loopEnd)` — never past the window,
     * which the fold makes unreachable. Cue seconds span the whole buffer, since an
     * end-point cue is clamped to `[0, duration]` and nothing narrower.
     */
    const arbitraryVoice = fc
        .record({
            looping: fc.boolean(),
            loopStartQuarters: fc.integer({ min: 0, max: 36 }),
            loopSpanQuarters: fc.integer({ min: 1, max: 40 }),
            entryQuarters: fc.integer({ min: 0, max: 40 }),
            cueQuarters: fc.integer({ min: 0, max: 40 }),
            elapsedQuarters: fc.integer({ min: 0, max: 400 }),
        })
        .map((raw) => {
            const loopEndQuarters = Math.min(40, raw.loopStartQuarters + raw.loopSpanQuarters);
            const window: LoopWindowSeconds | null = raw.looping
                ? { startSeconds: raw.loopStartQuarters / 4, endSeconds: loopEndQuarters / 4 }
                : null;
            const entryQuarters = raw.looping
                ? raw.entryQuarters % loopEndQuarters
                : raw.entryQuarters;
            return {
                record: timeline(entryQuarters / 4, window),
                cueSeconds: raw.cueQuarters / 4,
                now: T0 + raw.elapsedQuarters / 4,
            };
        });

    it('reads back exactly the cue the writer says the playhead next reaches', () => {
        const seen = { nonLooping: 0, entryPass: 0, postWrap: 0 };

        fc.assert(
            fc.property(arbitraryVoice, ({ record, cueSeconds, now }) => {
                const reachedAt = nextCueContextTime(record, started(), cueSeconds, now);
                if (reachedAt === null) {
                    return;
                }

                const window = record.loopWindowSeconds;
                // The entry pass reaches a cue at `t0 + (cue − entry)`; anything later is
                // a wrap arrival. Restating that one line here is what lets the
                // expectation below be a single exact value instead of a disjunction.
                const entryPassArrival = T0 + (cueSeconds - record.startOffsetSeconds);
                const wrapsOntoLoopStart =
                    window !== null &&
                    cueSeconds === window.startSeconds &&
                    reachedAt > entryPassArrival;

                if (window === null) {
                    seen.nonLooping += 1;
                } else if (reachedAt === entryPassArrival) {
                    seen.entryPass += 1;
                } else {
                    seen.postWrap += 1;
                }

                // `loopStart` reached by a WRAP is the one arrival the two directions
                // name differently, because the wrap instant is both bounds of the
                // window at once and the reader commits to the closed one. This arm is
                // NOT fenced by a counter like the three classes below: measured over
                // eight unseeded runs it drew between 2 and 11 of 500, so a
                // `toBeGreaterThan(0)` on it would be a flake rather than a fence. The
                // test below pins it outright instead.
                expect(voicePlayheadSeconds(record, started(), reachedAt)).toBeCloseTo(
                    wrapsOntoLoopStart ? window.endSeconds : cueSeconds,
                    10,
                );
            }),
            { numRuns: 500 },
        );

        // Each of the three classes the round-trip claims to cover really occurred: a
        // generator drift that stopped producing wraps would otherwise leave the
        // strongest half of this property vacuously green.
        expect(seen.nonLooping).toBeGreaterThan(0);
        expect(seen.entryPass).toBeGreaterThan(0);
        expect(seen.postWrap).toBeGreaterThan(0);
    });

    it('names one instant by both its bounds where the writer reaches loopStart', () => {
        // The property's one disjunction, made deterministic, because reading it out of
        // a generated counterexample is no way to learn what it claims. Entered at 4
        // inside a [2, 6] window, so `loopStart` is behind the entry point and every
        // arrival at it is a wrap. Both answers below are true of the instant they name;
        // the two directions differ only in which bound they name it by.
        const record = timeline(4, { startSeconds: 2, endSeconds: 6 });

        // Asked at the start, the next arrival is one period on and lands on `loopEnd`
        // exactly, so the entry-pass bound answers it.
        expect(nextCueContextTime(record, started(), 2, T0)).toBe(T0 + 2);
        expect(voicePlayheadSeconds(record, started(), T0 + 2)).toBe(6);

        // Asked five seconds in, the next arrival is a period further on, and six
        // seconds of play carry the unwrapped position to 10 — past `loopEnd`, so the
        // WRAP arithmetic answers this one. A different branch reaching the same bound,
        // which is why both are here.
        expect(nextCueContextTime(record, started(), 2, T0 + 5)).toBe(T0 + 6);
        expect(voicePlayheadSeconds(record, started(), T0 + 6)).toBe(6);
    });
});
