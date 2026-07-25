import type { AudioCueName } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { PlayOptions } from './AudioManager';

/**
 * Cue, Fade & Crossfade vocabulary — the renderer-side authoring surface for
 * play-from-cue, play-to-cue, loop points, fades, and crossfade (§4.25 — Audio
 * System → Cue, Fade & Crossfade Extensions).
 *
 * These are pure types. The resolver that turns a {@link Cue} into seconds lives
 * in `renderer/audio/audioCueSheet.ts`. `PlayOptions` already consumes
 * `from`/`to`/`loopRegion` and {@link FadeInSpec} via `fadeIn`; {@link FadeToSpec} and
 * {@link FadeOutSpec} reach a voice only through the `AudioManager` verbs
 * (`fadeOut`/`fadeTo`/`crossfade`), which land in later F74 tasks.
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
 * - `{ overMs }` — ramp over `[now, now + overMs]`.
 * - `{ toCue }` — ramp until the playhead reaches the cue.
 * - `{ toEnd: true }` — ramp to the voice's scheduled end.
 */
export type FadeOutSpec =
    | { readonly overMs: number; readonly curve?: FadeCurve }
    | { readonly toCue: Cue; readonly curve?: FadeCurve }
    | { readonly toEnd: true; readonly curve?: FadeCurve };

/** Ramp a live voice's gain to an absolute target and hold (does not stop). */
export interface FadeToSpec {
    /** Absolute stage-1 gain, clamped `[0, 1]`; becomes the new ceiling. */
    readonly to: number;
    /** `≤ 0` or non-finite ⇒ applied instantly. */
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
    readonly durationMs: number;
    /** Defaults to `'equalPower'` (constant perceived power, no mid-fade dip). */
    readonly curve?: FadeCurve;
}
