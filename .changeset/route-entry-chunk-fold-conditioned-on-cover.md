---
'@chimera-engine/renderer': patch
---

A route entry no longer holds the loading beat on a black curtain while the entering screen's
code-split chunk is in flight and no cover is declared for that entry.

Both route entries, `/game` and `/replays/player`, folded the chunk wait into the beat's settle
term unconditionally, while the scene hop in `SceneRouter` conditions the same fold on a
declared cover. An entry the cascade resolves no cover for raises no layer, so the beat parked
on `covered` — a phase that mounts no cover at all — and the deferral held the black curtain
over nothing for as long as the chunk took. It is the shipped path for any game whose registry
declares no route-wide loading screen.

Each entry now conditions the fold on its OWN resolved cover. An undeclared entry reveals on
the asset gate and lands on the Suspense fallback; a declared entry keeps the fold its cover
pays for. Invariant #133 is restated to match: the fold is conditioned on the surface's own
resolved cover, and where there is no layer there is no deferral.
