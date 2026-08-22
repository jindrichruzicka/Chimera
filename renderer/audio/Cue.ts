import type { AudioCueName } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { PlayOptions } from './AudioManager';

/**
 * Cue, Fade & Crossfade vocabulary — the renderer-side authoring surface for
 * play-from-cue, play-to-cue, loop points, fades, and crossfade (§4.25 — Audio
 * System → Cue, Fade & Crossfade Extensions).
 *
 * These are pure types. The resolver that turns a {@link Cue} into seconds lives
 * in `renderer/audio/audioCueSheet.ts`. `PlayOptions` already consumes
 * `from`/`to`/`loopRegion` and {@link FadeInSpec} via `fadeIn`, while
 * {@link FadeOutSpec}, {@link FadeToSpec} and {@link CrossfadeOptions} reach a voice
 * through `AudioManager.fadeOut`, `AudioManager.fadeTo` and `AudioManager.crossfade`.
 *
 * `AudioCueName` is defined sim-side and flows sim → renderer, never the reverse
 * (Invariant #124); it is imported here as a type only.
 */

/**
 * A position in a decoded clip's local timeline:
 * - `number` — seconds from buffer start (always available; needs no metadata).
 * - `'start'` / `'end'` — symbolic bounds (`0` / `buffer.duration`); `'end'` is
 *   buffer-relative, so only resolvable after decode.
 * - `{ name }` — an authored named cue, resolved against the clip's own cue sheet.
 */
export type Cue = number | 'start' | 'end' | { readonly name: AudioCueName };

/** Gain-ramp shape for a fade. Defaults to `'linear'` when omitted. */
export type FadeCurve = 'linear' | 'exponential' | 'equalPower';

/**
 * Start-time fade up to the voice's `volume`, laid down at the voice's real start `t0`.
 *
 * It departs from the curve's floor — true silence, or a `1e-4` epsilon (−80 dB) for
 * `exponential`, which is a ratio and cannot leave zero. A `durationMs` outlasting the
 * voice's scheduled end is TRUNCATED rather than compressed: the fade keeps the rate it
 * authored and is cut off, so it may never reach `volume`. A non-finite `durationMs`
 * names no window and is applied instantly, as no fade at all.
 */
export interface FadeInSpec {
    readonly durationMs: number;
    readonly curve?: FadeCurve;
}

/** Loop bounds as a pair of cues; setting this implies `loop = true`. */
export interface LoopRegion {
    readonly start: Cue;
    readonly end: Cue;
}

/**
 * Fade-out target — each variant ramps stage-1 gain to `0`, then stops:
 * - `{ overMs }` — ramp over `[now, now + overMs]`. A non-positive or non-finite
 *   `overMs` names no window and silences the voice at once, as no fade at all.
 * - `{ toCue }` — ramp until the playhead next reaches the cue, loop-period-aware. A
 *   cue the playhead will not reach again — already passed, or outside the loop
 *   window — silences and stops the voice immediately, with a warning. An unresolvable
 *   `{ name }` degrades to the buffer end SILENTLY, since an end-point cue never
 *   abandons: on any voice that still reaches its end a mistyped cue is a full-length
 *   fade, not a diagnosed one.
 * - `{ toEnd: true }` — ramp to the voice's scheduled end; a voice that has none falls
 *   back to a 250 ms ramp, with a warning. Both an unbounded loop and a bounded one
 *   whose stop the platform refused arrive there.
 *
 * Every variant's ramp end is clamped to any stop already scheduled, so a fade can
 * shorten a voice's remaining life and never extend it.
 */
export type FadeOutSpec =
    | { readonly overMs: number; readonly curve?: FadeCurve }
    | { readonly toCue: Cue; readonly curve?: FadeCurve }
    | { readonly toEnd: true; readonly curve?: FadeCurve };

