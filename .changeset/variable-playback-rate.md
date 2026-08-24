---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

Add F86 — variable playback rate (§4.25), so a game can pitch a clip per play instead of
hearing one bit-identical sample every time.

`PlayOptions.rate` resamples the voice, so **rate and pitch move together** — `2` is an octave
up and half the duration. The option is spelled `rate` rather than `pitch` because that is what
it does: there is no time-stretch and no independent pitch shift. `rateFromSemitones(n)` is the
musical spelling of the same number (`2 ** (n / 12)`), exported from the existing
`@chimera-engine/renderer/audio` barrel — no new subpath. `useSound` keys the new field, so a
`rate` change hands back a fresh callback.

The rate is **immutable for the life of the voice**: normalised once inside `play()`, written to
the voice record, and never rewritten — there is no `setVoiceRate`. That is what keeps every
buffer-seconds-to-wall-clock conversion a single division rather than an integral of rate over
time, and it is why this lands as an amendment to **Invariant #122** rather than as a new number.
A non-positive or non-finite rate plays at `1` with one warning naming the value; the
normalisation sits below every synchronous branch that declines the play, so a refusal is never
narrated as a rate complaint.

The voice timeline is now rate-aware throughout: cue arrivals (`secondsUntilCue`,
`fadeOut({ toCue })`, the cue-aligned verbs), the observed playhead, the loop-period advance and
a non-looping voice's implicit end all convert through the voice's own rate. Fade windows do
**not** — `fadeIn.durationMs`, `fadeOut({ overMs })`, `fadeTo` and a crossfade's duration are
wall-clock milliseconds at every rate.

A **bounded** non-looping play at a rate other than `1` is realised by
`source.stop(startedAtContextTime + durationSec / rate)` instead of `start()`'s third argument,
whose buffer-relative reading under a resample is not portable — the same reason the looping
branch already schedules a stop. The native `onended` still drives the single release path of
Invariant #119. At rate `1` nothing changes: no `playbackRate` write is made and the duration
argument is still used, so the existing call sequence is byte-identical rather than merely
equivalent.

`EventAudioOverrides.rate` is now forwarded into the play options by the engine's event-audio
player; it had been typed and reserved with no consumer.

`apps/tactics` is the reference adopter: the board's delta-derived `step` and `swordHit` are
pitch-jittered from the game's own seeded per-turn stream, so a replay hears the turn it
recorded. The randomness is the game's — the engine supplies none.

Additive throughout — nothing removed or renamed.
