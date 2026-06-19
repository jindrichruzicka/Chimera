---
title: 'M9 — Package Extraction & Game Scaffolding (v0.9.0)'
description: 'F57–F67: pnpm Workspace Foundation, Extract @chimera/simulation, @chimera/ai, @chimera/networking, @chimera/renderer, @chimera/electron, Tactics Standalone Consumer App + E2E Migration, Package Build/Link/Update Pipeline, create-chimera-game CLI + Blank Template, Engine Package Publishing, and App Icon & Per-Game Branding. Executes Appendix C — from a single-package monorepo to a published package hierarchy — and adds a CLI that scaffolds new games from a template.'
tags:
    [
        milestone,
        m9,
        packaging,
        monorepo,
        pnpm-workspaces,
        package-extraction,
        simulation,
        ai,
        networking,
        renderer,
        electron,
        tactics,
        e2e,
        cli,
        scaffolding,
        templates,
        publishing,
        semver,
        branding,
        icons,
    ]
---

# M9 — Package Extraction & Game Scaffolding (v0.9.0)

> **Goal**: Transition Chimera from a single-package monorepo to an isolated, independently consumable **package hierarchy** (`@chimera/simulation`, `@chimera/ai`, `@chimera/networking`, `@chimera/renderer`, `@chimera/electron`), with **tactics** moved to a standalone consumer app that exercises the packaged builds end-to-end, a one-command build/link/update pipeline, a `create-chimera-game` scaffolding CLI, and registry publishing. Executes the architecture's Appendix C with no logic refactor — the dependency arrows already point inward toward the core.
> Architecture sections: Appendix C (C.1–C.6), §3

---

## F57 — Monorepo pnpm Workspace Foundation `Appendix C.5, §3`

Introduce `pnpm-workspace.yaml` and restructure the repository into `packages/` (engine), `apps/` (consumer games), `tools/` (CLI), and `templates/` (scaffolding sources) — a true monorepo in one git history. Replace the `tsconfig` path aliases (`@chimera/*`) with real workspace `package.json` dependencies and wire `tsc --build` project references for incremental, dependency-ordered compilation. Root scripts (`build`, `test`, `lint`, `typecheck`) run recursively via `pnpm -r`. This is pure restructuring — no logic changes; the full unit and E2E suites stay green as the acceptance gate.

---

## F58 — Extract `@chimera/simulation` `Appendix C.3, §C.4, §3`

