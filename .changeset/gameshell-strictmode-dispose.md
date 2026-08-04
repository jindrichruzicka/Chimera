---
'@chimera-engine/renderer': patch
---

`GameShell`'s session-end `AssetManager` disposal is now StrictMode-root safe.
The dispose is deferred one microtask and cancelled when the effect re-runs for
the same manager, so a dev double mount (React StrictMode at the root) no longer
disposes the manager between the simulated mounts — previously that emptied the
manifest out from under the second mount's children-first loads, latching every
non-lazily-mounted child's `useAsset` load on `UnknownAssetManifestEntryError`,
and destroyed a
page-injected manager the page still held. A real unmount still disposes exactly
once, and a manifest-identity rebuild still disposes the replaced fallback
manager (Invariant #21 unchanged: `GameShell` remains the unique disposer of the
match-level manager).
