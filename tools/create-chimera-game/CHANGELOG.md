# create-chimera-game

## 1.0.0-rc.1

### Patch Changes

- f88e40a: Fix the scaffolded app crashing at startup when `ELECTRON_RUN_AS_NODE` is set in the environment (some IDE/agent terminals and CI runners export it globally). In that state the `electron` binary runs as plain Node.js, so `require('electron')` resolves to the executable path string and every Electron API is `undefined` — a raw `electron apps/<game>` then died at module load with a cryptic `TypeError: Cannot read properties of undefined`, which reads as "launching the app crashes the terminal".
    - `create-chimera-game` now emits a `scripts/launch.mjs` launcher and a root `pnpm start` script that strip `ELECTRON_RUN_AS_NODE` before spawning Electron, so the documented run step works from any terminal. The README + next-steps now point at `pnpm start`.
    - `@chimera-engine/electron` gains a startup `assertElectronRuntime` guard that turns the cryptic `TypeError` into an actionable message naming the cause and the fix (`unset ELECTRON_RUN_AS_NODE`, or use `pnpm start`).

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- 88c00c5: `create-chimera-game <name>` now scaffolds the standalone project **into the current directory** instead of a new `<name>/` subdirectory. The intended flow is "make a folder, open it, run the initializer there", so the app (`apps/<kebab>/`) and the emitted project root (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.mts`) land directly in `<cwd>` with no redundant wrapper directory, and `pnpm install` runs there. To avoid clobbering an existing project, the CLI refuses when the current directory already contains a `package.json`. `--workspace` (in-monorepo) and `--out <dir>` (the `verify:scaffold` gate) are unchanged.

## 0.2.0

### Minor Changes

- 6f4a402: Mirror the F70 logo-screen adoption in the blank template so every scaffolded game boots Chimera-branded out of the box: the manifest declares an active `logoScreen: { route: '/logo-screen' }`, `renderer/app/logo-screen/page.tsx` re-exports the engine default logo page, and the engine brand video ships as a committed `renderer/public/chimera_logo.mp4` copy. Packaged boots land on the logo screen; dev boots are untouched. Remove the manifest field to opt out, point the route at your own page for a custom intro sequence, or replace the mp4 with your own brand cut — that media is then game-owned (Invariant #97).

### Patch Changes

- 710983f: Document the F69 `GameManifest.cursor` declaration in the blank template's manifest: the JSDoc now explains the cursor roles (`default` | `pointer` | `disabled`), the game-asset-relative image convention (Invariant #97), and the hotspot default, alongside a commented-out `cursors/default.png` example. No cursor textures ship with the template — a scaffolded game opts in by uncommenting the example and adding its own PNGs under `assets/cursors/`; until then the plain system cursor stays.

## 0.1.0

### Minor Changes

- Initial release: scaffold a new Chimera game. By default emits a SELF-CONTAINED project — its
  own toolchain `package.json`, `pnpm-workspace.yaml`, `vitest.config.mts`, and a `tsconfig.json`
  carrying the frozen root `compilerOptions`, with the app's `@chimera-engine/*` deps on their published
  `^x.y.z` ranges — that installs and boots with **no monorepo clone**. `--workspace` instead adds
  an in-monorepo app (what `pnpm create:game` runs). The published package bundles the blank
  template and a frozen toolchain snapshot, so `npm create chimera-game` works standalone; the
  `verify:scaffold` gate boots the emitted project from packed tarballs end-to-end.
