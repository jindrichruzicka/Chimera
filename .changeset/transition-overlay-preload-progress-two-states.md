---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': patch
---

`TransitionOverlayProps.preloadProgress` narrows from `number | null | undefined` to
`number | undefined`. The `| null` arm documented a third state — "running, but the wait is not
measured" — that no game overlay could ever be handed: `useFadeTransition` reports a number only
for a run that measures something and publishes `null` purely to release its own channel at the
commit, and `SceneRouter` withholds the prop on that `null` rather than passing it on. An adopter
branching on `null`, which is exactly what the removed sentence invited, wrote a branch that never
ran and silently took the absent-prop path instead.

An unmeasured wait is now stated one way only, the way the engine's own overlay already relied on:
the prop is absent, so `data-preload-progress` is omitted rather than printing a word or drawing an
empty bar as a claim nobody measured. Two states, and a game reads them as "a fraction" or "no
measured fraction".

A game overlay that declared `preloadProgress?: number | null` still fits the slot — the slot reads
its props type contravariantly. What the narrowing rejects is an ASSIGNMENT of `null` to the field;
a `=== null` comparison still compiles, so an overlay that already wrote the dead branch is not told
about it. Nothing about what is rendered moves.

The sibling cover contract is deliberately untouched: `GameLoadingScreenProps.progress` stays
`number | null` and required, because `null` really does arrive there — a code-split `import()`
exposes no progress channel, and `SceneRouter` passes `progress={null}` for the `'code'` reason.
