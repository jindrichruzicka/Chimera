# `create-chimera-game`

Scaffolds a new Chimera game app from a bundled template. It copies `templates/<id>/` (shipped
beside this CLI) into `apps/<game>`, substitutes the game name into every file's contents **and**
its file/directory names, and then either emits a **self-contained project** around it (the
default) or **wires it into this monorepo** (`--workspace`).

## Usage

```bash
# Standalone (default) — scaffolds a self-contained project INTO THE CURRENT DIRECTORY, so make
# and open your project folder first, then run it there. It installs @chimera-engine/* from npm.
# Published as `create-chimera-game`, so end users run:
mkdir my-game && cd my-game
npm create chimera-game@latest "My Game"     # or: pnpm create chimera-game "My Game"

# In-monorepo (contributors adding an app like apps/tactics):
pnpm create:game <name> [--template <id>]     # wraps `… --workspace`
```

- `<name>` — the game name in any casing (`my-game`, `My Game`, `myGame`, …). It
  is normalised into every casing the template needs (see the token table below). Must contain a
  letter, start with a letter, and use only letters, digits, and `-` `_` space separators.
- `--template <id>` — which template to scaffold from. **Defaults to `blank`.** The id resolves
  generically to the bundled `templates/<id>/`; any directory added there is usable with no code
  change here. An unknown id errors and lists the available ids.
- `--workspace` — in-monorepo mode (see below). `pnpm create:game` passes this for you.
- `--out <dir>` — standalone mode, but emit into `<dir>` and skip `pnpm install` (the
  `verify:scaffold` gate drives this).

Re-running against an existing `apps/<kebab>` errors instead of overwriting it. The standalone
default also refuses if the current directory already contains a `package.json`, so it never
clobbers an existing project's root — run it in an empty directory.

### Modes

**Standalone (default).** Creates a self-contained project **in the current directory** whose lone
workspace member is the app under `apps/<kebab>/`. It emits the project root the app needs to
install + boot with no monorepo:

- `package.json` — the toolchain (react / three / next / vitest / playwright / electron / …) at
  the versions the engine was built against, frozen in [`toolchain.generated.ts`](./toolchain.generated.ts),
  plus a no-op `build:packages` and `pnpm.onlyBuiltDependencies` for electron/esbuild;
- `pnpm-workspace.yaml` (`apps/*`), a self-contained `vitest.config.mts`, and a `tsconfig.json`
  carrying the frozen root `compilerOptions` the app's tsconfigs `extends`;
- the app's `@chimera-engine/*` deps rewritten from `workspace:*` onto their published `^x.y.z` ranges,
  and `CHIMERA_VERIFY_PACK_NODE_MODULES` wired into its `build:app` / `test:e2e` scripts so the
  Electron bundler resolves the host from the installed `@chimera-engine/electron`.

Then `pnpm install` runs in the current directory. Next: `pnpm --filter @chimera-engine/<kebab> test`,
`pnpm exec next build apps/<kebab>/renderer`, `pnpm --filter @chimera-engine/<kebab> build:app`, then
`pnpm start` to play it. `pnpm start` goes through a generated `scripts/launch.mjs` that strips
`ELECTRON_RUN_AS_NODE` before spawning Electron — some IDE/CI terminals export it, which would
otherwise boot the `electron` binary as plain Node and crash the app at startup.

**Debugging.** `pnpm start:debug` runs the same launcher with `--debug`: it sets
`CHIMERA_ENV`/`NODE_ENV=development` + `CHIMERA_DEBUG=1`, so the app boots windowed (not fullscreen)
with Chromium DevTools and the F9 Debug Inspector enabled. For breakpoints, the standalone project
ships a `.vscode/` with **“Run &lt;Game&gt;”** and **“Debug &lt;Game&gt;”** launch configs: “Debug”
rebuilds via a `tasks.json` build task and binds source-mapped breakpoints in main-process code
(`electron/main.ts`, `simulation/**`) — the app bundler emits `.map` files and the renderer build
emits browser source maps under `CHIMERA_DEBUG=1`. Renderer/UI code is debugged in the DevTools
window. A plain `pnpm package` sets none of these, so the distributable stays production-default.

