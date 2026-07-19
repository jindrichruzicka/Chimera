---
'create-chimera-game': patch
---

Freeze the scaffold's toolchain at **exact** versions instead of caret ranges. A fresh
`create-chimera-game` project declared the toolchain as ranges (e.g. `next: ^15.5.15`), so an
out-of-monorepo install resolved newer upstream patches the engine was never built against —
`next@15.5.20` broke the generated app's Next static export ("Could not find the module …
`SaveStoreBootstrap` in the React Client Manifest"). The emitted root's `TOOLCHAIN_DEPS` are
now pinned to the exact versions the monorepo builds against, the scaffolded app's own
non-engine deps (`electron`, `electron-builder`) are pinned at emission time (a caret there
splits resolution the same way once the monorepo bumps a major), and the root now carries the
tested `packageManager` + `engines` envelope. A regeneration gate keeps the frozen snapshot
exact and in sync with the monorepo lockfile.
