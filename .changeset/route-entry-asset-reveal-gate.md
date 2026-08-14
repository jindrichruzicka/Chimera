---
'@chimera-engine/renderer': minor
---

`/game` and `/replays/player` now hold their REVEAL until the critical asset preload has
settled, instead of showing a scene whose textures and audio are still arriving. Both
routes mount `GameShell` exactly as before — the gate withholds the sight of the scene,
never the mount, because `GameShell` is the unique disposer of the manager those routes
inject (Invariant #21).

What an adopter sees while the gate waits: on `/game` the app-level screen fade stays
where it was and a loading cover renders over the mounted shell; on `/replays/player`
the cover renders inside the playfield, with the transport controls live above it. The
cover is the §4.36 one a game already declares through `loadingScreen` /
`loadingScreens`, resolved for the entering scene's default screen key, so a game that
declares no cover is visually unchanged apart from the delayed reveal.

The wait is bounded by `CRITICAL_ASSET_PRELOAD_BUDGET_MS` (8 s) and it fails open: a
rejected critical load, an elapsed budget, and a game that declares no manifest all
reveal the scene. The gate reports under the `asset-preload-gate` module: the elapsed
budget as a warning, and a ref the scene promotion alone made critical as an error
naming that ref. A ref already critical in the manifest is reported by the match-level
run instead.

A scene's declared `requiredAssets` gate a route entry too, read off
`BaseGameSnapshot.sceneRequiredAssets` and promoted to critical for the run — which is
what makes a restore or a replay entered mid-scene wait for that scene's own refs.

New export: `emitRendererWarning` in `renderer/logging/rendererLogger.ts`, the warn-level
twin of `emitRendererError` for a condition with no `Error` behind it.
