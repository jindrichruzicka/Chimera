---
'@chimera-engine/renderer': minor
---

Added `@chimera-engine/renderer/shell/gameAssetSession`, so a route can render a
game's assets without a running match. `<GameAssetSession assetManifest>` builds,
publishes and disposes a game-asset `AssetManager` for surfaces with no `GameShell`
above them — previously the only manager reachable on a bare route was the app-level
delegating one, whose delegate only `GameShell` sets, so every `useAsset` /
`useModelInstance` load rejected with `NoActiveGameSessionError`. The manager is
allocated in a commit-phase effect rather than in render, so StrictMode's discarded
render-phase result cannot orphan an undisposable manager (Invariant #21, amended to
name this second owner).

The same module exports `useRendererGameAssetManager`, which memoises a manager for a
route that hands it to `<GameShell assetManager>` and deliberately never disposes it
(`GameShell` remains the unique disposer of the match-level manager). The `/game` and
`/replays/player` routes each open-coded that construction; both now share this one.
It is keyed on the loaded renderer game rather than on its manifest, because
`LoadedRendererGame.assetManifest` is optional and "game with no manifest" must still
yield a manager — collapsing that case to `null` would blank the route.
