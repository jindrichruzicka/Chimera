---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

Add `@chimera-engine/renderer/audio`, a sixth public barrel, so a game can reach the cue /
fade / crossfade surface at all. The verbs landed on `AudioManager` across F74, but the hooks
that call them were renderer internals with no entry in the `exports` map, and Invariant #96
allows a game surface only a public barrel — so the feature had no possible caller outside its
own tests.

The barrel ships the audio hooks, an `AudioManagerProvider`, the `MUSIC_PRIORITY` and
`DEFAULT_FADE_CURVE` constants, and the option/handle/manager type surface those calls
take; its own header is the index.
`renderer/app/providers.tsx` now mounts the provider instead of the raw context, with no
behaviour change.

Additive throughout — nothing removed or renamed — and curated rather than open: the
modules behind the barrel stay internal, which Invariant #96 states and
`chimera/no-game-renderer-internals` enforces.
