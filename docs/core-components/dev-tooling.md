---
title: 'Dev Tooling & Multiplayer Harness'
description: 'chimera-dev-mp CLI (dev:mp), game-owned dev fixtures (dev/profiles + dev/scenarios), harness CLI flags, announce-file handshake, auto host/join/start flow, CHIMERA_DEV_HARNESS guard, standalone-scaffold usage; the sibling chimera-validate-assets and chimera-generate-icons bins; the @chimera-engine/electron/eslint subpath shipping the chimera/* architecture-lint rules and the games-facing standaloneLintConfig preset.'
tags: [dev-tools, multiplayer, harness, electron, testing, tooling]
---

# Dev Tooling & Multiplayer Harness

> §4.32 of the Chimera architecture.
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) · [Player Profiles & Directory](player-profiles-directory.md) · [E2E Testing](../testing/e2e-testing-playwright.md)

---

## Overview

Running multiplayer scenarios by hand is the single biggest development friction point. The dev harness collapses it to a one-line command:

```bash
pnpm dev:mp 3                       # 1 host + 2 auto-joining clients, generated profiles
pnpm dev:mp --scenario skirmish     # seats, profiles and match config from the game's dev/ fixtures
pnpm dev:mp 2 --dry-run             # print the validated spawn plan as JSON; spawn nothing
```

