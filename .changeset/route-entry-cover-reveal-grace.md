---
'@chimera-engine/renderer': minor
---

Reveal a route-entry loading cover when the wait turns out to be long, instead of leaving it
under the entry scrim for its whole life. `GameScreenRegistry.loadingScreen` and
`loadingScreenMinVisibleMs` (§4.36) were structurally inert on lobby→game — the only path a
player takes into a match. `GameStoreBootstrap` runs its fade-out to completion before pushing
`/game`, so the route mounted under an opaque scrim; the cover resolved and mounted correctly,
but the fade-in that clears that scrim was itself gated on the reveal, so the scrim never
lifted while the wait ran, the minimum-visible floor never armed, and the player saw black.
Measured on 1.0.0-rc.7 with a scaffolded game declaring `'spinner'` and a 2000 ms minimum: the
cover mounted, dropped 476 ms later at the settle, and the scrim read opacity 1 at every sample.

The guard the arming condition encodes is kept — a hold stamped at a cover's mount really would
extend a black screen. What changes is when visibility is decided. `ROUTE_COVER_REVEAL_GRACE_MS`
(350 ms, exported from `renderer/assets/criticalAssetPreload.ts` beside the preload budget) times
a wait spent under an opaque scrim on a fixed timer that reads no gate, no progress and no asset
state; if the wait is still running when it fires, the route eases its own scrim off — the
entry's one fade-in, brought forward, under the same leave and lobby-phase suppressors — and the
floor stamps from that clear. A wait that settles first is unchanged: the scrim stays black, the
cover is dropped unseen, one fade-in at the reveal. The declared minimum is what opts an entry
in, so a cover declared without one keeps the previous path.

A cover the player saw now leaves on a fade over the scene already rendering beneath it rather
than a cut, on both `/game` and `/replays/player` — one fade instead of returning through black
for two — and `sceneCoverOccluded` follows the cover through that ramp so `SceneRouter` surfaces
no held layer under a cover that is still painting. A waiting restore keeps its immediate
release and takes the cut, since the overlay that aborts it sits below the cover.

Two hooks are added under `renderer/components/scene/`: `useRouteCoverRevealGrace` (the timer)
and `useCoverExitRamp` (the fade-out window). `RouteEntryLoadingCover` gains optional `exiting`
and `exitMs` props; with neither supplied its rendered style is unchanged. The exit ramp takes its duration from `screenFadeMs()`,
so it collapses to a cut under `NEXT_PUBLIC_CHIMERA_E2E` and under `prefers-reduced-motion`;
the minimum itself collapses only under the flag, and deliberately not under reduced motion. `ROUTE_COVER_REVEAL_GRACE_MS` carries no env read of its own and needs none: an
entry arms the grace only where the floor resolved positive, and that resolver already returns
`0` under the flag, so the flag disarms the grace at its arming condition, and the unit suites
are what carry it. No mount, ack, host barrier or
release budget is affected (Invariant #133).

This supersedes clauses of the F90 entry above it. That entry says the faded lobby→game
entry is left unchanged, which was true of F90 and is what this change corrects; and it says an
absent or `0` minimum keeps every path byte-identical, which now holds of the minimum-visible
hold alone — the exit ramp arms on whether a cover was seen, not on the floor, so a game that
declares a cover without a minimum gets it. The F90 changeset is
left as written — it is consumed but retained by pre-release mode, and its text has already been
published in the 1.0.0-rc.6 changelog.
