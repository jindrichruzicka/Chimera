// shared/perf-budget.test.ts
//
// Locks the §13 performance budgets to their single source of truth. These
// constants are imported by the engine tick/heap benchmark
// (games/tactics/__tests__/ActionPipelinePerf.bench.test.ts) and the renderer
// heap E2E (apps/tactics/e2e/tests/perf-renderer-heap.spec.ts), so a silent edit here would
// otherwise loosen a gate unnoticed — this test fails when a budget drifts.
//
// Source of truth: docs/coding-standards-sections/performance.md §13.1 (tick)
// and §13.4 (memory baseline).

import { describe, expect, it } from 'vitest';

import { MAIN_HEAP_BUDGET_MB, RENDERER_HEAP_BUDGET_MB, TICK_BUDGET_MS } from './perf-budget.js';

describe('perf-budget (§13 performance budgets)', () => {
    it('caps the ActionPipeline tick at 16 ms (§13.1)', () => {
        expect(TICK_BUDGET_MS).toBe(16);
    });

    it('caps the renderer heap at 32 MB (§13.4)', () => {
        expect(RENDERER_HEAP_BUDGET_MB).toBe(32);
    });

    it('caps the main-process heap at 32 MB (§13.4)', () => {
        expect(MAIN_HEAP_BUDGET_MB).toBe(32);
    });
});
