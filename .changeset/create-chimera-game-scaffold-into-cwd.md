---
'create-chimera-game': minor
---

`create-chimera-game <name>` now scaffolds the standalone project **into the current directory** instead of a new `<name>/` subdirectory. The intended flow is "make a folder, open it, run the initializer there", so the app (`apps/<kebab>/`) and the emitted project root (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.mts`) land directly in `<cwd>` with no redundant wrapper directory, and `pnpm install` runs there. To avoid clobbering an existing project, the CLI refuses when the current directory already contains a `package.json`. `--workspace` (in-monorepo) and `--out <dir>` (the `verify:scaffold` gate) are unchanged.
