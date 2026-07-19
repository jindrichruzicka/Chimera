---
'@chimera-engine/renderer': patch
---

Silenced a spurious AudioManager console warning during static-export prerendering.
`createAudioManagerForEnvironment` now returns the noop audio manager behind a
`typeof window` guard when no `AudioContext` is available (Next static export runs
`Providers` once per route in Node), matching the SSR guards already used in the
providers module. The warn path is preserved for genuine client-side failures.
