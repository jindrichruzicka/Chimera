# Chimera — Workspace Instructions

## Source of Truth

Always read these two documents before writing or reviewing any code:

- [`docs/architecture-overview.md`](../docs/architecture-overview.md) — interfaces, invariants, module structure, IPC contracts, naming conventions
- [`docs/coding-standards.md`](../docs/coding-standards.md) — TypeScript rules, SOLID, module boundaries, React/R3F, Electron/IPC security, testing, performance, git workflow

These documents take precedence over anything in this file if they conflict.

---

## Git Workflow Skills

Before performing any git operations, use the appropriate skill from the git skillset:

- **Sync main with remote**: [`.github/skills/git/pull-latest/SKILL.md`](../.github/skills/git/pull-latest/SKILL.md)
    - Run: `bash .github/skills/git/pull-latest/scripts/pull-latest.sh`
    - Use when: Starting a new task, before creating branches, before merging

- **Create branch from issue**: [`.github/skills/git/create-branch/SKILL.md`](../.github/skills/git/create-branch/SKILL.md)
    - Run: `bash .github/skills/git/create-branch/scripts/create-branch.sh <N>`
    - Use when: Starting work on a GitHub issue

- **Merge branch to main**: [`.github/skills/git/merge/SKILL.md`](../.github/skills/git/merge/SKILL.md)
    - Run: `bash .github/skills/git/merge/scripts/check-and-merge.sh`
    - Use when: Landing completed work onto main

See [`.github/skills/git/SKILL.md`](../.github/skills/git/SKILL.md) for the complete git skillset overview.

---

## Module Boundary Table

These boundaries are hard constraints. Any violation is a **BLOCK** finding at review.

| Package                      | May import from                                                     | Must NOT import from                                              |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                           | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `ai/`                        | `simulation/`, `shared/`                                            | `renderer/`, `electron/`, `games/*`, any DOM API                  |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files                          | Other `games/` directories                                        |
| `electron/main/`             | All packages                                                        | DOM APIs                                                          |
| `networking/provider/local/` | Only within `local/`                                                | Engine or renderer internals                                      |

---

## Non-Negotiables

### TypeScript

- `strict: true` — mandatory everywhere. No `any`, no `@ts-ignore`, no `as unknown as X` without a justification comment.
- `readonly` on every field of data types.
- All public function return types are explicitly annotated.
- Branded types for string-shaped identifiers: `PlayerId`, `AssetRef<T>`, `DataRef<T>`.
- Generic parameters named semantically: `TState`, `TParams`, `TPayload` — never `T`, `U`, `V` in non-trivial contexts.

### Formatting

- **Indentation: 4 spaces.** No tabs. No 2-space. Applies to all `.ts`, `.tsx`, `.js`, `.json` files.
- Run `pnpm format` before every commit. CI fails on `pnpm format:check` diffs.

### Pre-commit gate (mandatory — all must exit 0 before `git commit`):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Never use `git commit --no-verify`. Never bypass this gate.

### Simulation determinism (Invariants #43, #44)

- `Math.random()`, `Date.now()`, `performance.now()` are forbidden inside `simulation/` or `ai/` or `games/*/actions/`.
- Use `ctx.rng` from `ReduceContext` for randomness; use `snapshot.tick` for simulation time.
- No float fields in `GameSnapshot` that participate in equality or arithmetic.

### IPC security (Invariant #1)

- `GameSnapshot` must never leave the main process. Only `PlayerSnapshot` crosses IPC or WebSocket boundaries.
- Every `ipcMain.handle` input must be validated with Zod before passing to the simulation.
- All `BrowserWindow` instances: `nodeIntegration: false`, `contextIsolation: true`.

### React / Zustand

- Components subscribe to Zustand via narrow typed selectors only — never the whole store.
- Actions dispatched through a typed hook (`useSendAction()`), never `window.__chimera.game.sendAction()` directly.

---

## Key Architecture Invariants (from Appendix B)

| #   | Rule                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | `GameSnapshot` never leaves main process; only `PlayerSnapshot` crosses boundaries                |
| 2   | `simulation/` has zero imports from `renderer/`, `electron/`, `games/*`, or any DOM API           |
| 36  | Content data drives `AssetRef` strings; renderer resolves them — no hard-coded URLs in components |
| 42  | All `GameSnapshot` arithmetic fields are integers                                                 |
| 43  | `validate()` and `reduce()` use only `ctx.rng` / `ctx.db` — no `Math.random()`, no `Date.now()`   |
| 44  | No float fields in `GameSnapshot` that participate in equality or arithmetic                      |
| 47  | `AssetManager` never imports from `games/*`                                                       |

The full invariant list (79 entries) is in `docs/architecture-overview.md` Appendix B.
