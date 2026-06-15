---
title: 'Chimera Coding Standards — §13 Performance'
description: 'Performance rules for the simulation hot path, IPC, renderer (R3F), and memory baseline targets for main process and renderer.'
tags: [performance, simulation, IPC, renderer, memory, useMemo, selectors, coding-standards]
---

# §13 Performance

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 13.1 Simulation hot path

- No per-tick allocations that can be hoisted out of the loop. Create objects once; reuse them.
- `ActionPipeline` must complete in ≤ 16 ms at 20 Hz on the target hardware baseline.

## 13.2 IPC

- Do not send a full `GameSnapshot` (or large serialised snapshot) over IPC on every tick. Send `PlayerSnapshot` diffs where possible.
- Synchronous blocking FS operations (`fs.readFileSync`, `fs.writeFileSync`) on the main process event loop are forbidden. Use `fs.promises` or atomic rename with `writeFileSync` only on a worker thread.

## 13.3 Renderer

- R3F geometry and materials must be created inside `useMemo` or at module scope — never inside the render function.
- `useAsset` must receive a stable `AssetRef` reference (not an object literal constructed inline each render). Inline object literals break referential equality and cause redundant asset re-fetches.
- Do not subscribe to the entire Zustand store. Use narrow selectors to limit re-renders.

## 13.4 Memory baseline (production target)

| Metric            | Target                      |
| ----------------- | --------------------------- |
| Main process heap | ≤ 32 MB during active match |
| Renderer heap     | ≤ 32 MB during active match |

## 13.5 Enforcement (F49)

The §13.1 and §13.4 budgets are constants in [`shared/perf-budget.ts`](../../shared/perf-budget.ts) (`TICK_BUDGET_MS`, `RENDERER_HEAP_BUDGET_MB`, `MAIN_HEAP_BUDGET_MB`) and are exercised by:

- **Main-process tick + heap** — [`electron/main/runtime/ActionPipelinePerf.bench.test.ts`](../../electron/main/runtime/ActionPipelinePerf.bench.test.ts) drives `ActionPipeline.process()` (the shared live + replay hot path, Invariants #42/#70) and a long-run heap-growth check. Run with `npm run test:perf` (sets `--expose-gc` so the main-heap leak gate activates). The benchmark must live under `electron/main/`, not `simulation/`, because `performance.now` is ESLint-banned in the simulation hot path (Invariant #43).
- **Renderer heap** — [`e2e/tests/perf-renderer-heap.spec.ts`](../../e2e/tests/perf-renderer-heap.spec.ts) (live match) and the replay-playback assertion in [`e2e/tests/replay.spec.ts`](../../e2e/tests/replay.spec.ts), both reading `performance.memory.usedJSHeapSize` the same way `perfStore.readHeapMb()` does.

Gating policy: assertions are **strict locally / under `CHIMERA_PERF_STRICT=1`** and **informational on CI** (CI runners are ~an order of magnitude slower); the measured numbers are always logged so the baseline is visible on every run.
