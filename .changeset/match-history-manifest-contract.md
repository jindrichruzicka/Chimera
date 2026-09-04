---
'@chimera-engine/simulation': minor
---

Add `GameManifest.matchHistory` and `resolveMatchHistorySupport` — a per-game declaration of what
match history the host should keep.

A game had no way to tell the host it needs no undo, no replay recording, or a tighter action-history
bound. The mechanical knobs already existed — `InMemoryActionHistory({ maxEntries })` and
`UndoPolicy.allowUndo` — with no contract to drive them from. This adds the declaration and its
resolver.

`GameMatchHistorySupport` carries `undo`, `replay` and an optional `retainActions`.
`resolveMatchHistorySupport(manifest)` returns all three, defaulting absent fields off
`manifest.realtime`: a real-time game gets `{ undo: false, replay: true, retainActions:
DEFAULT_REALTIME_RETAIN_ACTIONS }`, everything else `{ undo: true, replay: true, retainActions:
MAX_ACTION_HISTORY_ENTRIES }` — the bound `InMemoryActionHistory` has always applied, so a manifest
with no declaration resolves to the pre-existing behaviour.

The resolver never throws. `resolveTickerHz` throws on a bad `tickRateMs`, but that is the wrong
precedent for an optional capability: malformed input is dropped the way `resolveGameLanguages` drops
it, per field, so a bad manifest degrades instead of bricking the boot. A `retainActions` that is not
an integer in `[1, MAX_ACTION_HISTORY_ENTRIES]` falls back to the mode's default; a non-boolean
`undo` or `replay` falls back to its own default without disturbing the other. `realtime` is read for
truthiness, the same reading `resolveTickerHz` uses, so the two cannot disagree about which games are
real-time.

`MAX_ACTION_HISTORY_ENTRIES` moves to
`simulation/foundation/game-manifest-contract.ts`, because the resolver in the contract leaf clamps
against it and `foundation/` imports nothing from `engine/`. `simulation/engine/UndoManager.ts`
re-exports it under the same name, so every existing import path and the
`@chimera-engine/simulation/engine` barrel are unchanged, and its value is unchanged.
