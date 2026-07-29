---
title: 'Chimera Coding Standards — §3 Module Boundaries'
description: 'Hard module boundary constraints between packages in the Chimera engine, including the ESLint rules that enforce them.'
tags:
    [module-boundaries, imports, eslint, packages, simulation, renderer, electron, coding-standards]
---

# §3 Module Boundaries

> Part of [Coding Standards Index Hub](../coding-standards.md)

These boundaries are hard constraints. Violations are **BLOCK** findings at review.

---

## Boundary Table

| Package                      | May import from                                                                                                     | Must NOT import from                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                                                                           | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `ai/`                        | `simulation/`, `shared/`                                                                                            | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals                                                 | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files; renderer surfaces may import what Invariant #96 permits, per file group | Other `games/` directories; every other renderer path             |
| `electron/main/`             | All packages                                                                                                        | DOM APIs                                                          |
| `networking/provider/local/` | Only within `local/`                                                                                                | Engine or renderer internals                                      |

---

## ESLint Enforcement

- `no-restricted-syntax` — blocks `Math.random`, `Date.now` and `performance.now` inside `simulation/`, `ai/` and each game's `actions/`, `simulation/` and `ai/`.
- `no-restricted-imports` — blocks `simulation/` from importing `renderer/` or `games/`.
- `chimera/no-fromfloat-in-simulation` — blocks `FixedPoint.fromFloat()` inside hot simulation paths (Invariant #76).
- `chimera/no-game-renderer-internals` — the executable form of Invariant #96, which states per file group what a games package may reach in renderer. Everything outside those groups is blocked.
- `chimera/no-hardcoded-design-values` — blocks colour and size literals in renderer UI and game screens; design values flow through `var(--ch-*)` tokens (Invariants #86, #91).
- `chimera/no-unknown-token-overrides` — blocks a game token override that redefines a token the engine does not declare (Invariant #85).
- `chimera/no-shell-games-import` — blocks the engine shell pages and `GameShell`/`InGameMenuHost` from importing any game path (Invariants #80, #93, #94).
- `chimera/no-main-games-import` / `chimera/no-main-provider-internals` — keep `electron/main` orchestration agnostic of which game exists and of which networking provider is wired (Invariant #47).

Any `// eslint-disable` bypass requires a `@chimera-review: <reason>` comment on the preceding line. CI greps for unaccompanied disables and fails the build.

### These rules reach standalone games

Four of the `chimera/*` rules are not monorepo-only. They ship from
`@chimera-engine/electron/eslint` (§4.32), so a game scaffolded by `create-chimera-game` and
developed outside this repo enforces them on its own code — and the monorepo's own root
config loads that same compiled plugin, so there is one implementation rather than two.

Those four are the ones that bind GAME code: `no-fromfloat-in-simulation`,
`no-hardcoded-design-values`, `no-unknown-token-overrides` and `no-game-renderer-internals`.
The three that guard the engine's own internals stay here — `curated-rules.ts` records the
per-rule reason, as data, so a rule dropped by accident is distinguishable from one withheld
on purpose.

The first two bullets above are **monorepo-only**, and deliberately so — they are stock
ESLint rules configured against this repo's paths, not `chimera/*` rules the preset can
carry. A standalone game gets no `no-restricted-syntax` determinism guard and no
`no-restricted-imports` boundary, so `Math.random()` in its reducer is unflagged by lint;
Invariant #43 still binds it, enforced by review and by the determinism tests a game writes
against its own simulation.