Establish the reusable per-package pattern on the core leaf: a `package.json` with `exports`/`types`, a side-effect-free `index.ts` barrel exposing contract types only, a `dist/` build, and import-boundary lint. Per Appendix C.3, `@chimera/simulation` absorbs `shared/`, exposing contracts through a side-effect-free subpath so `renderer`/`networking` consume contract types without pulling simulation runtime (preserves Invariant #1 purity). Extract `SimulationHost` out of `electron/main/simulation-host.ts` into the package (making the host composable outside Electron) and add `ActionRegistry.mergeFrom(definitions)` to enable extension/game action registration (Appendix C.4). The package has zero runtime dependencies.

---

## F59 — Extract `@chimera/ai` `Appendix C.3, §3`

Move `ai/` into a workspace package depending on `@chimera/simulation`. Curate the `index.ts` barrel to expose the game-agnostic agent framework only (`PlayerAgent`, `AIBrain`, `CommandScheduler`), and enforce Invariants #106/#107 across the new package boundary — game-specific AI stays in the consumer's `games/<name>/ai/`, never inside the package.

---

## F60 — Extract `@chimera/networking` `Appendix C.3, §3`

Move `networking/` into a workspace package depending on `@chimera/simulation`. The barrel exposes only the provider/transport interfaces (`MultiplayerProvider`, `HostTransport`, `ClientTransport`); provider-specific implementations stay internal, upholding Invariant #47 (orchestration imports only through the public interfaces, never provider subdirectories).

---

## F61 — Extract `@chimera/renderer` `Appendix C.3, §3`

Package the Next.js / React / React-Three-Fiber renderer, depending on `@chimera/simulation` (type-only contracts and `content`), React, and Three.js. The two public component barrels — `@chimera/renderer/components/ui` (design primitives) and `@chimera/renderer/components/chat` — are the only consumer entry points, upholding Invariants #80, #94, #96. Resolve the Next.js build so the renderer ships as a consumable component/shell library while each consumer app owns its own Next application.

---

## F62 — Extract `@chimera/electron` `Appendix C.3, §3`

Package `electron/` (main + preload) depending on all engine packages. The host game registry (`mainGameRegistry`) becomes a runtime injection point so a consumer app supplies its own game definition; the package itself ships no game-specific code. `@chimera/electron` becomes the thin Electron wrapper around the composable `SimulationHost` extracted in **F58**.

---

## F63 — Tactics Standalone Consumer App + E2E Migration `Appendix C.3, §3`

Move `games/tactics/` to `apps/tactics/` as a standalone application that depends on the packaged `@chimera/*` builds and registers its game into the electron host and the renderer through the public registries. Relocate the entire `e2e/` Playwright suite into `apps/tactics/` so the consumer owns its own end-to-end coverage. Tactics is explicitly the engine's reference consumer — the single place that proves the extracted packages compose into a runnable, testable game.

---

## F64 — Package Build/Link/Update Pipeline `Appendix C.4, §C.5`

Deliver the fluent flow: a topological `pnpm -r build` rebuilds every `@chimera/*` package and `apps/tactics` picks up the fresh `dist/` instantly through its `workspace:*` links, plus a watch mode for live development. Add a `verify:pack` script that runs `pnpm -r pack`, installs the resulting tarballs into a clean throwaway consumer, and runs the E2E suite against the **real packaged artifact** — catching missing `exports`/`files` that workspace symlinks would otherwise mask. This hybrid model keeps day-to-day iteration instant while gating releases on true-artifact validation.

---

## F65 — `create-chimera-game` CLI + Blank Template `Appendix C.6`

A platform-independent Node CLI in `tools/create-chimera-game/` that scaffolds a new `apps/<game>` from `templates/blank/`. A single input name is normalised once and expanded into every required casing — kebab (`my-card-game`), camel (`myCardGame`), Pascal (`MyCardGame`), Title (`My Card Game`), CONSTANT (`MY_CARD_GAME`), and lower (`mycardgame`) — and substituted through explicit named tokens (`__game_kebab__`, `__GamePascal__`, `__GAME_CONSTANT__`, …) across both file contents and file/directory names, which deterministically solves both the `tactics`/`Tactics` case split and multiword game names. The blank template wires the new app's `@chimera/*` dependencies plus a minimal action registry, one screen, a content stub, and host + renderer game registration so the generated app boots immediately.

---

## F66 — Engine Package Publishing & Release Pipeline `Appendix C.4`

Publish `@chimera/simulation`, `@chimera/ai`, `@chimera/networking`, `@chimera/renderer`, and `@chimera/electron` to a registry (default: public npm, scoped `@chimera/*`) with independent semantic versioning and per-package changelogs — `@chimera/simulation` breaking changes are major bumps. Add a CI release workflow that, on a version tag, builds, runs `verify:pack`, and publishes the packages. Document the `@chimera/<domain>` extension-library on-ramp (e.g. `@chimera/cards` with `peerDependencies` on `@chimera/simulation`) as the external-adopter pattern from Appendix C.6.

---

## F67 — App Icon & Per-Game Branding `Appendix C.4, C.6`

Replace the stock Electron icon with the Chimera logo as the default application and window icon, overridable per game through the `GameManifest` `icon` field (the same manifest that drives the per-game window title and the `realtime` heartbeat flag). Two layers ship together: (1) **runtime** — `createMainWindow` sets the `BrowserWindow` `icon` and, on macOS, calls `app.dock.setIcon`, resolving either the bundled default Chimera icon asset or a game's manifest override at window creation; (2) **packaging** — generate the platform icon set (`.icns` / `.ico` / PNG) from the Chimera logo source and wire it into the electron build configuration introduced by the build/release pipeline (**F64** / **F66**) so distributed bundles carry the icon, not just the dev runtime. Tactics keeps the default (no manifest override); a scaffolded game (**F65**) drops one icon path into its manifest to rebrand both window and dock. Deferred out of the initial game-manifest work — which delivers `displayName` / window title and the `realtime` flag — because a true installer icon depends on the packaging pipeline this milestone introduces.

---

## Cross-References

- [Architecture Overview — Appendix C (From Monorepo to Package Hierarchy)](../architecture-overview.md#appendix-c-roadmap-from-monorepo-to-package-hierarchy)
- [Module Boundaries](../coding-standards-sections/module-boundaries.md) — import-direction rules the package graph enforces
- [Module Boundaries & File Tree](../executive-architecture/module-boundaries-file-tree.md) — annotated target file tree
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — #1, #47, #80, #94, #96, #106, #107 (package-boundary purity & barrels)
