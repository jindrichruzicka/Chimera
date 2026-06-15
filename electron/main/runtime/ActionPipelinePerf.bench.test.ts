// electron/main/runtime/ActionPipelinePerf.bench.test.ts
//
// Executable §13 performance baseline for the main-process hot path.
//
//   §13.1 — `ActionPipeline.process()` must complete in ≤ 16 ms at 20 Hz.
//   §13.4 — the main-process heap must not grow unbounded during a match.
//
// This file MUST live under `electron/main/` (not `simulation/`): `performance.now`
// is ESLint-banned in `simulation/**`/`ai/**` (Invariant #43). `electron/main`
// already times the pipeline this way (HostSessionPipeline.ts).
//
// The benchmark drives the SAME `ActionPipeline.process()` that the live
// `RealtimeTicker` and `ReplayPlayer` both call (Invariants #42/#70: replay
// advances by exactly one `process()` per recorded action), so the per-tick
// budget proven here covers live ticking AND replay playback.
//
// Gating policy (decided for F49): strict locally / under `CHIMERA_PERF_STRICT=1`,
// informational on CI (CI runners are ~an order of magnitude slower). The numbers
// are always logged so the baseline is visible on every run.

import { describe, expect, it } from 'vitest';

import { ActionPipeline } from '@chimera/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { registerTacticsActions } from '@chimera/games/tactics/actions.js';
import { buildInitialTacticsEntities } from '@chimera/games/tactics/entities.js';
import { withSeededStamina } from '@chimera/games/tactics/stamina.js';
import {
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/shared/tactics.js';
import { MAIN_HEAP_BUDGET_MB, TICK_BUDGET_MS } from '@chimera/shared/perf-budget.js';

// ─── Gating policy ──────────────────────────────────────────────────────────

/** Hard-assert locally or when explicitly opted in; informational on CI. */
const STRICT = process.env['CHIMERA_PERF_STRICT'] === '1' || process.env['CI'] === undefined;

function gate(actual: number, budget: number, label: string): void {
    if (STRICT) {
        expect(actual, label).toBeLessThan(budget);
    } else {
        if (actual >= budget) {
            console.warn(`[perf][CI-informational] ${label}: ${actual} ≥ budget ${budget}`);
        }
        expect.soft(actual, label).toBeLessThan(budget);
    }
}

// ─── Representative mid-match tactics fixture ───────────────────────────────

const SEATS: readonly PlayerId[] = [
    toPlayerId('p1'),
    toPlayerId('p2'),
    toPlayerId('p3'),
    toPlayerId('p4'),
];

/**
 * Effectively-unbounded per-seat stamina pool for the benchmark. The move_unit
 * run hammers one seat's unit ~12k times within a single turn — far past the
 * 3-per-turn cap (#721) — so we seed an ample budget to isolate the heaviest
 * reducer's cost from the stamina gate (which has its own unit tests). With no
 * `turnClock` there is no turn-start refresh; current simply never reaches 0
 * across the run. engine:tick/heap runs don't spend stamina, so this is inert
 * for them. Seeded via the tactics public API — no coupling to its internal
 * ledger shape.
 */
const BENCH_STAMINA = 1_000_000;

/** Build the heaviest realistic tactics board: the full 4-seat roster. */
function makeMidMatchSnapshot(): BaseGameSnapshot {
    const players = Object.fromEntries(SEATS.map((id) => [id, { id }]));
    const base: BaseGameSnapshot = {
        tick: 0,
        seed: 42,
        players,
        entities: buildInitialTacticsEntities(SEATS),
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 1,
        timers: {},
        gameResult: null,
    };
    return withSeededStamina(base, SEATS, BENCH_STAMINA);
}

function makePipeline(): ActionPipeline {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registerTacticsActions(registry);
    return new ActionPipeline(registry, { gameId: 'tactics' });
}

// ─── Measurement ────────────────────────────────────────────────────────────

interface Stats {
    readonly median: number;
    readonly p95: number;
    readonly max: number;
    readonly finalSnapshot: BaseGameSnapshot;
}

/**
 * Warm up (untimed) so V8 JITs `process()`/`reduce()`/`validate()` and the
 * snapshot reaches mid-match, then time `iterations` calls into a pre-allocated
 * buffer. `nextAction(snapshot, i)` returns an envelope stamped against the
 * current snapshot tick (Stage 1 requires `action.tick === snapshot.tick`).
 */
function measure(
    label: string,
    nextAction: (snapshot: BaseGameSnapshot, i: number) => ActionEnvelope,
    iterations: number,
): Stats {
    const pipeline = makePipeline();
    let snapshot = makeMidMatchSnapshot();

    // Warmup — also advances the snapshot into a representative steady state.
    const warmup = Math.min(2000, iterations);
    for (let i = 0; i < warmup; i += 1) {
        snapshot = pipeline.process(snapshot, nextAction(snapshot, i));
    }

    const samples = new Float64Array(iterations);
    for (let i = 0; i < iterations; i += 1) {
        const action = nextAction(snapshot, i);
        const start = performance.now();
        snapshot = pipeline.process(snapshot, action);
        samples[i] = performance.now() - start;
    }

    const sorted = Array.from(samples).sort((a, b) => a - b);
    const pick = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const stats: Stats = {
        median: pick(0.5),
        p95: pick(0.95),
        max: sorted[sorted.length - 1] ?? 0,
        finalSnapshot: snapshot,
    };

    console.log(
        `[perf] ${label}: median=${stats.median.toFixed(4)}ms p95=${stats.p95.toFixed(4)}ms ` +
            `max=${stats.max.toFixed(4)}ms (n=${iterations}, strict=${STRICT})`,
    );
    return stats;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

// We gate the p95, not the median: §13.1 requires every tick to finish within
// budget, so the tail is what matters. p95 ≥ median always, so this subsumes the
// central-tendency check while catching a regression that spikes the tail without
// moving the median. (max is left informational — a single GC/scheduler outlier
// must not fail the gate.) median/p95/max are all logged every run.
describe('ActionPipeline performance baseline (§13.1, ≤ 16 ms at 20 Hz)', () => {
    it('processes engine:tick — the always-on 20 Hz path — within the tick budget', () => {
        const stats = measure(
            'engine:tick',
            (snapshot) => ({
                type: 'engine:tick',
                playerId: SEATS[0]!,
                tick: snapshot.tick,
                payload: { seed: snapshot.seed },
            }),
            10_000,
        );
        gate(stats.p95, TICK_BUDGET_MS, 'engine:tick p95 tick duration');
    });

    it('processes tactics:move_unit — the heaviest reducer (proximity reveal) — within budget', () => {
        // Alternate unit-1 (owned by p1) between two cells so every call is a real move
        // that triggers revealNearbyOpponentUnits over the whole board.
        const stats = measure(
            'tactics:move_unit',
            (snapshot, i) => ({
                type: TACTICS_MOVE_UNIT_ACTION,
                playerId: SEATS[0]!,
                tick: snapshot.tick,
                payload: { unitId: TACTICS_DEFAULT_UNIT_ID_VALUE, x: i % 2, y: 0 },
            }),
            10_000,
        );
        gate(stats.p95, TICK_BUDGET_MS, 'tactics:move_unit p95 tick duration');
    });
});

describe('main-process heap baseline (§13.4, bounded growth during a match)', () => {
    it('does not grow the heap unbounded over a long tick run', () => {
        const gc = (globalThis as { gc?: () => void }).gc;
        const pipeline = makePipeline();
        let snapshot = makeMidMatchSnapshot();

        // Warm up + settle, then take the baseline AFTER a GC so transient JIT
        // allocations are not counted as growth.
        for (let i = 0; i < 2000; i += 1) {
            snapshot = pipeline.process(snapshot, {
                type: 'engine:tick',
                playerId: SEATS[0]!,
                tick: snapshot.tick,
                payload: { seed: snapshot.seed },
            });
        }
        gc?.();
        const baselineMb = process.memoryUsage().heapUsed / (1024 * 1024);

        for (let i = 0; i < 10_000; i += 1) {
            snapshot = pipeline.process(snapshot, {
                type: 'engine:tick',
                playerId: SEATS[0]!,
                tick: snapshot.tick,
                payload: { seed: snapshot.seed },
            });
        }
        gc?.();
        const afterMb = process.memoryUsage().heapUsed / (1024 * 1024);
        const deltaMb = afterMb - baselineMb;

        console.log(
            `[perf] main heap: baseline=${baselineMb.toFixed(1)}MB after=${afterMb.toFixed(1)}MB ` +
                `delta=${deltaMb.toFixed(1)}MB gc=${gc !== undefined} (absolute is informational; ` +
                `Vitest worker baseline is included)`,
        );

        // Leak gate: feeding nextState back drops old snapshots, so 10k ticks must
        // not add anywhere near a full heap budget. Only meaningful with --expose-gc
        // (npm run test:perf); skipped otherwise to avoid GC-sawtooth false positives.
        if (gc !== undefined) {
            gate(deltaMb, MAIN_HEAP_BUDGET_MB, 'main-process heap growth over 10k ticks');
        }
    });
});
