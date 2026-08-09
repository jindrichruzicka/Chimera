---
'@chimera-engine/renderer': minor
---

Add `@chimera-engine/renderer/assets`, a seventh public barrel, so a game can reach any
loaded asset at all. The model seam landed across F79 (`useModelInstance`, the headless
clone/release module, manifest-at-construction), but the hooks that consume it were
renderer internals with no entry in the `exports` map, and Invariant #96 allows a game
surface only a public barrel — so no game could obtain a loaded asset outside the engine's
own tests.

The barrel ships the consuming hooks, an `AssetManagerProvider`, and the state/asset/error
type surface those calls take, including the new `NoActiveGameSessionError` the delegating
manager now rejects with when a load runs outside an active match; its own header is the
index of what it carries. `renderer/app/providers.tsx` now
mounts the provider instead of the raw context, with no behaviour change. `@types/three`
is declared as an optional peer because the barrel's `.d.ts` names three types.

Additive throughout — nothing removed or renamed — and curated rather than open: the
modules behind the barrel stay internal (a game may consume a manager, never build one),
which Invariant #96 states and `chimera/no-game-renderer-internals` enforces.
