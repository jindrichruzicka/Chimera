---
'@chimera-engine/electron': patch
'@chimera-engine/simulation': patch
'create-chimera-game': patch
---

Hardened the production debug-mode startup guard for packaged builds (Invariant #27/#77).

`assertProductionDebugGuard` early-returned unless `NODE_ENV === 'production'`, but an
electron-builder-packaged launch never sets `NODE_ENV` — so a shipped binary started with
`CHIMERA_DEBUG=1` booted the full debug bridge with `GameSnapshot`-level Inspector access.
Both startup guards now take `app.isPackaged` and share one `isProductionRuntime` predicate
(`isPackaged || NODE_ENV === 'production'`), adopting the same trusted build signal the replay
privacy gate already used. The existing `NODE_ENV` trigger is unchanged.

As defence in depth, the app bundler gained an opt-in production `define`: packaging scripts
declare `CHIMERA_PACKAGED_BUILD=1`, which bakes both `IS_DEBUG_MODE` reads so the emitted bundle
contains the literal `IS_DEBUG_MODE = false` — the debug bridge sits behind a permanently-false
gate even if the startup guard were bypassed. (The debug module graph itself still ships; the
constant crosses a module boundary, so esbuild cannot drop the branch. Removing it is a separate
concern.) Dev and e2e builds share that bundler and deliberately get no define, so the F9
Inspector stays reachable; a drift test fails loudly if a packaging script ever loses the flag.

Also fixes a scaffolding bug this exposed: the packaging scripts emitted by `create-chimera-game`
(both workspace and standalone) never set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` on their `next build`
step, so every scaffolded game's distributable shipped the dev-only component gallery and replay
routes. Both emitters now declare it, and `start:debug` rebuilds the renderer as well as the app
bundle so a preceding `pnpm package` cannot leave a debug launch half-gated.
