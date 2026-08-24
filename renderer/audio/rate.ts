/**
 * renderer/audio/rate.ts
 *
 * Musical intervals as playback rates (§4.25 — Audio System).
 *
 * `PlayOptions.rate` resamples the buffer, so speed and pitch move together — a rate of
 * `2` is an octave up AND half the duration. This module exists so that saying "a
 * semitone down" is an interval rather than a restatement of `2 ** (-1 / 12)`.
 *
 * Pure and total, and deliberately NOT a normaliser. `AudioManager` normalises the RATE,
 * with one warning; normalising the INTERVAL here as well would turn a bad one into a
 * playable rate the manager then has no reason to warn about at all.
 */

/** Equal temperament's octave division. */
const SEMITONES_PER_OCTAVE = 12;

/**
 * The playback rate `semitones` above the clip's authored pitch — negative for below.
 * An octave up is `12` and doubles the rate; an octave down is `-12` and halves it.
 *
 * Exponential rather than linear, because pitch is: each semitone multiplies the rate
 * by the twelfth root of two, so the same interval is the same musical distance from
 * wherever it starts.
 */
export function rateFromSemitones(semitones: number): number {
    return 2 ** (semitones / SEMITONES_PER_OCTAVE);
}
