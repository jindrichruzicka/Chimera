---
'create-chimera-game': minor
'@chimera-engine/electron': patch
---

Scaffolded apps ship first-class debug support:

- `pnpm start:debug` (the launcher's `--debug` flag sets dev + `CHIMERA_DEBUG` env), main
  and renderer source maps, and a generated `.vscode/` for IDE debugging.
- Fixed the F9 inspector in standalone builds: `build:app` now falls back to the
  `debug-api.js` sibling of the resolved api preload, so the Inspector preload comes
  from the installed `@chimera-engine/electron` layout when no engine source tree exists.
