// simulation/foundation/perf-budget.ts
//
// Single source of truth for the §13 performance budgets. Lives in the
// `simulation/foundation/` leaf because every consumer can import it from
// there — a benchmark under `apps/*/__tests__/`, an e2e spec, and renderer code
// alike, none of which may import each other's layer. The benchmarks
// themselves must not live in `simulation/`, where `performance.now` is
// ESLint-banned (Invariant #43).
//
// These budgets are TEST-ONLY. No runtime module reads any of them: they exist
// so a benchmark and an E2E have one number to gate against, and nothing in a
// shipped host or renderer changes behaviour when one moves. The names read
// like runtime configuration, so this is stated rather than left to be
// discovered by grepping for readers.
//
// Source of truth: docs/coding-standards-sections/performance.md
//   §13.1 — `ActionPipeline` must complete inside {@link TICK_BUDGET_DUTY} of
//           the game's declared tick period.
//   §13.4 — main-process heap ≤ 32 MB and renderer heap ≤ 32 MB during a match.

import { DEFAULT_TICK_RATE_MS } from './game-manifest-contract.js';

/**
 * §13.1 — the fraction of one tick period the `ActionPipeline` may spend.
 *
 * The engine's headroom policy, not a tuning knob: what the pipeline does not
 * spend is what remains for everything else a beat costs the host and for the
 * scheduling slack a wall-clock ticker needs to hold its period. How that
 * remainder divides is not apportioned here. Locked by `perf-budget.test.ts`
 * the way the heap budgets are, so moving it is a deliberate act.
 *
 * 0.32 is chosen so {@link TICK_BUDGET_MS} lands on 16 at the 50 ms default
 * period.
 */
export const TICK_BUDGET_DUTY = 0.32;

/**
 * §13.1 — per-tick `ActionPipeline.process()` budget for a game declaring
 * `tickRateMs`, in milliseconds.
 *
 * A budget is a fraction of the period it is measured against, because
 * `resolveTickerHz` accepts any finite positive period (100 Hz is pinned as
 * correct in `game-manifest-contract.test.ts`). Any fixed millisecond budget
 * exceeds the whole period of some legal game, and a budget larger than the
 * beat it bounds is a gate that cannot fail.
 *
 * `tickRateMs` is a HOST pacing value, so this never enters a snapshot and its
 * float result never reaches gameplay arithmetic (Invariants #2/#44).
 *
 * @param tickRateMs The game's declared heartbeat interval in milliseconds —
 *   `GameManifest.tickRateMs`, or {@link DEFAULT_TICK_RATE_MS} when unset.
 * @throws RangeError when `tickRateMs` is not a finite positive number, mirroring
 *   `resolveTickerHz`'s refusal of the same inputs: a budget derived from a
 *   period the host would refuse to tick is a number with no meaning.
 */
export function tickBudgetMsFor(tickRateMs: number): number {
    if (!Number.isFinite(tickRateMs) || tickRateMs <= 0) {
        throw new RangeError(
            `tickBudgetMsFor: tickRateMs must be a finite positive number; got ${String(tickRateMs)}.`,
        );
    }
    return tickRateMs * TICK_BUDGET_DUTY;
}

/**
 * §13.1 — the tick budget at the DEFAULT tick rate (20 Hz), in milliseconds.
 *
 * The convenience value for a caller with no rate of its own to pass;
 * {@link tickBudgetMsFor} is the source of truth.
 */
export const TICK_BUDGET_MS = tickBudgetMsFor(DEFAULT_TICK_RATE_MS);

/** §13.4 — renderer heap ceiling during an active match, in megabytes. */
export const RENDERER_HEAP_BUDGET_MB = 32;

/** §13.4 — main-process heap ceiling during an active match, in megabytes. */
export const MAIN_HEAP_BUDGET_MB = 32;
