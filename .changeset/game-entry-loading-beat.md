---
'@chimera-engine/renderer': minor
---

Run the loading beat on the `/game` entry (F92, §4.36): black, an opaque loading cover held for
at least its floor, black, then the scene and its HUD together. A game that declares a cover
form now gets that sequence on every entry, including one whose critical preload settles before
anything could have been shown.

The mechanism this replaces could not deliver that, and the reason was structural rather than a
tuning problem. The route cover painted no background, so it was a glyph over whatever stood
behind it; the only lever that could make it visible was easing the entry scrim off, and the
scrim is what hides the scene. A wait that settled inside `ROUTE_COVER_REVEAL_GRACE_MS` was
therefore dropped unseen, and one that outlived it showed a spinner over a live board with the
HUD already up. Measured on 1.0.0-rc.7 with a scaffolded game declaring `'spinner'` and a
5000 ms minimum over one critical model: the model settled in ~150 ms, the cover mounted at
~180 ms and was dropped at ~340 ms, and the floor never armed.

`LoadingBeatCover` is the new surface: opaque `--ch-color-scrim`, filling the VIEWPORT rather
than its positioned ancestor, and portaled to the document body on a route so it escapes the
stacking context `AppShell` wraps routes in — inside it a cover's `--ch-z-loading-hud` is local
while the app scrim is a sibling above, which is why the scrim used to paint over the cover. It
rises on an animation frame rather than in its mounting flush, because a transition whose start
and end land in one paint is not animated. Unlike the cover it replaces it swallows clicks: it
is opaque, so a click during the beat is aimed at something the player cannot see.

`GameShell` receives the beat's state through the seam added alongside it — the HUD row and the
in-game menu host mount at the reveal, under the closing black, so the grid row they add
resizes the canvas before the player is looking at it. `sceneCoverOccluded` is now simply the
beat not having revealed.

Removed with the mechanism they served: `ROUTE_COVER_REVEAL_GRACE_MS`,
`useRouteCoverRevealGrace`, and the two fade-in effects that shared a latch on this route. The
restore-abort exit now asks the curtain where it is rather than tracking whether a fade
happened, which is also the correct question for an abort that lands mid-beat.

Invariant #133 is amended, never renumbered: the floor-on-a-shown-cover clauses and the grace
derivation are replaced by the beat, which defers the local reveal and the HUD's mount and
nothing else — no mount of `GameShell`, no ack, no host barrier — and adds no release path of
its own, since its cover leg waits on the gate's own four settle paths.