Each instance boots, consumes its `--dev-*` flags, and automatically hosts or joins **before the main menu renders** (the window boots straight into `/lobby`; the renderer's `GameStoreBootstrap` carries every window to `/game` when the auto-started snapshot lands). All instances use distinct `userData` directories and distinct player profiles.

The harness ships as the **`chimera-dev-mp` bin of `@chimera-engine/electron`** (library subpath: `@chimera-engine/electron/dev-harness`), so a standalone scaffolded game (create-chimera-game) runs exactly the tool the monorepo does. Dev-only code in the published tarball follows the debug-api precedent: the gate is the runtime env (Invariant #77), not file presence.

Its sources live at **`electron/dev-tools/dev-harness/`** — `dev-tools/` is the shared parent for development-time CLIs that must be reachable from a standalone game, and therefore have to live inside a published package rather than the never-published repo root `tools/`. The published names do **not** follow that directory: the bin stays `chimera-dev-mp` and the library subpath stays `@chimera-engine/electron/dev-harness`, because both are API a scaffolded app's `dev:mp` script depends on. Only the `dist/` targets in `electron/package.json` moved, and `electron/__tests__/package-exports-contract.test.ts` resolves every declared bin/export target against the built `dist/` so a relocation that forgets to repoint one fails the fast gate instead of surfacing at `verify:pack`.

---

## Scope and Non-Goals

- **In scope**: spawn N Electron instances on localhost, auto host + join + ready + start, game-owned fixture injection (profiles, per-seat attributes, match settings, AI seats), per-instance data isolation, graceful teardown on Ctrl+C.
- **Out of scope**: performance measurement (N renderers sharing one GPU), production packaging (refused), automated match-outcome assertions (that is the Playwright E2E suite, §13).

---

## Game-Owned Dev Fixtures (`<appRoot>/dev/`)

A game injects its own test data by committing fixtures next to its app:

```
<appRoot>/dev/
├── profiles/                # Cosmetic identities (EngineProfile shape: id, displayName, avatar, locale)
│   ├── alice.json
│   └── bob.json
└── scenarios/               # One file per launchable session shape
    └── skirmish.json
```

A scenario (validated by `DevScenarioSchema`, `simulation/foundation/dev-fixture-contract.ts`):

```json
{
    "gameId": "<game-id>",
    "seats": [
        { "profile": "alice.json", "attributes": { "deck": "[\"strike\",\"guard\"]" } },
        { "profile": "bob.json", "attributes": { "deck": "[\"fang\"]" }, "ready": false }
    ],
    "aiSeats": 1,
    "matchSettings": { "arena": "lava-pit" },
    "autoStart": true
}
```

Where each piece of game data goes — the same sanctioned channels a real player uses:

| Fixture field         | Runtime channel                                                                                  | Notes                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seats[i].profile`    | Seeded into the profile repository, then the normal join attestation                             | Cosmetic only (Invariant #59). Engine-shaped; unknown game fields in the file are tolerated and **stripped** at parse.                                                      |
| `seats[i].attributes` | Owner-authored per-seat lobby attributes → `GameSetupConfig.playerAttributes` → `snapshot.setup` | Game-defined keys/values (opaque strings; JSON-encode structured payloads such as a deck). Values are capped per game — see `GameLobbySetup.maxAttributeValueLength` below. |
| `matchSettings`       | Host-authored `setMatchSetting` merges over the game's `lobbySetup` defaults                     | Game-defined vocabulary (e.g. an arena id, a turn mode). Host-authored, so no wire cap applies.                                                                             |
| `aiSeats`             | Host-side `addAi()` after the human seats                                                        | The auto-start latch waits for exactly this many AI slots.                                                                                                                  |
| `autoStart`           | Host calls `startGame()` once the roster is complete and every seat is ready                     | Default `true`. `false` (or a seat's `ready: false`) leaves the seeded lobby waiting for manual interaction — the lobby-iteration workflow.                                 |

With **no fixtures at all**, `pnpm dev:mp N` still works: each instance gets a generated `Dev Player <n>` profile and the game's `lobbySetup` defaults.

A game should keep its fixtures honest with a contract test that cross-validates them against its own lobby vocabulary — see `apps/<game>/dev/fixtures.test.ts` in the reference app for the pattern (profiles parse, scenario parses, every settings key/value belongs to the game's declared options).

### Attribute value caps (deck-sized payloads)

Client-authored attribute values cross the wire, so two caps apply (the chat-relay two-tier pattern):

- **Coarse wire bound** — `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16 384): anything past it is dropped as malformed.
- **Per-game cap** — `GameLobbySetup.maxAttributeValueLength` (default **256**, the historical behaviour), enforced by `LobbyManager` on both the local fail-fast path and the host's wire merge. A game whose per-seat data is a structured payload (e.g. a JSON-encoded deck) raises it in its lobby-setup descriptor.

---

## CLI (`chimera-dev-mp`)

```
chimera-dev-mp [N] [--scenario <name>] [--app <dir>] [--entry <path>] [--game <id>] [--debug] [--dry-run]
```

| Flag                | Effect                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `N` (positional)    | Human seat count (2–8). Omit when `--scenario` provides the seat list.                                        |
| `--scenario <name>` | Load `<appRoot>/dev/scenarios/<name>.json` (with or without the `.json`).                                     |
| `--app <dir>`       | The app root. Default: cwd (must contain a `package.json` with `main`).                                       |
| `--entry <path>`    | Built Electron main entry override. Default: the app's `package.json` `main`.                                 |
| `--game <id>`       | Expected gameId; each instance cross-checks it against its hosted game.                                       |
| `--debug`           | Launch instances with `CHIMERA_DEBUG=1` (F9 Debug Inspector).                                                 |
| `--dry-run`         | Resolve + validate everything, print the spawn plan as JSON, exit without spawning (used by verify:scaffold). |

Everything is validated **before any spawn**: the scenario (Zod, strict), every referenced profile file (engine schema + distinct `localProfileId`s — duplicates would collide at the host's join gate), seat-count consistency, and the built entry (the CLI errors with the build command rather than auto-building). One limit: the CLI validates attribute values against the **coarse wire bound only** — the per-game `maxAttributeValueLength` needs the game's own lobby setup, so an over-cap value surfaces at instance seeding (a loud bootstrap failure + teardown, not a silent drop).

The CLI requires `CHIMERA_DEV_HARNESS=1` (the app's `dev:mp` script sets it) and refuses `NODE_ENV=production` (`assertHarnessEnv`, Invariant #77). `NODE_ENV` is the only signal available to it: `chimera-dev-mp` is a plain Node CLI that _spawns_ Electron, so there is no `app.isPackaged` to read. The packaged trigger is enforced one level down — each spawned instance runs the engine's `main()` startup guard, which refuses for a packaged binary **or** `NODE_ENV=production`. Child instances always launch windowed development mode (`NODE_ENV`/`CHIMERA_ENV=development`) with `ELECTRON_RUN_AS_NODE` stripped.

### Script wiring (identical in both worlds)

- **App-level** (`apps/<game>/package.json` and the scaffold template): `"dev:mp": "cross-env CHIMERA_DEV_HARNESS=1 chimera-dev-mp"` — the bin resolves from the app's `@chimera-engine/electron` devDependency.
- **Monorepo root**: `pnpm dev:mp` rebuilds the packages + the reference app's bundle, then delegates to the app's `dev:mp` (dogfooding the published bin path). Trailing args (`pnpm dev:mp 3 --scenario skirmish`) reach the harness.
- **Standalone root** (emitted by create-chimera-game): `pnpm dev:mp` builds the renderer + app bundle and delegates the same way.

---

## Sibling bin (`chimera-validate-assets`)

`@chimera-engine/electron` publishes the asset-reference validator as a sibling bin, for the
same reason it publishes this harness: a standalone game should not lose a build-time
guarantee simply by leaving the monorepo. The rules it enforces (Invariants #22/#52/#97/#125)
and its crawl semantics live in [§4.10 Asset Reference System](asset-reference-system.md); only
the distribution belongs here.

```
chimera-validate-assets [workspaceRoot]
```

The positional argument defaults to the cwd and is resolved against it. That single fact
determines the script wiring, which mirrors `dev:mp`'s app-level shape for a different reason:

- **App-level** (`apps/<kebab>/package.json` and the scaffold template):
  `"validate:assets": "chimera-validate-assets ../.."`. pnpm runs the script with cwd =
  `apps/<kebab>`, so `../..` is the project root — the layout the crawl expects, with the game
  at `apps/<kebab>` underneath it.
- **Monorepo root**: `pnpm validate:assets` runs the tool from source with no argument, so the
  root is the cwd. Unchanged by the bin's existence.

Unlike `dev:mp` there is **no standalone-root convenience script**. Not because the root
could not delegate — `pnpm --filter <app> validate:assets` works from there, and is exactly
what `verify:scaffold` runs — but because it would buy nothing: `dev:mp`'s root script exists
to build the renderer and app bundle first, and this tool needs no build. A root script that
invoked the bin _directly_ would be the broken form: the bin is linked only into
`apps/<kebab>/node_modules/.bin`, and a root-cwd `../..` resolves above the project entirely.

Two properties are worth naming because neither is visible from a passing exit code:

- **It refuses a root with no `apps/`** instead of reporting `Checked 0 asset refs`. Running the
  bin bare from a game package is the reachable way to land there, and a validator that reports
  success about a tree it never read is worse than one that crashes.
- **`typescript` is a declared runtime dependency** of `@chimera-engine/electron`, not a
  devDependency, because the on-demand-load scan imports it as values. A resolution cannot prove
  this — under pnpm every route to it realpaths to the same store directory, and the scaffold probe's
  own root declares it regardless — so `verify:scaffold` reads the declaration off the **installed
  manifest**, the file `npm install` actually consults, and takes resolvability from the bin having
  run at all.

`verify:scaffold` runs this bin against the installed standalone probe, asserts the clean run
reports a count, then plants a broken ref under the app's `data/` and requires the next run to
fail. The clean pass alone would be satisfied by a bin that scanned nothing.

---

## Sibling bin (`chimera-generate-icons`)

The third bin `@chimera-engine/electron` publishes, for the same reason as the other two: a
standalone game should not lose a capability by leaving the monorepo. The generator itself —
what it derives from a master PNG, and which of its outputs anything actually reads — is
documented in [its own README](../../electron/dev-tools/generate-icons/README.md); only the
distribution belongs here.

```
chimera-generate-icons [--source <master.png>] [--out <dir>]
```

Both defaults are engine-relative and resolved against the **cwd**, never against the tool's
own module location — the same rule the harness and the other two bins follow, and here it is
load-bearing: the published bin lives at `dist/dev-tools/generate-icons/`, so a
module-relative derivation would resolve both defaults inside the installed package, at paths
no consumer has. That shapes the script wiring:

- **App-level** (`apps/<kebab>/package.json` and the scaffold template):
  `"icons:generate": "chimera-generate-icons --source assets/icons/icon.png --out assets/icons"`.
  pnpm runs it with cwd = `apps/<kebab>`, which is already where the master and the generated
  set belong — no path arithmetic, unlike `validate:assets`.
- **Monorepo root**: `pnpm icons:generate` runs the tool from source with no arguments, so the
  cwd is the repo root and the defaults regenerate the engine's own committed set. Unchanged
  by the bin's existence.

Both flags are spelled out in the scaffolded script, for different reasons. A missing
`--source` **refuses** — the default names an engine path a game does not have. A missing
`--out` does **not**: the default is `electron/assets/icons` relative to the cwd, and a game
has an `electron/` directory, so once the codec is installed eleven files land in its
main-process source tree and the run exits 0. The silent one is why the script never relies
on a default.

### An optional peer, and why the tool loads it lazily

This is the bin whose distribution question is not "can a game reach it" but "what does
reaching it cost". `sharp` is a multi-megabyte platform-specific native binary, so it may not
enter `@chimera-engine/electron`'s runtime dependency closure (Invariant #5). It is declared
as an **optional peer dependency** — package managers do not install a missing optional peer —
and the tool `await import()`s it inside the generate path.

The lazy import is not a style choice. A module-top `import` throws while the module is
loading, before any message can be printed, in exactly the install this design exists to
support. Loading on demand is what turns an opaque `ERR_MODULE_NOT_FOUND` into
`pnpm add -D sharp`.

It is the only codec. The `.icns` and `.ico` containers are assembled by the tool itself
around exact-size renders rather than handed to a library that resizes internally — the
container library that used to do it emitted every power-of-two entry one pixel short in
height from the repo's own 1825px master, which stretched the macOS icon and failed the
Windows build on electron-builder's 256×256 minimum.

Three things have to hold together, and each fails silently on its own:

- **`optional: true`** — a peer declared without it is auto-installed, putting the native
  binary in a consumer's tree just as surely as a `dependencies` entry would.
- **Nothing else hands the codec to a game.** The scaffold's frozen toolchain snapshot is
  derived from the monorepo's root devDeps, which include `sharp` for the engine's own
  `icons:generate`; it is excluded from that snapshot explicitly, or every scaffolded
  project would declare it at its root before the peer declaration was ever consulted. That
  was the live state until F77's gate found it.
- **The entry gate must fire through a `.bin` symlink** — see the harness's
  `isDirectInvocation` above. A bare path compare exits 0 having written nothing, which for a
  generator reads exactly like success.

`verify:scaffold` asserts what a scaffold controls: the bin resolves under the app's
`node_modules/.bin`, the codec appears in neither the app's nor the project's own
`node_modules` (under pnpm's isolated linker those hold exactly what was declared), the
installed manifest declares it as an optional peer and not as a dependency, and a run
**through the script** either writes the set or refuses with the actionable message.

That last one is graded on work done rather than on exit status, because both outcomes are
legitimate and which one occurs is a property of another package's dependency graph. `sharp`
is an `optionalDependency` of **Next**, so a Next-based scaffold installs it regardless, and
pnpm's `.pnpm/node_modules` hoisted layer puts it on the tool's resolution path — at Next's
version, outside the peer range electron declares — so the run there generates for real. The
defect the arm exists for is neither outcome: it is an exit 0 that wrote **nothing**, which is
what a bare-path entry guard produces through a pnpm shim. One further limit worth knowing
before trusting the word "absent": an auto-installed non-optional peer lands under `.pnpm`
rather than in the app's own `node_modules`, so the `optional` flag is enforced by the
manifest read, not by any install observation.

---

## Sibling subpath (`@chimera-engine/electron/eslint`)

The one dev surface in this section that `@chimera-engine/electron` publishes as something
other than a bin — shipped for the same reason as the three above it: a standalone game should not lose a guarantee by leaving the monorepo. Here the
guarantee is the architecture invariants themselves — the `chimera/*` rules are their
executable half, and a game without them is one where §3's boundaries and §4.35's token
discipline are prose. What the rules mean lives in those sections and in
[the tool's own README](../../electron/dev-tools/eslint/README.md); only the distribution
belongs here.

```js
import { chimeraPlugin, standaloneLintConfig } from '@chimera-engine/electron/eslint';
```

A **subpath export, not a bin** — the one dev surface here that is not spawned. A flat
config imports the plugin object and ESLint calls it; there is no argv, so a bin would be a
second way to reach the same object and a second thing to keep working.

That choice removes the wiring question the three bins each had to answer, and replaces it
with a different one: the config that composes the preset lives in the APP, so `eslint` has
to run from there. The scripts follow:

- **App-level** (`apps/<kebab>/package.json`): `"lint": "eslint ."`. In a STANDALONE project
  the app's own `eslint.config.mjs` drives it; for an app inside the monorepo there is no
  app-level config and the root one does, which is why `create-chimera-game` emits that file
  in standalone mode only.
- **Standalone root** (emitted by create-chimera-game): `pnpm lint` forwards to the app, the
  same bare `--filter` delegation `fetch:fonts`, `validate:assets` and `icons:generate` use. The reason differs — `eslint`'s
  bin is at the root already; it is the CONFIG that is not — but the symptom without it was
  identical: `Missing script: lint` in the directory VS Code opens, which reads as the
  scaffold shipping no linting.
- **Monorepo root**: `pnpm lint` builds the packages, then runs `eslint .` per workspace
  package, then `eslint tools eslint.config.mjs vitest.config.mts` for the tree no package
  owns. It loads the same compiled plugin from the same subpath, so the engine and every
  standalone game run one implementation rather than two.

Three properties are worth naming because none is visible from a passing exit code:

- **The rules ship COMPILED.** Loading them used to mean registering `tsx` and `require`ing
  TypeScript at lint time through a CJS shim that only the monorepo had. Nothing transpiles
  during a lint run now — which buys a build-order dependency in exchange: the config
  resolves `electron/dist`, so a missing build fails loudly, and a STALE one is silent and
  means linting against yesterday's rule logic.
- **The token rule resolves its base set through a package specifier**, which is what lets
  it leave the monorepo at all — see the
  [tool README](../../electron/dev-tools/eslint/README.md).
- **The CSS arm widens what `eslint .` covers**, and an unhandled stylesheet aborts the run
  rather than misreporting — the README covers the `silenceOnCss` contract a composing game
  has to satisfy.

`verify:scaffold` is where all of this is held, against an installed probe rather than a
config dump — see [How this is proven](../../electron/dev-tools/eslint/README.md).
The clean pass alone would be satisfied by a config whose zone globs matched nothing, which
is a state this feature reached more than once while being built.

---

## Standalone lint preset — which rules a game gets

Reaching a standalone game at all was the distribution question, answered like the bins
above and recorded in the section above this one: the rules ride the already-published
`@chimera-engine/electron`.

What is _not_ a distribution question, and is settled here, is **which** rules travel. The
answer is not "all nine": four are withheld, two and two — the `no-main-*` pair would guard
nothing on a game tree, and the other two would guard the wrong thing.

| Rule                         | Invariant     | Verdict      | Zones (relative to the game app root)                                             | Why                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------- | ------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-fromfloat-in-simulation` | #76           | **applies**  | `simulation/**`, `ai/**` — `error`; OFF on `*.{test,spec}.{ts,tsx}` under both    | A game's reducers are the hot path the invariant exists for. The OFF arm reproduces the monorepo's third fromFloat block: author fixtures legitimately build fixed-point values with `fromFloat()`.                                                                                                               |
| `no-hardcoded-design-values` | #86, #91      | **applies**  | `screens/**` (TS/TSX) — `error`; plus `screens/**/*.module.css` via `@eslint/css` | Game screens are design-value-bearing UI; this is the exact relative form of the monorepo's games-side glob. The game's `renderer/` is out not because it would be noisy but because there is nothing there to guard — loaders, `register.ts` and Next route re-exports.                                          |
| `no-unknown-token-overrides` | #85           | **applies**  | `styles/tokens-override.css` via `@eslint/css` — `error`                          | The one rule that reads a file. Its base token set resolves through the published `@chimera-engine/renderer/styles/tokens.css` specifier rather than any path relative to the rule module — which is what lets it work outside the monorepo, and what makes a BUILT renderer its prerequisite.                    |
| `no-game-renderer-internals` | #96           | **applies**  | the whole app — `error`                                                           | The games-**side** enforcement of the renderer public-barrel boundary; the single most on-point rule for a game.                                                                                                                                                                                                  |
| `no-raw-r3f-canvas`          | #127          | **applies**  | the whole app — `error`                                                           | The ESLint arm of the GameCanvas-only canvas root: a game must not obtain the raw `Canvas` binding from `@react-three/fiber`; name-based, so the scene hooks from the same specifier stay legal.                                                                                                                  |
| `no-shell-games-import`      | #80, #93, #94 | **does not** | —                                                                                 | Withheld while **live**: its predicate is directory-shaped (`/app/<shell-dir>/`) and a scaffold ships all six of those directories in its own Next host route tree. Withheld because there the forbidden import is legitimate — see below.                                                                        |
| `no-main-games-import`       | —             | **does not** | —                                                                                 | Its predicate needs an `electron/main/` **directory** segment, which a game's flat `electron/main.ts` never has, so it would guard nothing. And were the zone widened to reach it, that file is the sanctioned composition root which names exactly one game — by design.                                         |
| `no-main-provider-internals` | #47           | **does not** | —                                                                                 | Same two reasons as its sibling: no `electron/main/` directory to match, and a game's `electron/main.ts` is the composition root where wiring a concrete provider is the point rather than the violation.                                                                                                         |
| `no-dynamic-games-import`    | #1            | **does not** | —                                                                                 | The only rule with no path predicate at all: the flat-config zone that declares it IS its scope, and a game has no such zone. It would also point the wrong way — it classifies a game by name, any non-engine `@chimera-engine/*` package, and a scaffolded game is one and self-imports through it — see below. |

Two of the four are withheld for the same underlying reason — **a game names itself** — but
they are not withheld at the same urgency, and the difference is worth stating.

`no-shell-games-import` refutes the naive reading — "a game has no engine shell pages". A
scaffolded game's `renderer/app/{main-menu,lobby,game,settings,saves,component-gallery}/`
all match the rule's predicate, and an untouched scaffold stays green only because those
routes re-export `@chimera-engine/renderer/shell/*`, which the rule allowlists. Enable it and
the first game route that imports the game's own package reports — but that import is the app
composing itself, not the engine acquiring a game dependency. The invariants it enforces bind
the engine's shell, which ships inside `@chimera-engine/renderer` and is linted there.

`no-dynamic-games-import` reaches the same wall from the other side, but latently. It has no
path predicate at all — the flat-config zone that declares it is its whole scope — so on a
game's tree it would apply everywhere, and it classifies a game by NAME: any non-engine
`@chimera-engine/*` package. A scaffolded game is called `@chimera-engine/<game-kebab>` and
self-imports through that specifier, so the day a game code-splits one of those self-imports
the rule would report it for lazily loading itself. `curated-rules.ts` carries the measured
form of that reason.

The verdicts are data, not prose: `electron/dev-tools/eslint/curated-rules.ts` exports the
five curated entries **and** the four exclusions with their reasons, so a rule dropped by
accident is distinguishable from one withheld on purpose.

One property of that manifest is load-bearing and invisible from a rule id: **a rule fires
only where the flat-config glob and the rule's own internal predicate agree**, and those
predicates read the absolute filename. `no-fromfloat-in-simulation` wants a `/simulation/`
segment **or** an `apps/<name>/ai/` one — so its `ai/**` zone is live only under `apps/`;
`no-unknown-token-overrides` wants `apps/<name>/styles/tokens-override.css`;
`no-game-renderer-internals` and `no-raw-r3f-canvas` want an `apps/<name>/` segment. A
scaffolded game satisfies all
of them because it lives at `apps/<kebab>`, which makes that layout part of the contract.

One known gap, inherited rather than introduced: a game's `shell/` contributions are renderer
surfaces under Invariant #96, but `no-hardcoded-design-values` reaches only `screens/` — on
both sides of the boundary. Widening it is a change to the engine's own semantics, not to this
relocation. `components/` sits in that same gap and did not simply inherit it: the directory
became a #96 surface when it absorbed a game's reusable DOM React, and the zone set stayed
`screens/` only, as `curated-rules.ts` records. That is deliberate rather than an oversight —
`components/` also holds the in-Canvas r3f primitives, whose `three` material colours are not
CSS values and cannot be expressed as `var(--ch-*)`, so the rule as written would red the
directory it was widened onto. Closing the gap properly means teaching the rule the DOM/Canvas
distinction, which is the same "change to the engine's own semantics" as the `shell/` half.

---

## Instance Flags (`--dev-*`, equals-separator form)

Parsed by `parseHarnessFlags` (`electron/main/index.ts`); every flag is ignored (with one warning) unless `CHIMERA_DEV_HARNESS=1` (Invariant #77).

| Flag                          | Effect                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `--dev-auto-host`             | Host + seed a lobby before the window renders.                                                   |
| `--dev-auto-join=<lobbyCode>` | Join the full `host:port:token` code relayed from the host's announce file.                      |
| `--dev-profile-file=<path>`   | Seed this profile JSON into the repository as the active profile (the §4.24 seed-copy).          |
| `--dev-profile-id=<id>`       | Active-profile id; `dev-p<N>` ids get a generated "Dev Player N" identity when no file is given. |
| `--dev-scenario-file=<path>`  | The scenario driving the auto-flow (settings, attributes, AI seats, auto-start).                 |
| `--dev-seat=<n>`              | This instance's 1-based seat in the scenario (seat 1 = host).                                    |
| `--dev-players=<n>`           | Expected human seats for a scenario-less auto-host (the auto-start latch waits for them).        |
| `--dev-announce-file=<path>`  | Host only: where to write the announce payload (inside its own userData dir, Invariant #78).     |
| `--dev-game=<id>`             | Cross-checked against the hosted game's id; mismatch aborts before any seeding.                  |

There is no port flag: the hosting provider binds an OS-assigned port and mints a session token, so the join code is only knowable from the announce.

---

## Startup Flow (announce-file handshake)

```
chimera-dev-mp CLI                         host instance (p1)                    client instance (p_i)
──────────────────────                     ─────────────────────                 ─────────────────────
resolveHarnessPlan (validate fixtures)
resetDevUserDataDirs (wipe + recreate)
spawn host ─────────────────────────────►  seed profile → ensureActiveProfile
                                           DevHarnessCoordinator.bootstrap():
                                             hostLobby(maxPlayers = seats+aiSeats)
                                             setMatchSetting × scenario.matchSettings
                                             setPlayerAttribute (seat 1)
                                             addAi × aiSeats
                                             write announce {lobbyCode} (atomic)
                                             ready
waitForAnnounceFile ◄──────────────────────  (announce = "host fully seeded" barrier)
spawn clients(lobbyCode) ────────────────────────────────────────────────────►  seed profile, joinLobby(code,
                                           ProfileGate.admit → roster              attestation) → own-seat
                                           auto-start latch: roster complete       attributes → ready
                                             + all ready + AI slots present
                                             → startGame() (once)
                                           snapshot lands → every window: /lobby → /game
Ctrl+C / any exit → SIGTERM all (one-out, all-out; SIGKILL after 5s grace)
```

A bootstrap failure (bad fixture, gameId mismatch, join rejection) exits that instance with a fatal log, and the orchestrator's one-out-all-out teardown stops the siblings — a harness that half-starts is worse than one that stops loudly.

---

## Production Guard

```typescript
// electron/main/startup-guard.ts (Invariant #77)
// isProductionRuntime = isPackaged || env.NODE_ENV === 'production'.
// `isPackaged` (app.isPackaged, injected by the main() composition root) is the
// load-bearing term: electron-builder never sets NODE_ENV, so a NODE_ENV-only
// test would be vacuous for every shipped binary.
if (env['CHIMERA_DEV_HARNESS'] === '1' && isProductionRuntime(env, isPackaged)) {
    throw new Error('CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start.');
}
```

---

## What This Is Not

- **Not an E2E test runner.** Automated assertions belong in the Playwright suite (§13).
- **Not a performance benchmark.** N renderers on one GPU is not representative. Use `§4.16 PerfHud` on single-instance runs.
- **Not a load-testing tool.** For 50-player correctness checking, build a headless `InMemoryMultiplayerProvider` test instead.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #77 | The harness is development-only. The CLI (`assertHarnessEnv`) refuses `NODE_ENV=production`; each spawned instance additionally hits the engine's `main()` startup guard, which refuses for a packaged binary **or** `NODE_ENV=production`. All `--dev-*` flags are ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent. |
| #78 | Each harness-spawned instance runs in an isolated `userData` directory (`.dev-userdata/p<i>/`); shared state between instances is forbidden. The host's announce file lives inside its OWN dir and is read only by the orchestrator — never by a sibling.                                                                          |

---

## Cross-References

- [Multiplayer Provider](multiplayer-provider-websocket.md) — the `LobbyManager` operations the coordinator drives
- [Player Profiles & Directory](player-profiles-directory.md) — seed profiles and `ProfileSanitizer.admit()`
- [E2E Testing](../testing/e2e-testing-playwright.md) — the automated assertion layer above this harness
- `simulation/foundation/dev-fixture-contract.ts` — the scenario/announce schemas + pure helpers
