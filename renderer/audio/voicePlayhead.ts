/**
 * renderer/audio/voicePlayhead.ts
 *
 * A voice's playhead timeline, read in both directions (§4.25 — Audio System → Cue,
 * Fade & Crossfade Extensions):
 *
 * - {@link nextCueContextTime} — when does the playhead next reach buffer position X?
 * - {@link voicePlayheadSeconds} — which buffer position does it hold at context time T?
 *
 * The two are duals and live together because they have to agree at every boundary,
 * and a boundary they disagree about is invisible while each is checked against a
 * table of its own. The one arrival they name differently is a WRAP: `loopEnd` and
 * `loopStart` are the same instant there, and the reader commits to `loopEnd` — the
 * same closed-window convention that makes a cue AT `loopEnd` reachable once per pass
 * rather than never (`fadeOut({ toCue: 'end' })` on a whole-buffer loop rests on it).
 *
 * Pure, and deliberately clock-free (Invariant #122): `now` is a parameter, so the
 * module reaches no `AudioContext`, no framework and no timer. The caller supplies the
 * only clock there is, which is what keeps the maths testable with no fake timers, and
 * `__tests__/voicePlayhead-purity.test.ts` holds the module to it.
 *
 * Both functions take the schedule facts structurally rather than a `VoiceRecord`, so
 * nothing here can reach a node, a gain or a phase — the record satisfies them by
 * shape.
 */

/** A resolved `[loopStart, loopEnd]` region in buffer-local seconds. */
export interface LoopWindowSeconds {
    readonly startSeconds: number;
    readonly endSeconds: number;
}

/** The schedule facts a voice's timeline is derived from, as written at its start. */
export interface VoiceTimeline {
    /** `start()`'s offset argument — the POST-fold entry point into the buffer. */
    readonly startOffsetSeconds: number;
    /** The EFFECTIVE loop window as started, or `null` when the voice does not loop. */
    readonly loopWindowSeconds: LoopWindowSeconds | null;
}

/** The start facts only a STARTED voice has; a `'loading'` one has neither. */
export interface StartedTimeline {
    /** The context time `source.start(when)` was scheduled for, which may be ahead of the clock. */
    readonly startedAtContextTime: number;
    /** The DECODED buffer's duration — the timeline the voice was scheduled against. */
    readonly bufferDurationSeconds: number;
}

/**
 * The buffer-local position the playhead holds at `now`, or `null` when the voice has
 * none — Invariant #122, read direction. The dual of {@link nextCueContextTime}, and
 * derived from the same four facts at a fixed `playbackRate` of 1, so it needs no
 * sampling of the source and no clock of its own.
 *
 * `null`, never `0`, for the two ways the BUFFER timeline puts a voice outside itself:
 * a start still AHEAD of `now` (a voice scheduled at a future context time has not
 * begun, and subtracting anyway would report a position behind the entry point as
 * though the playhead were sitting in it), and a non-looping voice `now` has carried
 * past the decoded duration. The duration bounds a non-looping voice ONLY — a loop
 * never runs past `loopEnd`, whatever the buffer behind it is worth.
 *
 * A voice's SCHEDULED end is a third bound and deliberately not one of these: it is an
 * absolute context time the manager writes and rewrites (a `to` bound at the start, a
 * fade-out's ramp end later), not a fact about the buffer, so applying it belongs with
 * the caller that owns it.
 *
 * The window is CLOSED at `loopEnd`: at a wrap instant the playhead is at `loopEnd`
 * and `loopStart` at once, and this reports `loopEnd`, matching what
 * {@link nextCueContextTime} treats as reachable.
 */
export function voicePlayheadSeconds(
    record: VoiceTimeline,
    started: StartedTimeline,
    now: number,
): number | null {
    const startedAt = started.startedAtContextTime;
    if (now < startedAt) {
        return null;
    }

    // Where the playhead would be if nothing wrapped: the entry point plus elapsed
    // context time. Every branch below is about what the schedule does to that.
    const unwrapped = record.startOffsetSeconds + (now - startedAt);
    const window = record.loopWindowSeconds;

    if (window === null) {
        return unwrapped > started.bufferDurationSeconds ? null : unwrapped;
    }

    const { startSeconds: loopStart, endSeconds: loopEnd } = window;
    if (unwrapped <= loopEnd) {
        // Still in the ENTRY pass, which runs from the entry point out to the window
        // end — and which starts before `loopStart` whenever a clip plays an intro.
        return unwrapped;
    }

    const period = loopEnd - loopStart;
    if (period <= 0) {
        // A window carrying no period advances nowhere, so the playhead sits on it.
        // Matches {@link nextCueContextTime}, which offers such a voice no next pass.
        return loopEnd;
    }

    const phase = (unwrapped - loopStart) % period;
    // A zero phase is a wrap instant, not the top of a pass: naming `loopStart` there
    // would break the round-trip for every cue AT `loopEnd`, which is reached on every
    // pass rather than only on the entry one.
    return phase === 0 ? loopEnd : loopStart + phase;
}

