---
title: 'M9 — Package Extraction & Game Scaffolding (v0.9.0)'
description: 'F57–F68: pnpm Workspace Foundation, Extract @chimera-engine/simulation, @chimera-engine/ai, @chimera-engine/networking, @chimera-engine/renderer, @chimera-engine/electron, Tactics Standalone Consumer App + E2E Migration, Package Build/Link/Update Pipeline, create-chimera-game CLI + Blank Template, Engine Package Publishing, App Icon & Per-Game Branding, and Save System: In-Game Save & Restorable Sessions. Executes Appendix C — from a single-package monorepo to a published package hierarchy — and adds a CLI that scaffolds new games from a template.'
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
        save-load,
        multiplayer,
    ]
---

# M9 — Package Extraction & Game Scaffolding (v0.9.0)

> **Goal**: Transition Chimera from a single-package monorepo to an isolated, independently consumable **package hierarchy** (`@chimera-engine/simulation`, `@chimera-engine/ai`, `@chimera-engine/networking`, `@chimera-engine/renderer`, `@chimera-engine/electron`), with **tactics** moved to a standalone consumer app that exercises the packaged builds end-to-end, a one-command build/link/update pipeline, a `create-chimera-game` scaffolding CLI, and registry publishing. Executes the architecture's Appendix C with no logic refactor — the dependency arrows already point inward toward the core.
> Architecture sections: Appendix C (C.1–C.6), §3

---

## F57 — Monorepo pnpm Workspace Foundation `Appendix C.5, §3`

Introduce `pnpm-workspace.yaml` and restructure the repository into `packages/` (engine), `apps/` (consumer games), `tools/` (CLI), and `templates/` (scaffolding sources) — a true monorepo in one git history. Replace the `tsconfig` path aliases (`@chimera-engine/*`) with real workspace `package.json` dependencies. Root scripts (`build`, `test`, `lint`, `typecheck`) run recursively via `pnpm -r`. This is pure restructuring — no logic changes; the full unit and E2E suites stay green as the acceptance gate.