**Multiplayer dev loop.** `pnpm dev:mp <N>` (standalone root) launches an instant N-player
session: it builds the renderer + app bundle, then runs the `chimera-dev-mp` harness (the
`@chimera-engine/electron` bin, §4.32) — one auto-hosting Electron instance plus N−1 auto-joining
clients, each with an isolated `.dev-userdata/p<i>` profile, auto-readying and auto-starting the
match. The scaffold ships starter fixtures under `apps/<kebab>/dev/`: `profiles/*.json` (cosmetic
identities) and `scenarios/default.json` — run it with `pnpm dev:mp --scenario default`. Author
your own scenarios to inject game-defined per-seat attributes (e.g. a JSON-encoded deck) and
host-authored match settings (e.g. an arena id); they ride the same lobby channels a real player
uses and land in `snapshot.setup`. `pnpm dev:mp 2 --dry-run` prints the validated spawn plan
without launching anything.

**In-monorepo (`--workspace`).** Writes the app under this repo's `apps/<kebab>/` and registers it
(mirroring `apps/tactics`): adds `@chimera-engine/<kebab>: "workspace:*"` to the root `package.json`,
appends a `tsconfig.build.json` reference and a `typecheck` line, then `pnpm install`. Next:
`pnpm typecheck`, `pnpm --filter @chimera-engine/<kebab> build:app`.

Both modes validate the name and resolve the template **before** any write, copy the tree
(skipping `node_modules` / `dist` / `out` / `.next`), substitute tokens in contents + path
segments, and assert no token survives.

## Emitted app layout

The blank template follows the canonical game-app structure (mirroring `apps/tactics`; see
`docs/executive-architecture/module-boundaries-file-tree.md`):

```
apps/<kebab>/
├── simulation/            # deterministic gameplay — actions.ts, constants.ts, visibility-rules.ts;
│                          #   pure (no DOM/IPC), covered by the apps/*/simulation ESLint zones
├── content/               # content-collection definitions for the Content DB
├── screens/               # game React UI (board screen + registry)
├── renderer/              # per-app Next.js app + register.ts registration seam
├── electron/              # Electron main composition root + build-main.ts bundler
├── e2e/                   # Playwright boot-smoke suite
├── assets/                # game-owned binary assets (icon)
├── manifest.ts            # GameManifest (registration surface, stays at the root)
├── settings-schema.ts     # zod settings schema extending EngineSettings
└── package.json / tsconfig*.json / electron-builder.yml
```

Grow a game inside this shape: new deterministic gameplay modules go under `simulation/`
(subsystem subdirectories are fine), UI under `screens/`/`scene/`/`shell/`, JSON content under
`data/`.

## Token reference

Templates embed these placeholders in file contents and in file/directory names; the scaffolder
replaces each with the corresponding casing of the game name. (The placeholder spellings double
as a worked example of each casing.) Example column uses the input `my-game`.

| Token               | Casing         | Example   |
| ------------------- | -------------- | --------- |
| `__game_kebab__`    | kebab-case     | `my-game` |
| `__gameCamel__`     | camelCase      | `myGame`  |
| `__GamePascal__`    | PascalCase     | `MyGame`  |
| `__Game Title__`    | Title Case     | `My Game` |
| `__GAME_CONSTANT__` | CONSTANT_CASE  | `MY_GAME` |
| `__gamelower__`     | lower (joined) | `mygame`  |

Legitimate dunders such as `__dirname` / `__filename` are **not** tokens and are left untouched.

## Implementation notes

- Pure tooling: imports only `node:*` and sibling modules — the pure
  [`normalize.ts`](./normalize.ts) / [`tokens.ts`](./tokens.ts) / [`standalone.ts`](./standalone.ts)
  and the generated [`toolchain.generated.ts`](./toolchain.generated.ts). It must **not** import
  any `@chimera-engine/*` package — boundary lint enforces this, keeping it publishable standalone.
- `templates/<id>/` is bundled beside this CLI but is **not** a pnpm workspace member (it holds
  unsubstituted tokens); only after the copy into `apps/*` does the new app become a member.
- The exported `scaffoldGame()` performs the copy + the per-mode finish (monorepo wiring or
  standalone-root emission) and is fully unit-tested; the `pnpm install` step lives only in the
  CLI entry, which is excluded under VITEST.
- The standalone-root synthesizers in [`standalone.ts`](./standalone.ts) are shared with the
  `verify:scaffold` gate, which drives this CLI in `--out` mode and layers packed-tarball
  overrides on the emitted root — so the gate verifies the exact project the published CLI ships.
