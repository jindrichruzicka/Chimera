---
'@chimera-engine/electron': patch
---

Record why replay playback builds its pipeline at the engine defaults rather than at the recorded
game's declared `matchHistory`.

`ReplayPlaybackManager` is the one `buildHostSessionPipeline` caller that passes neither `undoPolicy`
nor `retainActions`, and the call site now says why. Neither can change what playback produces: a
recorded `engine:undo` ends the replay whatever wiring it meets, because Stage 3 hands back a
reconstruction of an earlier tick and `ReplayPlayer.step()` accepts only `tick + 1`. What the declared
policy would decide is which error ends it, and a declared `retainActions` would additionally raise
`action-history:overflow` on the playback log — a host-time saturation reported against a history no
host is filling. Three cases in `replay-playback-manager.test.ts` hold both halves.
