---
'@chimera-engine/renderer': patch
---

Two more caller-supplied callbacks are guarded where they are dispatched: the scene preload's
report on the not-measured path, and `AssetPreloader.preloadCritical`'s forwarded
`onEntryFailure`.

`startScenePreload` reports `1` and returns synchronously when a transition has no manager, no
manifest or no declared refs. That call was raw, beside a per-ref sibling in the same function
that already wrapped its own — unguarded, a throwing callback took `startScenePreload` itself
down and left the caller with no run to await.

`AssetPreloader.preloadCritical` forwarded `onEntryFailure` to the manager unguarded, one line
below the `onProgress` it wrapped and on the same premise: the forwarded callback runs inside
whichever `AssetManager` the wrapper was handed, and `AssetManager` is on the public
`@chimera-engine/renderer` assets barrel, so a game can implement one. `DefaultAssetManager`
guards its own dispatch; another implementation need not.

Both forwards stay conditional, so a manager still receives `undefined` for a channel its caller
did not register rather than a callback the wrapper synthesised.
