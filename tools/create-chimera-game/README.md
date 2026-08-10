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

**Dev tools.** `@chimera-engine/electron` publishes the engine's development tooling, and the
standalone root forwards each entry, so every one runs from the project directory the scaffold
created — the same commands the monorepo itself uses:

| Command                              | From                      | What it does                                              |
| ------------------------------------ | ------------------------- | --------------------------------------------------------- |
| `pnpm dev:mp <N>`                    | `chimera-dev-mp`          | N-player local multiplayer session (above)                |
| `pnpm fetch:fonts --url "<css url>"` | `chimera-fetch-fonts`     | Download + self-host Google fonts (Invariant #97)         |
| `pnpm validate:assets`               | `chimera-validate-assets` | Check every asset reference resolves (Invariants #22/#52) |
| `pnpm icons:generate`                | `chimera-generate-icons`  | Opt-in multi-size icon set (needs `pnpm add -D sharp`)    |
| `pnpm lint`                          | `.../eslint` subpath      | The architecture guardrails (below)                       |

Each forwards to the app package. For the four bins that is where they are linked (the root
manifest declares no `@chimera-engine/*` dependency, so pnpm links them into
`apps/<kebab>/node_modules/.bin` alone); for `lint` it is where the flat config lives. pnpm
appends trailing arguments to the delegated script, which is how `--url` reaches
`fetch:fonts`. The equivalent `pnpm --filter @chimera-engine/<kebab> <script>` form also works.

These bins require an engine version that declares them; a project pinned to an older
`@chimera-engine/electron` fails with `spawn ENOENT`.

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
├── ai/                    # EMPTY (.gitkeep) — per-game agent policies; in the
│                          #   no-fromfloat-in-simulation zone alongside simulation/
├── content/               # content-collection definitions for the Content DB
├── data/                  # EMPTY (.gitkeep) — JSON rows the Content DB loads, as data/<collection>/*.json
├── screens/               # the screens the registry names (playfield screen + registry)
├── components/            # EMPTY (.gitkeep) — every reusable piece those screens are built
│                          #   from: shared React, shared hooks, in-Canvas r3f primitives
├── renderer/              # per-app Next.js app + register.ts registration seam
├── electron/              # Electron main composition root + build-main.ts, your bundler driver
├── dev/                   # starter harness fixtures — profiles/ and scenarios/
├── e2e/                   # Playwright boot-smoke suite
├── shell/                 # renderer shell declarations — fonts.ts gameFonts stub (empty until fetched)
├── assets/                # game-owned binary assets (icon; fonts/ for self-hosted .woff2 — Invariant #97)
├── styles/                # tokens-override.css — redefine any `--ch-*` the engine declares
├── eslint.config.mjs      # STANDALONE ONLY — this game's flat config, composing the engine's architecture rules
├── manifest.ts            # GameManifest (registration surface, stays at the root)
├── asset-manifest.ts      # AssetManifest — empty, already wired through renderer/loaders.ts;
│                          #   the basename chimera-validate-assets discovers, so keep it
├── settings-schema.ts     # zod settings schema extending EngineSettings
├── manifest.test.ts       # co-located tests for the two root manifests
├── asset-manifest.test.ts #   (loops over entries, so they grow with the game)
└── package.json / tsconfig*.json / electron-builder.yml
```

Grow a game inside this shape: new deterministic gameplay modules go under `simulation/`
(subsystem subdirectories are fine), agent policies under `ai/`, UI under
`screens/`/`components/`/`shell/`, JSON content under `data/`. `ai/`, `data/` and `components/`
ship empty, held open by a `.gitkeep`, so the first file you add is already inside the zone that
guards it — an `ai/` policy is in the `no-fromfloat-in-simulation` zone from its first line.

The `screens/` ↔ `components/` split is worth getting right early, because it is the one that
decides where most of your files end up. `screens/` holds only what the screen registry names —
the playfield, the HUD, the in-game menu, the post-game summary. Everything those screens are
built from goes in `components/`, whatever it renders into: a shared React panel, a hook or
store two screens have to agree on, and the `three` / `@react-three/fiber` primitives a screen
renders as children of its `<GameCanvas>`. Both directories are renderer surfaces, so a
component may reach the engine's public renderer barrels exactly as a screen can —
`chimera/no-game-renderer-internals` allows `.tsx` under `screens/`, `components/` and `shell/`
and blocks the rest of the app, including a plain `.ts` helper in those same directories.

The `<GameCanvas>` itself stays in the screen. A screen owns its canvas root, and the
primitives underneath it are its children — which also means a component that takes its
resolved model or its ambience track as a prop needs no engine provider above it and renders
in a plain test.

### The architecture guardrails

A standalone project gets its own `eslint.config.mjs`, composing the engine's rules onto
your directories, and `pnpm lint` runs it. (A `--workspace` game does not get that file: it
inherits the monorepo's root config, which carries the same rules and more.) They are the
executable form of Chimera's architecture invariants, and a fresh scaffold is green under
them:

| Rule                                | What it stops                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `no-fromfloat-in-simulation`        | `fromFloat()` in `simulation/` or `ai/` — it breaks cross-machine determinism          |
| `no-animation-derivation-in-reduce` | compiling an animation beat window inside `reduce()`/`validate()` — do it at load time |
| `no-hardcoded-design-values`        | colour and size literals in `screens/` — use `var(--ch-*)` so themes reach them        |
| `no-unknown-token-overrides`        | redefining a `--ch-*` the engine does not declare — it would theme nothing             |
| `no-game-renderer-internals`        | reaching past the renderer's public barrels into its internals                         |
| `no-raw-r3f-canvas`                 | mounting a raw `<Canvas>` — a game's canvas root is `<GameCanvas>`                     |

Test files under `simulation/` and `ai/` are exempt from the two `simulation/`+`ai/` rules:
building fixed-point values with `fromFloat()` in a fixture is fine, and compiling a window is
what a test of your own sheet does. Both rules are about hot paths, not test code.

Read `no-hardcoded-design-values`' zone literally — it is `screens/` only, and `components/` is
deliberately outside it. A `three` material colour is not a CSS value: nothing in the render path resolves
`var(--ch-*)` for it, so the rule cannot ask an in-Canvas colour for a token the way it asks a
stylesheet. The consequence is worth knowing when you put a DOM component in `components/`: its
literals are not checked, and keeping them on tokens is on you.

`styles/tokens-override.css` is where you theme the game. Redefine any token the engine
declares and the whole UI follows — the shell, the built-in screens, and your own components
read the same variables. The file ships with the accent family already overridden, so you can
see it working; keep it, because the token rule matches that path by name, and deleting the
file takes the guardrail with it.

The config is yours. It ships without type-aware linting (no Chimera rule needs it, and
turning it on reds a fresh scaffold on files outside the app's TypeScript program) — the
comments in the file say what to add if you want it, and what to keep passing when you do.

### Self-hosting Google fonts

Game fonts are committed `.woff2` files under the game's own `assets/fonts/` — never a runtime
Google fetch (Invariant #97). The scaffold ships the whole convention: the `assets/fonts/`
directory, an empty `gameFonts` declaration in `shell/fonts.ts` (already forwarded through
`renderer/loaders.ts`), and an app-level `fetch:fonts` script running the `chimera-fetch-fonts`
bin published by `@chimera-engine/electron` — forwarded from the project root, so you run it
from the directory the scaffold created. To add fonts:

1. From the project root, run it with the Google Fonts CSS URL as a trailing argument —
   **quoted**, because the URL contains `&` and `?`:

    ```sh
    pnpm fetch:fonts --url "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
    ```

    Nothing to edit first: pnpm appends trailing arguments to the delegated script, so the
    URL reaches the bin. The script supplies `--game` and `--out-dir assets/fonts` itself,
    and that explicit `--out-dir` is what lands the download in the game's own
    `assets/fonts` — the tool's README explains why the flag is required here.

2. Paste the printed `GameFontFace[]` snippet into `shell/fonts.ts` and commit the `.woff2`
   files alongside it.

### Giving the app its own icon

Replace the single committed `assets/icons/icon.png`. That one file is both icons a player
sees: electron-builder derives the installer `.icns`/`.ico`/PNG set from the top-level `icon:`
field in `electron-builder.yml`, and the game manifest's `icon` makes the same PNG the runtime
window and dock icon. Nothing else is required to rebrand.

The scaffold also ships an **opt-in** `icons:generate` script for the engine-shaped multi-size
set (`chimera-16..1024.png`, `chimera.icns`, `chimera.ico`, and the `chimera.png` runtime
fallback). It is opt-in because the engine does not declare its image codec as something
your project must install:

1. `pnpm add -D sharp` in the app package — one time. It is an optional peer dependency
   of `@chimera-engine/electron`, so nothing the engine declares asks your project to
   install a multi-megabyte platform-specific native binary. If the tool cannot resolve
   `sharp` at all it runs and tells you exactly this. (A Next-based scaffold usually can:
   Next declares `sharp` as an optional dependency of its own, and pnpm keeps it on the
   resolution path — so the script may simply work before you install anything.)
2. `pnpm icons:generate` from the project root. Both `--source` and `--out` are already in
   the script and both matter — the tool's README explains why omitting `--out` writes into
   your `electron/` source tree instead of failing.
3. To have the generated set actually used, repoint the `from:` file-set entry in
   `electron-builder.yml` from the engine's icon directory to your own `assets/icons`. That
   swaps the shipped `chimera.png` **fallback** — the icon used only if the manifest `icon`
   is ever dropped — for a game-branded one. Left alone, a game ships the engine's fallback,
   which is the right default for one that never regenerates.

For a full-quality set, bring a square master of at least 1024×1024; the committed placeholder
is 512×512, so the 1024 outputs are upscales until you replace it.

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
