---
'create-chimera-game': minor
---

Scaffolded games gain full VS Code debug/run parity: the generated `.vscode/` now
ships the complete launch set (Run/Clean, a Debug compound with renderer-process
attach, Vitest x3, Playwright x2, and per-platform Package configs) plus the matching
`package:<game>:<platform>` root scripts the Package configs drive. The blank
template's `electron-builder.yml` filters `!**/*.map` so debug source maps are never
shipped in packaged builds.