/**
 * The context time the playhead NEXT reaches `cueSeconds`, or `null` when it never will
 * — Invariant #122. Derived from `startedAtContextTime`, `startOffsetSeconds` and the
 * effective loop window at a fixed `playbackRate` of 1, so it needs no timer and no
 * sampling of where the playhead currently is. A voice whose start is still AHEAD of
 * `now` is bounded by that start as well, so no arrival is named in the gap before its
 * first sample — while the instant it begins IS one, unlike an instant `now` sits on,
 * which the playhead has already reached.
 *
 * A looping voice runs its ENTRY pass from `startOffsetSeconds` out to the window end,
 * then repeats `[loopStart, loopEnd]` forever, so a cue is reached in the entry pass,
 * on some later pass, or never. "Never" covers a cue that has gone by on a non-looping
 * voice, one before `loopStart` that only the intro played, and one past `loopEnd` — all
 * the same thing from the caller's side, and all answered with `null`.
 *
 * The window is treated as CLOSED at `loopEnd`: that is where the playhead wraps, so a
 * cue there is reached once per pass rather than never — which is what makes
 * `{ toCue: 'end' }` on a whole-buffer loop a fade over the current pass instead of an
 * instant cut.
 */
export function nextCueContextTime(
    record: VoiceTimeline,
    started: StartedTimeline,
    cueSeconds: number,
    now: number,
): number | null {
    const startedAt = started.startedAtContextTime;
    const entrySeconds = record.startOffsetSeconds;
    const window = record.loopWindowSeconds;

    if (window === null) {
        // No loop: every position is passed exactly once, and only FORWARD from the entry
        // point, so an arrival is real when the cue is at or after that point and the
        // instant is still ahead of the clock. Two comparators rather than one, because a
        // cue behind the entry can land after `now` on a voice scheduled AHEAD of the
        // clock, and that instant is a position the playhead is never at.
        const reachedAt = startedAt + (cueSeconds - entrySeconds);
        return cueSeconds >= entrySeconds && reachedAt > now ? reachedAt : null;
    }

    const { startSeconds: loopStart, endSeconds: loopEnd } = window;
    const period = loopEnd - loopStart;

    if (cueSeconds > loopEnd) {
        // Past the window: the entry pass runs out to `loopEnd` and every pass after it
        // wraps there, so the playhead never gets this far.
        return null;
    }

    // A cue at or after the entry point is reached in the ENTRY pass, unless the clock is
    // already past it. Behind that point it is not in the entry pass at all and needs no
    // branch of its own: it falls through to the period advance below, which puts it
    // exactly one period on, at `(loopEnd − entry) + (cue − loopStart)`. The two are the
    // same instant, and naming the wrap separately would only compute it twice.
    //
    // The comparators differ on purpose. `>=` against the entry admits a cue sitting ON
    // it, which is a real arrival at the voice's own start; `>` against the clock does
    // not admit one sitting on `now`, which is where the playhead already IS. One
    // comparison could not say both, and a scheduled start is where they come apart.
    const reachedAt = startedAt + (cueSeconds - entrySeconds);
    if (cueSeconds >= entrySeconds && reachedAt > now) {
        return reachedAt;
    }

    // The NEXT pass over it, if the loop returns there at all, counted from where the
    // search really begins: `now` for a voice already playing, its own start for one
    // still scheduled, which has played nothing to be past yet. A cue before `loopStart`
    // was in the intro and is never replayed; a degenerate zero-length window replays
    // nothing. `floor(…) + 1` rather than `ceil`, so a cue the playhead is sitting
    // exactly on waits a whole period — a looping voice always has a next arrival, and
    // fading over it beats the cut that a cue which never comes back has to take.
    const from = startedAt > now ? startedAt : now;
    const repeats = cueSeconds >= loopStart && period > 0;
    return repeats ? reachedAt + period * (Math.floor((from - reachedAt) / period) + 1) : null;
}
