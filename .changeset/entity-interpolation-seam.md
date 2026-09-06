---
'@chimera-engine/renderer': patch
'@chimera-engine/action': patch
'@chimera-engine/tactics': patch
---

Add an engine-owned entity interpolation seam, and move both reference games onto it.

`useEntityInterpolation({ entityId, target, durationMs, snapDistance? })` smooths one entity between
two authoritative positions and returns the ref to attach to the object being moved. It writes the
transform from `useFrame` through that ref, so a moving entity costs no React commit per frame.

A game whose entities live on a unit grid advances them a whole cell per beat, so an entity driven
straight from the snapshot teleports one cell at a time — ten visible steps a second at
`apps/action`'s 100 ms beat, and a diagonal step covering √2 world units at once. The hook draws the move instead of the
arrival, at the cost of showing the entity up to one beat behind the host; that delay is stated in
the hook's contract rather than left to be discovered, and anything that must agree with the host
reads the snapshot instead.

Three discontinuities are handled rather than smoothed: an entity appearing mid-match starts where it
belongs instead of sliding in from the origin, a change of `entityId` snaps, and a move at least
`snapDistance` far snaps — a deliberate teleport is not a fast walk.

`durationMs` is the caller's, because a game's beat is not something the renderer holds. `apps/action`
passes the same constant its manifest declares `tickRateMs` from. `apps/tactics` already tweened its
units this way and now does it through the shared hook,
which deletes its private copies of `lerp` and the ease-out curve; its duration is still the
`--ch-duration-normal` motion token, so reduced motion still collapses the movement to an instant
one.
