---
'@chimera-engine/electron': minor
---

Ship the default Chimera application/window icon set. `@chimera-engine/electron` now bundles the generated icon assets under `assets/icons/` — including the dev-runtime default `chimera.png` (512×512) that F67's `createMainWindow` resolves when a game declares no `GameManifest.icon` override, plus the `.icns`/`.ico` build set for packaged distributables. Regenerate from the Chimera logo with `pnpm icons:generate`.
