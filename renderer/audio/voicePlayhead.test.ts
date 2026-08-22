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
