---
'@chimera-engine/renderer': minor
---

Make `loadingScreenMinVisibleMs` mean one thing everywhere (F92, §4.36), and sweep the prose
that described the old two-resolver split.

There were two resolvers, and they disagreed on the case a game is most likely to hit. A route
entry read `resolveLoadingBeatFloorMs`, where an absent declaration means the engine default of
400 ms. An in-game scene hop read `resolveLoadingCoverHoldMs`, where an absent declaration means
no floor at all. So a game that declared `loadingScreen` and left the minimum alone got a
readable loading screen on the way into the game and a flash on every scene hop — one knob, two
answers, and the difference invisible from the registry.

`resolveLoadingCoverHoldMs` is deleted and every cover site arms
`resolveLoadingBeatFloorMs`. A declared minimum was already honoured identically by both, so the
only behaviour that moves is the DEFAULT: a raised cover with no declared minimum is now held
long enough to read, wherever it is raised. A declared `0` still opts down to gate-settle-only —
it is the one value that must not reach the fallback — and the floor still collapses under
`NEXT_PUBLIC_CHIMERA_E2E`, still does not collapse under `prefers-reduced-motion`, and is still
a floor rather than a delay added to a slow load.

This reaches the within-scene screen switch too (`navigateToScreen`, playfield → tech-tree),
which previously had no floor. That wait keeps the held layer and no fade: it is local UI
navigation with no curtain owner, so there is nothing to sequence a beat against, and darkening
a running game to open a panel would be worse than the flash. It arms the same floor.

The registration warns were reworded, because one of them was reporting the retired resolver's
behaviour: an invalid declaration was said to be "treated as 0" when it now falls back to the
engine default — a warn that misreports the outcome sends the author looking for a cover that is
on screen the whole time. The over-budget warn now says what the over-budget case actually costs
rather than implying it is a fault. Invariant #133's floor-divergence clause is corrected in the
same pass: the floors have converged, so what remains between the two sites is the SEQUENCER —
the scene site latches with `useMinimumVisibleHold` where the routes sequence with
`useLoadingBeat`, which makes its closing black a single frame rather than a leg.
