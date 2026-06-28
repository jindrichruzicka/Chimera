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

| Package                      | May import from                                                                                                                                                                                                                                                                                             | Must NOT import from                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                                                                                                                                                                                                                                                                   | `renderer/`, `electron/`, `games/*`, any DOM API                                            |
| `ai/`                        | `simulation/`, `shared/`                                                                                                                                                                                                                                                                                    | `renderer/`, `electron/`, `games/*`, any DOM API                                            |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals                                                                                                                                                                                                                                         | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data`                           |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files; renderer surfaces in `screens/` and React shell contributions in `shell/` may also import the public component-library barrels `@chimera-engine/renderer/components/ui` (primitives) and `@chimera-engine/renderer/components/chat` (the shared chat component) | Other `games/` directories; renderer internals outside the public component-library barrels |
| `electron/main/`             | All packages                                                                                                                                                                                                                                                                                                | DOM APIs                                                                                    |
| `networking/provider/local/` | Only within `local/`                                                                                                                                                                                                                                                                                        | Engine or renderer internals                                                                |

---

## ESLint Enforcement

- `no-restricted-globals` — blocks `Math.random` / `Date.now` inside `simulation/` and `games/*/actions/`.
- `no-restricted-imports` — blocks `simulation/` from importing `renderer/` or `games/`.
- `chimera/no-fromfloat-in-simulation` — blocks `FixedPoint.fromFloat()` inside hot simulation paths.
- `chimera/no-restricted-globals` — blocks `window`, `document`, `navigator` inside `simulation/` and `ai/`.
- `chimera/no-game-renderer-internals` — allows game `screens/*.tsx` and React `shell/*.tsx` files to import only the public component-library barrels `@chimera-engine/renderer/components/ui` and `@chimera-engine/renderer/components/chat`, and blocks all other renderer imports from games.

Any `// eslint-disable` bypass requires a `@chimera-review: <reason>` comment on the preceding line. CI greps for unaccompanied disables and fails the build.
