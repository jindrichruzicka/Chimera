# Chimera — Workspace Instructions

## Source of Truth (read first)

- [`docs/architecture-overview.md`](docs/architecture-overview.md) — interfaces, modules, IPC contracts.
- [`docs/coding-standards.md`](docs/coding-standards.md) — index hub; sections in [`docs/coding-standards-sections/`](docs/coding-standards-sections/)
- [`docs/executive-architecture/architecture-invariants.md`](docs/executive-architecture/architecture-invariants.md)

## Working With This Repo Via Claude Code

This repo provides a complete Claude Code surface mirrored from the existing
GitHub Copilot configuration under `.github/`. Both surfaces are kept in sync;
edit either one and reflect the change in the other.

- **Subagents**: `.claude/agents/chimera-*.md` — architect, code-reviewer, engine-developer, engine-planner, git-operations, product-manager, qa-engineer, release-manager. Claude routes by `description`; explicit invocation works too.
- **Slash commands**: `.claude/commands/*.md` — `/bootstrap-feature`, `/bootstrap-milestone`, `/create-issues-feature-review`, `/create-release`, `/implement-issue`, `/implement-issue-merge`, `/merge-to-main`, `/publish-packages`, `/review-branch`, `/review-feature`, `/review-milestone`.
- **Skills**: `.claude/skills/{git,github,invariants,tdd}/` — load the matching `SKILL.md` before performing the corresponding operation.
- **Hooks**: `.claude/settings.json` enforces the pre-commit gate and blocks `git commit --no-verify`.

### Per-area rules (nested `CLAUDE.md`)

When editing files inside these directories, Claude Code automatically loads the local rules in addition to this file:

- [`electron/main/CLAUDE.md`](electron/main/CLAUDE.md) — main process / IPC.
- [`renderer/CLAUDE.md`](renderer/CLAUDE.md) — React/R3F renderer.
- [`simulation/CLAUDE.md`](simulation/CLAUDE.md) and [`ai/CLAUDE.md`](ai/CLAUDE.md) — pure deterministic simulation and AI. The same rules apply to per-game gameplay code under `apps/<game>/simulation/` and `apps/<game>/ai/` (enforced by the `apps/*/simulation` ESLint zones).

## Test Files — Rules

These rules apply to every `*.test.ts(x)` file. Claude Code does not support
glob-scoped instructions, so they live here.

Source of truth:

- [TDD skill](.claude/skills/tdd/SKILL.md)
- [Testing standards](docs/coding-standards-sections/testing.md)
- [Property and soak tests](docs/testing/property-tests-soak.md)
- [Playwright E2E](docs/testing/e2e-testing-playwright.md)

Fast BLOCK checklist:

- Red first: add or update the failing test, run it, and confirm a meaningful failure before implementation.
- Unit tests stay co-located; integration tests use `<package>/__tests__/`; doubles live in `<package>/__test-support__/` only.
- Unit tests avoid real FS, network, WebSocket, and Electron IPC; use in-memory repositories/providers or direct in-process calls.
- Browser APIs require `// @vitest-environment jsdom` as the first line.
- React tests use React Testing Library and cover loading, resolved, and interaction/dispatch paths relevant to the component.
- Simulation tests call reducers/pipelines directly and assert no input mutation; do not mock internal simulation modules.
- Cover every public method, documented error, and meaningful `validate()`/`reduce()` branch touched by the change.
