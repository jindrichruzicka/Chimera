---
'@chimera-engine/renderer': patch
---

`loadRendererGame` and `loadRendererGameShell` now run a loaded shell's asset warm-up — its
`fonts`, `preloadImages` and `cursor` textures — on a budget instead of awaiting it without a
ceiling. `GAME_SHELL_WARMUP_BUDGET_MS` (5 s) releases the load when those fetches have not
finished, and warns under the `game-registry` module with the game id and the steps still
outstanding: the one in flight, and the ones it never let start.

Why it matters to an adopter: this warm-up is awaited BEFORE either preload budget starts
(`CRITICAL_ASSET_PRELOAD_BUDGET_MS`, `SCENE_PRELOAD_BUDGET_MS`), so a `chimera://` fetch that was
never answered used to hold a route in a state neither of those could reach — on `/game` that is
the black screen the lobby→game fade leaves behind, with nothing to release it. This budget and the
route-entry gate's are sequential, and 5 s + 8 s stays strictly under the 15 s a game-route e2e
allows the canvas.

Failing open costs a frame of fallback: a warmed image is a decode the first paint would have done
anyway, and a cursor token left unwritten is the engine's stock cursor. A warm-up step that REJECTS
still rejects the load, unchanged — that is a settled outcome and it already reaches the player as
the crash fallback.

Not covered, and recorded rather than fixed: the game's own dynamic `import()` above the warm-up.
An absent `GameScreenRegistry` has no degraded form, so the only settle a budget could add there is
a throw, which would turn a slow module into a refused route. Its chunk `<script>` is bounded by
the bundler (120 s, then a `ChunkLoadError` rejection); the stylesheet sibling of that chunk is
bounded by nothing, so a route entry still contains one unbounded wait. See
`docs/core-components/asset-reference-system.md`.

New export: `GAME_SHELL_WARMUP_BUDGET_MS` from `@chimera-engine/renderer/game`.
