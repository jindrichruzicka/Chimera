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

| Package                      | May import from                                                     | Must NOT import from                                              |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                           | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `ai/`                        | `simulation/`, `shared/`                                            | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files                          | Other `games/` directories                                        |
| `electron/main/`             | All packages                                                        | DOM APIs                                                          |
| `networking/provider/local/` | Only within `local/`                                                | Engine or renderer internals                                      |

---

## ESLint Enforcement

- `no-restricted-globals` — blocks `Math.random` / `Date.now` inside `simulation/` and `games/*/actions/`.
- `no-restricted-imports` — blocks `simulation/` from importing `renderer/` or `games/`.
- `chimera/no-fromfloat-in-simulation` — blocks `FixedPoint.fromFloat()` inside hot simulation paths.
- `chimera/no-restricted-globals` — blocks `window`, `document`, `navigator` inside `simulation/` and `ai/`.

Any `// eslint-disable` bypass requires a `@chimera-review: <reason>` comment on the preceding line. CI greps for unaccompanied disables and fails the build.
