---
'@chimera-engine/renderer': minor
---

Run the loading beat on the `/replays/player` entry (F92, §4.36), the same sequence `/game`
already runs: black, an opaque cover held at least its floor, black, then the replay and its
transport controls together. The cover is full-viewport and painted above the app curtain
rather than nested in the playfield wrapper, so the controls arrive with the replay instead of
sitting over a frame that has not loaded.

This route owns no fade of its own, which is why it previously kept a visibility-armed hold
instead: a fade-in here can cancel the fade-out `GameStoreBootstrap` runs when a replay's Leave
broadcasts a lobby snapshot, and a cancelled fade resolves its promise early, so the navigation
chained to it lands mid-ramp. The beat therefore carries TWO suppressors, because the hazard
arrives two ways. A Leave clicked on this page latches a ref. A host's Leave from a post-game
replay instead arrives as a broadcast `phase: 'lobby'` snapshot with nothing here clicked — and
the in-game menu that would have latched the ref is itself withheld until the reveal, so the
latch could never fire in time. The route reads the live match's phase for that case, the same
term `/game` carries.

`useCoverExitRamp` is removed with its last consumer: the beat's closing leg returns through
black rather than fading a cover out over the scene beneath it. `RouteEntryLoadingCover` is
removed with it, having no production caller left; `resolveRouteCoverTarget` and
`isRouteCoverGameDeclared` move to `renderer/components/scene/resolveLoadingScreen.ts`, beside
the cascade they read, and keep their behaviour and their tests.

This supersedes clauses of `route-entry-cover-reveal-grace`, whose text otherwise publishes in
the same release as this change: the exit ramp it adds
is gone from both routes, so a seen cover no longer leaves on a fade over the scene beneath it
but through the beat's own black; and the two hooks it names, along with the `exiting` /
`exitMs` props it gives `RouteEntryLoadingCover`, no longer exist.
The minimum-visible hold and `resolveLoadingCoverHoldMs` survive for `SceneRouter`'s own cover
sites, which have not adopted the beat.
