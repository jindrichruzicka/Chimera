/**
 * tacticsSfxJitter.ts
 *
 * Tactics' own per-play pitch variation for the board's derived SFX.
 *
 * `step` plays on every move and `swordHit` on every attack the viewer can see.
 * Played at the authored rate they are bit-identical every time, and a burst of
 * identical samples reads as a defect rather than as a run of footsteps. A small
 * detune per play is what makes them read as separate events.
 *
 * The variation is the GAME's, not the engine's: a game that wants it authors it
 * and hands the result in as `PlayOptions.rate`. Tactics authors it SEEDED rather than from
 * `Math.random`, keyed on the tick: a turn draws the same intervals however often
 * it is played back, so a replay hears the turn it recorded rather than a fresh
 * set of pitches. The claim is about the TURN and not about a unit — which
 * interval lands on which unit follows the cue order, and the delta walks the
 * projection's unit order, which no projection promises to preserve.
 *
 * What it returns is an INTERVAL in semitones, not a rate. `rateFromSemitones`
 * is the conversion, and it lives behind the `@chimera-engine/renderer/audio`
 * barrel — reachable from the board (a `.tsx` game surface) and not from a plain
 * `.ts` helper like this one (Invariant #96). Semitones are also the honest unit
 * for the band: a fixed interval is the same musical distance up as it is down,
 * where a fixed rate offset is not.
 */

import { createRng } from '@chimera-engine/simulation/engine/DeterministicRng.js';

/**
 * Half-width of the jitter band, in semitones — the furthest a play may sit from
 * the clip's authored pitch, in either direction. Small on purpose: this is meant
 * to be heard as the same footstep twice, never as two different boots.
 */
export const TACTICS_SFX_JITTER_SEMITONES = 1.5;

/**
 * The jitter stream's seed. Any fixed value serves; what the constant buys is
 * that it is fixed, which is what makes a turn's pitches reproducible. It is not
 * the match seed and must not become it — a footstep's pitch is presentation and
 * has no business moving with gameplay randomness.
 */
const TACTICS_SFX_JITTER_SEED = 0x5eed;

/** Draws span `[0, 1)`; the band spans `[-1, 1]` of its half-width. */
const DRAW_SPAN_TO_BAND_SPAN = 2;

/**
 * The interval a draw in `[0, 1)` names: the low end of the band at `0`, the
 * clip's authored pitch at `0.5`, and the high end at the `1` no draw returns.
 * Linear in the INTERVAL, so the band is symmetric by ear rather than by rate.
 */
export function tacticsSfxJitterSemitones(draw: number): number {
    return (draw * DRAW_SPAN_TO_BAND_SPAN - 1) * TACTICS_SFX_JITTER_SEMITONES;
}

/**
 * One turn's stream of jitter intervals: call the result once per play, in the
 * order the turn's cues are played.
 *
 * Per TURN rather than per mount or per play. Per mount would give every turn's
 * first step one pitch; per play would need a second key to tell two cues of the
 * same turn apart, and the turn's own cue order already does that.
 */
export function createTacticsSfxJitter(tick: number): () => number {
    const rng = createRng(TACTICS_SFX_JITTER_SEED, tick);
    return () => tacticsSfxJitterSemitones(rng.float());
}
