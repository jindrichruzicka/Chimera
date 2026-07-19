---
'create-chimera-game': minor
'@chimera-engine/electron': patch
---

Scaffolded apps ship first-class debug support:

- `pnpm start:debug` (the launcher's `--debug` flag sets dev + `CHIMERA_DEBUG` env), main
  and renderer source maps, and a generated `.vscode/` for IDE debugging.
- Fixed the F9 inspector in standalone builds: `@chimera-engine/electron`'s `build-main`
  now falls back to `resolveInstalledDebugPreloadEntry` (sibling lookup) so the debug
  preload resolves from the installed package layout.
