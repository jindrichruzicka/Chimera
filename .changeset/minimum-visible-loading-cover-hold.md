---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
---

Add F90 — a minimum visible time for loading covers. One optional registry knob,
`GameScreenRegistry.loadingScreenMinVisibleMs?: number` (in `@chimera-engine/simulation`'s
zero-dependency foundation leaf): once a cover the player can actually see has been shown, it
stays on screen at least that long, so a fast load reads as a beat instead of a flicker. A
wait that outlives the minimum changes nothing, and an absent or `0` value keeps every path
byte-identical — no timer is armed at all.

The renderer half supplies the machinery. `resolveLoadingCoverHoldMs(registry)` is the single
resolver: `0` for absent/zero/negative/non-finite declarations, `0` under
`NEXT_PUBLIC_CHIMERA_E2E === '1'` read at call time (the hold is a deliberate delay like the
screen fades, never a release budget), and deliberately NOT collapsed under
`prefers-reduced-motion`, where zeroed fades make a sub-perceptual flash strictly worse.
`useMinimumVisibleHold(shown, holdMs)` is the shared delayed-release latch — one timer per
release, monotonic stamp at the rise, re-show cancels and re-stamps, StrictMode-safe, and
structurally inert at `0`. Registration warns once (never throws) on a non-finite or negative
declaration, and once — honoring the value, never clamping — on a minimum above
`SCENE_PRELOAD_BUDGET_MS`.

Visibility is the arming condition at every consumer: the hold arms only when the cover
cascade resolves a game-declared form (never the engine placeholder or `'none'`) and nothing
opaque paints over the cover. On `/game` the reveal — the latched app-level fade-in plus the
route cover drop — waits for max(gate settle, shown + minimum), with the faded lobby→game
entry unchanged (the opaque scrim covers the route cover, so a mount-stamped hold would
extend a black screen), a waiting restore bypassing the hold, and `/replays/player` holding
only its cover, `isReady` untouched. `SceneRouter` keeps one held-layer slot for the drops it
cannot defer — the transition cover's host-side commit and a Suspense fallback's chunk
resolution — re-rendering the dropped cover's same cascade resolution (last measured
fraction, or `reason="code"`) as a sibling layer for the remainder, with one clock per visual
wait and at most one cover layer in the DOM at a time. `GameShell` gains an optional
`sceneCoverOccluded` prop threading the pages' occlusion signal through to the router.

Nothing host-visible moves: `useFadeTransition` — the `engine:scene_ready` ack, both fade
channels and the progress protocol — ships byte-identical, and no preload budget widens or
collapses. Additive throughout; a registry without the field behaves exactly as before.
