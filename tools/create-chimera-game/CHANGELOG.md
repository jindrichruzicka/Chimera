# create-chimera-game

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
