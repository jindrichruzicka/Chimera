---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
'@chimera-engine/electron': minor
'@chimera-engine/tactics': patch
---

Asset-gated scene reveal: a scene's declared `requiredAssets` now gate what a player
SEES, on both entry paths, without ever gating a mount or the host's barrier.

Before this, `SceneDescriptor.requiredAssets` was a declaration `validate-assets`
checked and no code read at runtime. A scene could name every ref it needed and the
player would still watch them pop in after the fade.

**The declaration now travels on two carriers.** A scene being ENTERED carries it on
`SceneTransitionState.requiredAssets`, which `startScenePreload` promotes and awaits
before the client dispatches `engine:scene_ready`. A scene already COMMITTED carries it
on the new `BaseGameSnapshot.sceneRequiredAssets`, which `useCriticalAssetPreloadGate`
promotes for a route entered mid-scene — a restore or a replay — so that path is gated
too rather than only a live transition.

**Fail-open is the guarantee, not a fallback.** Both arms settle on four independent
paths: the load resolving, the load REJECTING, an elapsed budget
(`CRITICAL_ASSET_PRELOAD_BUDGET_MS` = 8 s for the route arm,
`SCENE_PRELOAD_BUDGET_MS` = 5 s for the transition arm), and a nothing-to-load
short-circuit. No combination of a missing,
slow or undeclared asset can produce a permanently black screen. The transition arm's
ack fires on all four outcomes deliberately: the host barrier waits for every player and
evaluates `timeoutTicks` only when an action is applied, so a turn-based match has no
ticker to time a withheld ack out — withholding it would freeze the match rather than
degrade it.

**A gate withholds a reveal, never a MOUNT.** `GameShell` mounts on the same commit it
did before, which is what keeps the unique disposer of a page-injected `AssetManager`
reachable; `/replays/player`'s `isReady` is unchanged for the same reason, and its cover
is an overlay above a mounted shell.

**Two new optional `GameScreenRegistry` slots.** `loadingScreen` covers every screen key;
`loadingScreens[key]` covers one, and `'none'` opts a key out of a registry-wide cover.
Either accepts a component, a static `{ message }`, a static `{ image }`, or the
`'spinner'` / `'progress'` presets. They resolve through ONE cascade and render at three
sites — a suspended code-split chunk, a scene transition, and a route entry — always as a
SIBLING of the transition overlay, never inside its `aria-hidden` subtree. **The default is unchanged from before the slots existed: a game that declares neither gets the engine's own empty placeholder, which is what the Suspense site rendered before.**

Properties you can rely on:

- A declared ref that is `deferred` in the manifest is promoted for the run and restored
  by nothing — the promoted manifest is built from the same base object, so entry
  equivalence keeps every cached ref and `registerManifest` evicts none.
- `engine:scene_ready` still carries `{ playerId }` and nothing else. No client's load
  timing, fraction or outcome enters authoritative state.
- Neither budget collapses under `NEXT_PUBLIC_CHIMERA_E2E`. The e2e build is where a
  never-releasing gate is observed; disabling it there would make its own spec pass
  vacuously.

Two caveats worth knowing before you rely on the route arm:

- **The route arm stops at the first rejection.** `preloadCritical` awaits its entries in
  sequence, so a broken ref leaves the entries after it unloaded by that run. The gate's
  own settle-all picks up the ones in its promoted set and reports them by name; the rest
  load on demand.
- **The guarantee is scoped to a live, rendering client.** A seat in `state.players` with
  no mounted `SceneRouter` — a disconnect mid-transition, or an AI seat — can already
  stall the host barrier today. This change does not fix that, and the budgets are chosen
  so it does not meaningfully widen the window.