/**
 * Ramp a live voice's gain to an absolute target and hold — a dip or a swell, never a
 * release.
 *
 * Only the ramp WINDOW clamps to the voice's scheduled end, deliberately unlike a
 * fade-in: `to` is an absolute ceiling the caller named, so lowering it would silently
 * rewrite the request. The ramp is therefore COMPRESSED into what remains rather than
 * truncated, and reaches the full `to` at the clamped end. Nothing about the voice's death
 * moves either, and Web Audio cannot un-schedule a stop — so a voice already fading out is
 * re-targetable but still dies on time, and `{ to: 1 }` on one peaks at full gain on the
 * exact sample it stops.
 */
export interface FadeToSpec {
    /** Absolute stage-1 gain, clamped `[0, 1]`; becomes the voice's new ceiling. */
    readonly to: number;
    /** `≤ 0` or non-finite ⇒ names no window, so it is applied instantly. */
    readonly durationMs: number;
    readonly curve?: FadeCurve;
}

/**
 * Crossfade options — `play(incoming, { fadeIn })` plus a linked fade-out of the
 * outgoing voice, both anchored to one shared start. Tracks {@link PlayOptions}
 * minus `fadeIn`, which the crossfade owns and derives from its own `durationMs`
 * and `curve`; passing one here is a type error.
 */
export interface CrossfadeOptions extends Omit<PlayOptions, 'fadeIn'> {
    /**
     * The window BOTH halves author, from the incoming voice's real start. Each still
     * clamps its own end against its own voice's scheduled stop, so the two coincide only
     * when neither does. `≤ 0` or non-finite names no window on either half, so the swap is
     * instant: the incoming voice lands at `volume` and the outgoing one is silenced and
     * stopped at `t0`.
     */
    readonly durationMs: number;
    /**
     * Defaults to `'equalPower'`. Constant perceived power across the pair — no mid-fade
     * dip — holds for a MATCHED pair only: see `AudioManager.crossfade` for the two
     * preconditions (one shared window, equal distances), neither of which is enforced.
     */
    readonly curve?: FadeCurve;
}

/**
 * Cue-aligned crossfade options — {@link CrossfadeOptions} plus the cue the swap is armed
 * at. The pair itself is unchanged: what moves is WHEN both halves are anchored, from the
 * call to the outgoing voice's next arrival at {@link atCue}.
 */
export interface CueAlignedCrossfadeOptions extends CrossfadeOptions {
    /**
     * A position on the OUTGOING voice's own timeline, resolved under end-point rules
     * against that clip's cue sheet — so an absent `{ name }` degrades to its decoded end
     * rather than abandoning, exactly as `fadeOut({ toCue })` resolves one.
     *
     * The arrival is read from the outgoing voice's schedule when the incoming clip
     * DECODES, not at the call: a decode that lands after the cue then takes the next
     * arrival rather than an instant already gone. See `AudioManager.crossfadeAtCue` for
     * what each branch leaves audible.
     */
    readonly atCue: Cue;
}

/**
 * A fade-out held until a cue and then run from there — the arming half and the fade
 * itself, kept as two fields because they name two different instants.
 *
 * Deliberately not reducible to `fadeOut({ toCue })`, which ramps TO a cue over the window
 * ending there. This one STARTS at the cue: the voice plays on unchanged until the
 * playhead reaches it, and only then does {@link fade} begin. `{ atCue: X, fade: { toCue: Y } }`
 * composes the two. See `AudioManager.fadeOutAtCue` for what each of them leaves when the
 * playhead does not reach the cue it names.
 */
export interface CueAlignedFadeOutSpec {
    /**
     * Where the ramp BEGINS, on this voice's own timeline. Resolved under the same
     * end-point rules as {@link CueAlignedCrossfadeOptions.atCue}, and read once, at the
     * call — there is no decode to wait for here.
     */
    readonly atCue: Cue;
    /**
     * The fade to run from there, in full: every {@link FadeOutSpec} variant, resolved
     * against the cue instant rather than against the call. So `{ overMs }` is a window
     * that opens at the cue, `{ toCue }` names the NEXT arrival after it, and
     * `{ toEnd: true }` ramps from the cue to the voice's scheduled end.
     */
    readonly fade: FadeOutSpec;
}
