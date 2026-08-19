---
'@chimera-engine/renderer': minor
---

Pass a scene-to-scene swap through black (F92, §4.36), so a player sees the loading screen alone
on black and the scene revealed out of black, in the order the route entries already run it:
black, the cover, black, the reveal.

The ORDER matches the routes; the rhythm does not. A route beat ramps its cover out over
`fadeMs` against the held curtain, so its closing black is a leg you can see. This site cuts the
cover and starts the reveal in the same flush, so its closing black is a single frame.

Three things stood in the way, and the third is the one that made the other two visible.

**Nothing painted the black.** `TransitionOverlay` used `--ch-color-surface-overlay` — a
translucent dark grey — so the outgoing scene showed through the hold, and `SceneRouter`'s cover
layer declared no background at all, which made it a glyph over whatever happened to stand
behind it. Both now paint `--ch-color-scrim`, the same black the app-level curtain uses. A cover
that declares no backdrop cannot be the only thing on screen without something else being black
for it, which is the defect the beat exists to remove rather than to depend on.

**The curtain left the screen before the reveal.** `TransitionOverlay` returned `null` the
moment `sceneTransition` went null, and it is the only painter inside `GameShell`'s own
`FadeProvider` — so at the host's commit the black stopped being drawn while the fade opacity
was still 1, and the fade-in that followed animated an element that no longer existed. The
scene arrived by a hard cut. The overlay now stays mounted for as long as the curtain is up,
which is a longer span than the transition's: the reveal is deferred past the commit while a
cover serves its minimum.

**The reveal was spent too early.** `useFadeTransition` faded back in the moment the transition
ended, putting the incoming scene on screen underneath a cover still serving its minimum — the
model beside the spinner. It now takes `coverUp` and OWES that fade instead, paying it once no
cover stands in front of the scene. `SceneRouter` derives the flag from its held layer, which
paints at `--ch-z-loading-hud` (150) — above the curtain's `--ch-z-scene-fade` (130).

A mounted Suspense fallback is deliberately not a term. It renders in the screen slot with no
stacking of its own, so it paints BENEATH the curtain: holding the curtain up for it would show
black for the whole wait rather than the loading screen that wait exists to explain. And it
waits on a `React.lazy` chunk, the one wait Invariant #133 leaves unbounded ("a module chunk is
not one"), so deferring on it could park a black screen with no release path. Only a cover that
paints above the curtain, over a wait with a bounded settle, can hold the reveal.

Only the reveal waits. The fade-out leg, the preload run, the four-outcome ack and the retry
cadence never read `coverUp`, so `engine:scene_ready` fires exactly when it did before and a
cosmetic hold on one client can never delay another seat (Invariant #133). The debt is held as
state rather than a ref: a ref write schedules no render, so for a swap that raises no cover
the payment effect would never be reached and the curtain would stay down.

This narrows one clause of `minimum-visible-loading-cover-hold`, whose text otherwise publishes
in the same release. That entry says `useFadeTransition` — "the `engine:scene_ready` ack, both
fade channels and the progress protocol" — ships byte-identical. The ack, the fade-OUT channel
and the progress protocol still do, and those are what the claim was protecting. The fade-IN
channel is now deferred by design, which is the point of the change; that entry is left as
written, being consumed but retained by pre-release mode.

Invariant #133's beat sequence is narrowed to the route entries in the same pass, because this
site is not yet the same machine. It passes through the same black and defers on the same terms,
but it keeps its own sequencer (`useMinimumVisibleHold` plus the epoch, rather than
`useLoadingBeat`) and raises no cover at all for a transition whose preload measures nothing.
Stating one universal over both sites would assert a SEQUENCE one of them does not run, so the
invariant names the divergence instead. Converging the sequencers is a follow-up.
