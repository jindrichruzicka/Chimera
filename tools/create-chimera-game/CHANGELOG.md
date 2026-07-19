# create-chimera-game

## 1.0.0-rc.5

### Patch Changes

- Fixed a standalone-scaffold e2e bug where Playwright runners that invoke the `playwright`
  bin directly — the VS Code Test Explorer, `npx playwright test`, and the generated
  `.vscode/launch.json` configs — bypassed the app's `test:e2e` npm script, the only place
  `CHIMERA_VERIFY_PACK_NODE_MODULES` was set. Without that env, the e2e `global-setup`
  re-added the monorepo-only `@chimera-engine/electron/main` esbuild alias, which does not
  exist in a scaffold, so the build failed with "Could not resolve @chimera-engine/electron/main".
  The scaffolded `e2e/playwright.config.ts` now self-sets
  `process.env.CHIMERA_VERIFY_PACK_NODE_MODULES ??= 'node_modules'` at the top of the config,
  which Playwright evaluates before `globalSetup` in the same process — so every runner resolves
  the packed engine, not just the ones going through `test:e2e`. The rewrite throws if the
  `defineConfig` marker drifts, failing loud instead of silently reintroducing the bug.

## 1.0.0-rc.4

### Patch Changes

- 81bba4c: Freeze the scaffold's toolchain at **exact** versions instead of caret ranges. A fresh
  `create-chimera-game` project declared the toolchain as ranges (e.g. `next: ^15.5.15`), so an
  out-of-monorepo install resolved newer upstream patches the engine was never built against —
  `next@15.5.20` broke the generated app's Next static export ("Could not find the module …
  `SaveStoreBootstrap` in the React Client Manifest"). The emitted root's `TOOLCHAIN_DEPS` are
  now pinned to the exact versions the monorepo builds against, the scaffolded app's own
  non-engine deps (`electron`, `electron-builder`) are pinned at emission time (a caret there
  splits resolution the same way once the monorepo bumps a major), and the root now carries the
  tested `packageManager` + `engines` envelope. A regeneration gate keeps the frozen snapshot
  exact and in sync with the monorepo lockfile.

## 1.0.0-rc.3

### Minor Changes

- Scaffolded games gain full VS Code debug/run parity: the generated `.vscode/` now
  ships the complete launch set (Run/Clean, a Debug compound with renderer-process
  attach, Vitest x3, Playwright x2, and per-platform Package configs) plus the matching
  `package:<game>:<platform>` root scripts the Package configs drive. The blank
  template's `electron-builder.yml` filters `!**/*.map` so debug source maps are never
  shipped in packaged builds.

## 1.0.0-rc.2

### Minor Changes

- 7f237bb: Dev multiplayer harness: game-owned fixtures, auto-session, standalone packaging (§4.32)
    - `@chimera-engine/electron` ships the harness as the `chimera-dev-mp` bin (+ the
      `./dev-harness` library subpath): one command spawns an auto-hosting instance plus
      auto-joining clients, relays the host's `host:port:token` lobby code via an atomic
      announce-file handshake, auto-readies every seat, and auto-starts the match once the
      roster is complete. Works identically from the monorepo and from a standalone
      scaffolded app (the app dir is the harness root; entry from `package.json` `main`).
    - Games inject their own test data from `<appRoot>/dev/`: `profiles/*.json` (cosmetic
      engine-shaped identities, seeded as each instance's active profile) and
      `scenarios/*.json` (per-seat game-defined attributes such as a JSON-encoded deck,
      host-authored match settings such as an arena id, AI seats, auto-start) — validated by
      the new `@chimera-engine/simulation` `shared/dev-fixture-contract.ts` schemas and
      riding the same lobby channels a real player uses into `snapshot.setup`.
    - Per-game player-attribute value cap: `GameLobbySetup.maxAttributeValueLength`
      (default 256 — unchanged behaviour) lets a game admit deck-sized values; the wire
      schema's coarse bound is now `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16384) with
      the precise cap enforced by `LobbyManager` on both write paths.
    - `create-chimera-game` scaffolds ship a `dev:mp` script, starter `dev/` fixtures, and
      a synthesized standalone `.gitignore`; `verify:scaffold` gains a `dev-harness`
      dry-run step and `verify:pack` probes the new subpath.
    - Fixes the previously dead harness wiring: the spawn entry pointed at a deleted
      monorepo path, `--dev-auto-join` could never match its own equals-form flag, and the
      documented seed-profile copy was unimplemented.

- Scaffolded apps ship first-class debug support:
    - `pnpm start:debug` (the launcher's `--debug` flag sets dev + `CHIMERA_DEBUG` env), main
      and renderer source maps, and a generated `.vscode/` for IDE debugging.
    - Fixed the F9 inspector in standalone builds: `@chimera-engine/electron`'s `build-main`
      now falls back to `resolveInstalledDebugPreloadEntry` (sibling lookup) so the debug
      preload resolves from the installed package layout.

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
