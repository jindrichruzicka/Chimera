// simulation/foundation/perf-budget.test.ts
//
// Locks the §13 performance budgets to their single source of truth. Benchmarks
// and e2e specs gate against these values, so a silent edit here would otherwise
// loosen a gate unnoticed — this test fails when a budget drifts.
//
// Source of truth: docs/coding-standards-sections/performance.md §13.1 (tick)
// and §13.4 (memory baseline).

import { describe, expect, it } from 'vitest';

import { DEFAULT_TICK_RATE_MS } from './game-manifest-contract.js';
import {
    MAIN_HEAP_BUDGET_MB,
    RENDERER_HEAP_BUDGET_MB,
    TICK_BUDGET_DUTY,
    TICK_BUDGET_MS,
    tickBudgetMsFor,
} from './perf-budget.js';

describe('perf-budget (§13 performance budgets)', () => {
    it('caps the ActionPipeline tick at 16 ms at the default tick rate (§13.1)', () => {
        expect(TICK_BUDGET_MS).toBe(16);
    });

    it('caps the renderer heap at 32 MB (§13.4)', () => {
        expect(RENDERER_HEAP_BUDGET_MB).toBe(32);
    });

    it('caps the main-process heap at 32 MB (§13.4)', () => {
        expect(MAIN_HEAP_BUDGET_MB).toBe(32);
    });
});

describe('TICK_BUDGET_DUTY (the locked duty fraction)', () => {
    // The duty is the engine's headroom policy, so changing it is a deliberate
    // act with a failing test to acknowledge, not a tuning knob a regression
    // can turn.
    it('spends 32% of a tick period on the pipeline', () => {
        expect(TICK_BUDGET_DUTY).toBe(0.32);
    });

    it('leaves the majority of every period to the rest of the beat', () => {
        expect(TICK_BUDGET_DUTY).toBeGreaterThan(0);
        expect(TICK_BUDGET_DUTY).toBeLessThan(0.5);
    });
});

describe('tickBudgetMsFor', () => {
    it('reproduces TICK_BUDGET_MS exactly at the default tick rate', () => {
        expect(DEFAULT_TICK_RATE_MS).toBe(50);
        expect(tickBudgetMsFor(DEFAULT_TICK_RATE_MS)).toBe(TICK_BUDGET_MS);
        expect(tickBudgetMsFor(50)).toBe(16);
    });

    it('scales with the declared period — a slower beat earns more, a faster one less', () => {
        expect(tickBudgetMsFor(100)).toBe(32);
        expect(tickBudgetMsFor(10)).toBe(3.2);
    });

    it('accepts a fractional period, as resolveTickerHz does', () => {
        // `GameManifest.tickRateMs` is `number` and `resolveTickerHz` requires
        // only finite and positive, so a 60 Hz game declares 1000/60 — a legal
        // period no integer-only guard would admit.
        const sixtyHzPeriod = 1000 / 60;
        expect(() => tickBudgetMsFor(sixtyHzPeriod)).not.toThrow();
        expect(tickBudgetMsFor(sixtyHzPeriod)).toBe(sixtyHzPeriod * TICK_BUDGET_DUTY);
        expect(Number.isInteger(sixtyHzPeriod)).toBe(false);
    });

    it('never returns a budget a beat could not fit', () => {
        // A budget at or above the period is a gate that cannot fail. Every
        // derived budget is strictly inside the period it came from.
        for (const tickRateMs of [1, 5, 10, 16, 20, 25, 50, 100, 250, 1000]) {
            expect(tickBudgetMsFor(tickRateMs)).toBeLessThan(tickRateMs);
            expect(tickBudgetMsFor(tickRateMs)).toBeGreaterThan(0);
        }
    });

    it('is strictly monotonic in the declared period', () => {
        expect(tickBudgetMsFor(10)).toBeLessThan(tickBudgetMsFor(50));
        expect(tickBudgetMsFor(50)).toBeLessThan(tickBudgetMsFor(100));
    });

    it('throws a RangeError on a non-finite or non-positive period', () => {
        expect(() => tickBudgetMsFor(0)).toThrow(RangeError);
        expect(() => tickBudgetMsFor(-5)).toThrow(RangeError);
        expect(() => tickBudgetMsFor(Number.NaN)).toThrow(RangeError);
        expect(() => tickBudgetMsFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
});
