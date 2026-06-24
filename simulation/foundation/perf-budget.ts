// shared/perf-budget.ts
//
// Single source of truth for the §13 performance budgets. Lives in `shared/`
// because it is the only layer importable by all three consumers alike: the
// main-process micro-benchmark (electron/main), the renderer-heap E2E (apps/tactics/e2e/),
// and any renderer code — the renderer must not import `electron/`, and the
// benchmark must not live in `simulation/` (where `performance.now` is
// ESLint-banned, Invariant #43).
//
// Source of truth: docs/coding-standards-sections/performance.md
//   §13.1 — `ActionPipeline` must complete in ≤ 16 ms at 20 Hz.
//   §13.4 — main-process heap ≤ 32 MB and renderer heap ≤ 32 MB during a match.

/** §13.1 — per-tick `ActionPipeline.process()` budget, in milliseconds. */
export const TICK_BUDGET_MS = 16;

/** §13.4 — renderer heap ceiling during an active match, in megabytes. */
export const RENDERER_HEAP_BUDGET_MB = 32;

/** §13.4 — main-process heap ceiling during an active match, in megabytes. */
export const MAIN_HEAP_BUDGET_MB = 32;