> **Deferred to F58 — `tsc --build` project references.** Wiring composite per-package `tsconfig` project references was originally part of F57, but the current source contains import cycles that make `tsc --build` abort with a reference-cycle error (TS6202): `shared ↔ simulation`, `shared ↔ networking`, and `shared → electron` (see the **Sequencing note** at the foot of this milestone). The reference graph cannot be acyclic until **F58** makes `@chimera-engine/shared` a true zero-dep leaf, so the project-reference wiring moves to F58 (tracked in [#756](https://github.com/jindrichruzicka/Chimera/issues/756), superseding the deferred [#753](https://github.com/jindrichruzicka/Chimera/issues/753)).

---

## F58 — Extract `@chimera-engine/simulation` `Appendix C.3, §C.4, §3`

Establish the reusable per-package pattern on the core leaf: a `package.json` with `exports`/`types`, a side-effect-free `index.ts` barrel exposing contract types only, a `dist/` build, and import-boundary lint. Per Appendix C.3, `@chimera-engine/simulation` absorbs `shared/`, exposing contracts through a side-effect-free subpath so `renderer`/`networking` consume contract types without pulling simulation runtime (preserves Invariant #1 purity). Extract `SimulationHost` out of `electron/main/simulation-host.ts` into the package (making the host composable outside Electron) and add `ActionRegistry.mergeFrom(definitions)` to enable extension/game action registration (Appendix C.4). The package has zero runtime dependencies.

As part of this absorption, **eliminate the `shared → simulation`/`networking`/`electron` back-edges** so `@chimera-engine/shared` (or the contract subpath that replaces it) becomes a true zero-dep foundational leaf — e.g. relocate the brand/contract types `PlayerId`/`EngineAction`/`GameResult`/`AssetRef`/`AudioClipAsset` and the lobby/screen-contract types into the foundation layer, re-exporting from their old homes for compatibility. With the core dependency graph made acyclic (`shared` ← `simulation` ← {`ai`, `networking`}; `shared` ← {`ai`, `networking`}), **wire the `tsc --build` project references deferred from F57** ([#756](https://github.com/jindrichruzicka/Chimera/issues/756)).

---

## F59 — Extract `@chimera-engine/ai` `Appendix C.3, §3`

Move `ai/` into a workspace package depending on `@chimera-engine/simulation`. Curate the `index.ts` barrel to expose the game-agnostic agent framework only (`PlayerAgent`, `AIBrain`, `CommandScheduler`), and enforce Invariants #106/#107 across the new package boundary — game-specific AI stays in the consumer's `games/<name>/ai/`, never inside the package.

---

## F60 — Extract `@chimera-engine/networking` `Appendix C.3, §3`

Move `networking/` into a workspace package depending on `@chimera-engine/simulation`. The barrel exposes only the provider/transport interfaces (`MultiplayerProvider`, `HostTransport`, `ClientTransport`); provider-specific implementations stay internal, upholding Invariant #47 (orchestration imports only through the public interfaces, never provider subdirectories).

---

## F61 — Extract `@chimera-engine/renderer` `Appendix C.3, §3`

Package the Next.js / React / React-Three-Fiber renderer, depending on `@chimera-engine/simulation` (type-only contracts and `content`), React, and Three.js. The two public component barrels — `@chimera-engine/renderer/components/ui` (design primitives) and `@chimera-engine/renderer/components/chat` — are the only consumer entry points, upholding Invariants #80, #94, #96. Resolve the Next.js build so the renderer ships as a consumable component/shell library while each consumer app owns its own Next application.

---

## F62 — Extract `@chimera-engine/electron` `Appendix C.3, §3`

Package `electron/` (main + preload) depending on all engine packages. The host game registry (`mainGameRegistry`) becomes a runtime injection point so a consumer app supplies its own game definition; the package itself ships no game-specific code. `@chimera-engine/electron` becomes the thin Electron wrapper around the composable `SimulationHost` extracted in **F58**.

---

## F63 — Tactics Standalone Consumer App + E2E Migration `Appendix C.3, §3`

Move `games/tactics/` to `apps/tactics/` as a standalone application that depends on the packaged `@chimera-engine/*` builds and registers its game into the electron host and the renderer through the public registries. Relocate the entire `e2e/` Playwright suite into `apps/tactics/` so the consumer owns its own end-to-end coverage. Tactics is explicitly the engine's reference consumer — the single place that proves the extracted packages compose into a runnable, testable game.

---

## F64 — Package Build/Link/Update Pipeline `Appendix C.4, §C.5`

Deliver the fluent flow: a topological `pnpm -r build` rebuilds every `@chimera-engine/*` package and `apps/tactics` picks up the fresh `dist/` instantly through its `workspace:*` links, plus a watch mode for live development. Add a `verify:pack` script that runs `pnpm -r pack`, installs the resulting tarballs into a clean throwaway consumer, and runs the E2E suite against the **real packaged artifact** — catching missing `exports`/`files` that workspace symlinks would otherwise mask. This hybrid model keeps day-to-day iteration instant while gating releases on true-artifact validation.

---

## F65 — `create-chimera-game` CLI + Blank Template `Appendix C.6`

A platform-independent Node CLI in `tools/create-chimera-game/` that scaffolds a new `apps/<game>` from its bundled `tools/create-chimera-game/templates/blank/`. A single input name is normalised once and expanded into every required casing — kebab (`my-card-game`), camel (`myCardGame`), Pascal (`MyCardGame`), Title (`My Card Game`), CONSTANT (`MY_CARD_GAME`), and lower (`mycardgame`) — and substituted through explicit named tokens (`__game_kebab__`, `__GamePascal__`, `__GAME_CONSTANT__`, …) across both file contents and file/directory names, which deterministically solves both the `tactics`/`Tactics` case split and multiword game names. The blank template wires the new app's `@chimera-engine/*` dependencies plus a minimal action registry, one screen, a content stub, and host + renderer game registration so the generated app boots immediately.

---

## F66 — Engine Package Publishing & Release Pipeline `Appendix C.4`

Publish `@chimera-engine/simulation`, `@chimera-engine/ai`, `@chimera-engine/networking`, `@chimera-engine/renderer`, and `@chimera-engine/electron` to a registry (default: public npm, scoped `@chimera-engine/*`) with independent semantic versioning and per-package changelogs — `@chimera-engine/simulation` breaking changes are major bumps. Add a CI release workflow that, on a version tag, builds, runs `verify:pack`, and publishes the packages. Document the `@chimera-engine/<domain>` extension-library on-ramp (e.g. `@chimera-engine/cards` with `peerDependencies` on `@chimera-engine/simulation`) as the external-adopter pattern from Appendix C.6.

The extension-library on-ramp is documented in the [Extension-Library Adopter On-Ramp](../adopter-on-ramp.md) guide.

---

## F67 — App Icon & Per-Game Branding `Appendix C.4, C.6`

Replace the stock Electron icon with the Chimera logo as the default application and window icon, overridable per game through the `GameManifest` `icon` field (the same manifest that drives the per-game window title and the `realtime` heartbeat flag). Two layers ship together: (1) **runtime** — `createMainWindow` sets the `BrowserWindow` `icon` and, on macOS, calls `app.dock.setIcon`, resolving either the bundled default Chimera icon asset or a game's manifest override at window creation; (2) **packaging** — generate the platform icon set (`.icns` / `.ico` / PNG) from the Chimera logo source and wire it into the electron build configuration introduced by the build/release pipeline (**F64** / **F66**) so distributed bundles carry the icon, not just the dev runtime. Tactics keeps the default (no manifest override); a scaffolded game (**F65**) drops one icon path into its manifest to rebrand both window and dock. Deferred out of the initial game-manifest work — which delivers `displayName` / window title and the `realtime` flag — because a true installer icon depends on the packaging pipeline this milestone introduces.

---

## F68 — Save System: In-Game Save & Restorable Sessions `§4.11, §4.14`

Close the three user-facing gaps in the existing save backend (F06/F18): saves can only be created from the saves screen's "New Save" form, loading a save cannot start a game (`applyRestoredFile` no-ops without an active session), and multiplayer saves cannot be resumed because provider-assigned `PlayerId`s are minted per-lobby and AI-vs-human seat composition is not persisted. Four deliverables ship together: (1) **UI** — the saves screen is rebuilt on the replay-browser pattern (load/delete rows, confirm dialog, close button; the "New Save" form and per-row overwrite are removed) and a compact host-only Save button joins the tactics HUD footer, prompting for a save name via a modal backed by a reusable engine `SaveGameButton`; (2) **save format v6** — `SaveFile` gains a game-agnostic `session` manifest (`matchId` + seat roster with `host|local|remote|ai` control) and `BaseGameSnapshot` gains a `matchId` minted at `engine:start_game`, so a save fully describes who sat where without profile data (Invariant #59); (3) **restorable sessions** — a `SessionRestoreCoordinator` makes menu-load host a fresh session seeded with the saved roster, apply the checkpoint via the existing Invariant #24 path, and — for saves with remote human seats — hold the game behind a "Waiting for other players" modal (spinner, join code, cancel) until every human reconnects; (4) **seat reattachment** — clients persist per-match session tickets locally and present bounded `claims` in the JOIN frame, which the host resolves against the restored roster (falling back to join-order for unclaimed seats) so returning humans reclaim their original `PlayerId`s and control their original entities. Lobby-agreed match settings (e.g. simultaneous turns) and player colors already ride the checkpoint's `setup` and restore for free. Covered by two new Playwright specs: a single-app save→leave→load→verify→delete flow and a two-process multiplayer save→waiting-overlay→reclaim→resume flow.

---

## Sequencing note — `tsc --build` project references deferred to F58

**Decision (2026-06-19):** wiring `tsc --build` project references was descoped from **F57** and moved to **F58**, because the source does not yet form the acyclic inward DAG that project references require.

Although the `workspace:*` manifests declare a clean DAG (`@chimera-engine/shared` and `@chimera-engine/simulation` each declare zero deps), the actual TypeScript imports cross those boundaries in both directions:

- **`shared ↔ simulation`** — `simulation/content/AssetRef.ts` imports the value `MalformedAssetRefError` from `@chimera-engine/shared`, while `shared/messages.ts`, `shared/chat.ts`, and `shared/game-screen-contract.ts` import `PlayerId`/`EngineAction`/`GameResult`/`AssetRef` types from `@chimera-engine/simulation`.
- **`shared ↔ networking`** — `networking/` imports `crc32Json`/schemas/message types from `@chimera-engine/shared`, while `shared/messages.ts` imports from `@chimera-engine/networking/provider/MultiplayerProvider`.
- **`shared → electron`** — `shared/game-screen-contract.ts` imports types from `@chimera-engine/electron/preload/api-types`.

TypeScript project references resolve at the file/program level — even `import type` forces a `references` entry — so the `shared ↔ simulation` 2-cycle has no acyclic subgraph and `tsc --build` aborts with **TS6202 (reference cycle)**. The fix is exactly what **F58** already plans: have `@chimera-engine/simulation` absorb `shared/` and expose contracts through a side-effect-free subpath, making the foundation layer a true zero-dep leaf. Once that lands, the project references become wireable. Tracking: [#756](https://github.com/jindrichruzicka/Chimera/issues/756) (the correctly-sequenced task) supersedes the deferred [#753](https://github.com/jindrichruzicka/Chimera/issues/753); F57 ([#750](https://github.com/jindrichruzicka/Chimera/issues/750)) completes on real `workspace:*` deps + recursive `pnpm -r` scripts without the references.

---

## Cross-References

- [Architecture Overview — Appendix C (From Monorepo to Package Hierarchy)](../architecture-overview.md#appendix-c-roadmap-from-monorepo-to-package-hierarchy)
- [Extension-Library Adopter On-Ramp](../adopter-on-ramp.md) — the `@chimera-engine/<domain>` publish/consume pattern for external adopters (F66)
- [Module Boundaries](../coding-standards-sections/module-boundaries.md) — import-direction rules the package graph enforces
- [Module Boundaries & File Tree](../executive-architecture/module-boundaries-file-tree.md) — annotated target file tree
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — #1, #47, #80, #94, #96, #106, #107 (package-boundary purity & barrels)
