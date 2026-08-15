---
'@chimera-engine/renderer': patch
---

A caller's `onProgress` callback throwing no longer abandons the critical asset preload or
replaces the run's outcome with the callback's error.

`onProgress` is on the `AssetManager` interface, which the public `@chimera-engine/renderer`
assets barrel exports, so a game can pass one. `DefaultAssetManager.preloadCritical` called it
unguarded at both of its sites: the per-entry fraction inside the settle-all loop, where an
escaping throw left every entry after it to load on demand and rejected with the callback's
error instead of `CriticalAssetPreloadFailedError`; and the terminal `1` on the
no-critical-entries return, where a throw rejected a run that had nothing to load. That is the
abandonment shape the settle-all removed, reachable through the sibling of the callback it
guarded.

`AssetPreloader.preloadCritical` guards its own calls too. Its terminal `1` runs after
the manager resolved, so no guard inside the manager covers it, and its filtered forward runs
inside whichever `AssetManager` the wrapper was handed.

Each guard swallows per call rather than muting the callback for the rest of the run, and a
failing ref still rejects with the aggregate naming the refs.
