---
'@chimera-engine/renderer': patch
---

Run the scene-to-scene hop on `useLoadingBeat`, the same sequencer the route entries use.

`SceneRouter` served the hop with its own machinery — `useMinimumVisibleHold` plus an epoch that
chained one wait's covers onto a single clock — which produced a compatible order without being
the same machine. Three things followed from that, and all three are gone.

The cover was conditional. `readEnteringScene` answered `null` while no fraction had been
measured, so a scene declaring no `requiredAssets`, or a game shipping no manifest, hopped with
no cover at all while the same registry entering through `/game` got the full beat. The beat
arms on the cascade resolving a game-DECLARED cover, which is what the route entries already do:
a wait that settles before anything could be counted is exactly the wait a floor exists for. The
other side of the same rule is that a registry declaring no cover form now raises no layer at
all here, where the old shape raised one with the engine's empty placeholder inside it.

The rhythm differed. The old site cut its cover and started the reveal in one flush, so its
closing black was a single frame; the beat ramps the cover out over `fadeMs` against the curtain
first, which is the `loading-out` leg every other cover site runs.

Two covers spanned one wait. The transition cover dropped at the host's commit and a held COPY
stood in for the remainder, swapping `scene-preload-cover` for `scene-held-cover` mid-wait. One
cover now spans the whole hop — `LoadingBeatCover`, the same component the route entries mount,
with `surface: 'scene'` — so there is nothing to copy. That layer is `position: fixed`, paints
its own scrim, swallows clicks (it is opaque and can stand over a committed scene, so a click
during the beat is aimed at something the player cannot see), and carries the last measured
fraction across the commit, because `useFadeTransition` releases the progress channel there and
a cover that outlives the commit would otherwise blank while still standing. A superseding hop
starts unmeasured: the channel is released again on the transition KEY changing, so a re-entry
to the same scene never opens showing the previous wait's number.

`useLoadingBeat` gains `ownsReveal`, symmetric with the `ownsDarkening` it already had. The hop
passes `false` for both: `useFadeTransition` owns the fade-out because the `engine:scene_ready`
ack awaits it, and owns the reveal because it is the hook the transition earned that reveal
from. The beat still sequences the reveal — `revealing` is entered on the same terms and
`revealed` is what the owner reads — so only the `fadeIn` call moves.

A code-split chunk is part of a DECLARED hop's wait, folded into `settled` exactly as `/game`
and `/replays/player` already fold it. The reveal is therefore deferred across a `React.lazy`
chunk, the one wait Invariant #133 leaves unbounded. What makes that safe is the LAYER, not a
bound: the beat's own cover stays mounted at `--ch-z-loading-hud`, above the curtain, so a chunk
that never resolves parks the player on the game's declared loading screen rather than on black.
A hop whose cascade resolves NO cover folds nothing in — it has no layer to stand on that
deferral, so its reveal waits on the commit alone and its chunk wait falls back to the Suspense
fallback exactly as before. Where there is no layer there is no deferral. The Suspense
fallback's own cover is suppressed while the hop's layer stands, so one wait is announced once
rather than twice in the accessibility tree.

The held layer is NOT deleted. A within-scene screen switch — `navigateToScreen`, playfield to
tech-tree — has no curtain owner at all: nothing fades, and a beat there would have to black out
a running game to open a tech tree. That wait keeps `useMinimumVisibleHold`, which is the only
way to floor a Suspense cover whose fallback unmounts the instant its chunk resolves. What went
with the convergence is the epoch apparatus, which existed to chain the hop's cover onto the
fallback's clock; the beat's `settled` term does that now.

Nothing host-visible moves: the ack, the fade-out leg, the preload run and the retry cadence are
untouched, and the ack fires at the same tick whatever floor the registry declares.

Three earlier entries in this same pre-release describe the pre-convergence shape and are
consumed by this one. `scene-transition-loading-beat`'s rhythm paragraph ("its
closing black is a single frame"), its held-layer derivation of `coverUp`, and its "a mounted
Suspense fallback is deliberately not a term" paragraph each describe the machine this entry
replaces. `minimum-visible-loading-cover-hold`'s held-slot clause names the transition commit
among the drops the hold serves; the hold now serves a visible fallback's early unmount alone.
`replay-player-loading-beat` says `SceneRouter`'s cover sites "have not adopted the beat"; the
hop now has.
