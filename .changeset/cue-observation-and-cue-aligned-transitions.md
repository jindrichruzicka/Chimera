---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

Add music cue observation and cue-aligned transitions (§4.25), so a game can say "do this at
the next musical boundary" instead of only "do this now".

Two mechanisms, and the separation between them is the feature: **observe to decide, schedule
to execute.** `AudioManager.observeCues` and the `useAudioCues` hook deliver a voice's
`cue` / `loop` / `end` emissions from one on-demand `requestAnimationFrame` sampler — started
by the first observation, cancelled by the last, so a game that observes no cue pays no frame
cost. `crossfadeAtCue` and `fadeOutAtCue` arm a transition now and execute it at the voice's
next arrival at the named cue, through native `source.start(when)` / `source.stop(when)`
against `AudioContext.currentTime` rather than a wall-clock timer. `secondsUntilCue` answers
the read direction of the same timeline.

Starting a transition from an observation callback is the mistake the split exists to prevent:
an emission is at best a frame late, so the swap would land off the beat. The new Invariants
#135 and #136 state each half, and `docs/core-components/audio-system.md` documents which
mechanism answers which question.

The audio barrel gains `useAudioCues`, the cue-event and handler types, and the two
cue-aligned option types; `useMusicTrack`'s control object gains `crossfadeAtCue` and
`fadeOutAtCue`. No new subpath, and no cue-authoring change — `validate-assets` and Invariant
#125 are untouched, and existing sheets pass as they stand.

`apps/tactics` is the reference adopter: its ambience beds now hand over at the `loopEnd` they
already loop on, so a turn passing mid-phrase no longer cuts the music.

Additive throughout — nothing removed or renamed.
