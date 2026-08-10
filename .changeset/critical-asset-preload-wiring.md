---
'@chimera-engine/renderer': patch
---

Fixed `AssetManifestEntry.priority: 'critical'` having no runtime effect. `AssetPreloader`
and `AssetManager.preloadCritical` both shipped, and neither had a caller anywhere in the
renderer's runtime path — so a critical entry behaved exactly like a deferred one and
decoded on first use. For a music bed that means a fade-in, or a crossfade, scheduled
against a buffer that has not arrived; nothing warns, because `AudioManager.play()`
swallows a slow load.

`GameShell` and `GameAssetSession` now run the preload through the new
`criticalAssetPreload` module. Which surfaces may run it follows from Invariant #21: a
surface preloads only into a manager whose lifetime it owns.

Properties of that call that callers can rely on:

- **Commit phase, never render.** It cannot move into `createAssetManager` beside the
  construction-time `registerManifest`: StrictMode discards one of the two managers
  `useRendererGameAssetManager` builds in `useMemo`, and that orphan is tolerable only
  because it is inert. A preload at construction fills it with decoded audio and GPU
  textures no dispose path can reach.
- **Owned by the effect that owns the manager.** A surface allocating its manager inside
  an effect calls `startCriticalAssetPreload` from that same effect. React runs every
  cleanup before every setup, so a separate effect's setup would read the previous manager
  out of state — the one just disposed — and cache into it; `dispose()` empties a
  manager's maps without making it refuse work.
- **Non-blocking.** The owning surface renders its subtree while the preload runs, and a
  child that loads the same ref first is served the same in-flight promise — the warm-up
  never costs a second fetch and never gates a frame.
- **Non-fatal.** A rejected critical load is reported under the `asset-preload` module and
  dropped, leaving the deferred on-demand path intact. A teardown-time rejection (the
  owner disposing the manager it owns) reports nothing.

Two consequences worth naming for adopters. A `GameShell` handed a manifest with a
critical entry and **no** `assetManager` now reports its fallback manager's unconfigured
resolver, where it previously stayed silent — that combination can never load anything.
And any route mounting `GameAssetSession` with a manifest now pays for that manifest's
critical entries, whatever the route renders: in this repo the Tactics `/model-showcase`
route fetches and decodes the two ambience beds it does not use.

Scene-level `requiredAssets` promotion (`markRequiredAssetsCritical`, the
`TransitionOverlay` progress gate) is a separate arm and remains unwired; the scene
transitions doc now says so.
