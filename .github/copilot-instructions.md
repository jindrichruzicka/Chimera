# Chimera — Workspace Instructions

## Source of Truth (read first)

- [`docs/architecture-overview.md`](../docs/architecture-overview.md) — interfaces, invariants (Appendix B), modules, IPC contracts.
- [`docs/coding-standards.md`](../docs/coding-standards.md) — index hub; sections in [`docs/coding-standards-sections/`](../docs/coding-standards-sections/).

These docs override anything below on conflict.

## Git Skills

Always invoke via skill scripts; never bypass.

| Op                | Script                                                               | When                     |
| ----------------- | -------------------------------------------------------------------- | ------------------------ |
| Sync main         | `bash .github/skills/git/pull-latest/scripts/pull-latest.sh`         | Before branching/merging |
| Branch from issue | `bash .github/skills/git/create-branch/scripts/create-branch.sh <N>` | Start of issue work      |
| Commit + push     | `bash .github/skills/git/commit-and-push/scripts/commit-and-push.sh` | Save WIP on topic branch |
| Merge to main     | `bash .github/skills/git/merge/scripts/check-and-merge.sh`           | Land completed work      |

Overview: [`.github/skills/git/SKILL.md`](../.github/skills/git/SKILL.md).

## Hard Rules (BLOCK at review)

- **TypeScript strict**: no `any`, `@ts-ignore`, or `as unknown as X` without a justification comment. `readonly` on data fields. Explicit return types on public functions. Branded types for ID strings (`PlayerId`, `AssetRef<T>`, `DataRef<T>`). Generics named semantically (`TState`, `TPayload`).
- **Format**: 4-space indent, all `.ts/.tsx/.js/.json`. Run `pnpm format` before commit.
- **Pre-commit gate** (all must exit 0): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. Never `--no-verify`.
- **Determinism** (Inv #43, #44): no `Math.random()`, `Date.now()`, `performance.now()` in `simulation/`, `ai/`, `games/*/actions/`. Use `ctx.rng`, `snapshot.tick`. No float fields in `GameSnapshot` arithmetic/equality.
- **IPC security** (Inv #1): `GameSnapshot` stays in main. Only `PlayerSnapshot` crosses boundaries. Validate every `ipcMain.handle` input with Zod. `BrowserWindow`: `nodeIntegration:false`, `contextIsolation:true`.
- **React/Zustand**: narrow typed selectors only; dispatch via `useSendAction()` hook, never `window.__chimera.game.sendAction()` directly.

## Module Boundaries

| Package                      | May import                                                          | Must NOT import                                                   |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `simulation/`                | `shared/`                                                           | `renderer/`, `electron/`, `games/*`, DOM                          |
| `ai/`                        | `simulation/`, `shared/`                                            | `renderer/`, `electron/`, `games/*`, DOM                          |
| `renderer/`                  | `simulation/content` (types only), `shared/`, `renderer/` internals | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/`              | `simulation/`, `ai/`, `shared/`, own files                          | Other `games/` dirs                                               |
| `electron/main/`             | All                                                                 | DOM APIs                                                          |
| `networking/provider/local/` | `local/` only                                                       | Engine/renderer internals                                         |

Full 79 invariants: `docs/architecture-overview.md` Appendix B.
