// apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts
//
// Executable baseline for the host's per-beat OUTBOUND work — what a realtime
// game pays on every eventful beat for every seated viewer, and the number the
// simulation-layer standards (§7.5) quote for a game author to design against.
//
// The measured leg is `StateProjector.project()` per viewer, then one
// `JSON.stringify` of the projection and a `crc32` over the body. Nothing here
// touches a socket, so it is a CPU floor, not a wall-clock cost on the wire.
//
// The DELTA arm is measured beside it, and is what `StateBroadcaster` does on
// a beat between keyframes: project per viewer, diff against the projection
// that viewer was last sent, then serialise and `crc32` the DELTA rather than
// the projection. Both arms are logged so the saving is a measurement rather
// than a claim; only the whole-snapshot arm is gated, because it is the one a
// game author designs against and the one that bounds the worst beat.
//
// How much of the arena moved is the axis the delta arm lives on, so it is run
// at both ends of it and each run says which end it was.
//
// This app's shipped visibility rules are the identity. Entities beyond the
// app's three seeded primitives are synthesised on the primitive record's exact
// shape so the byte width per entity is the real one.
//
// It mirrors `apps/tactics/__tests__/ActionPipelinePerf.bench.test.ts` for the
// same reasons that one gives: `performance.now` is ESLint-banned in `simulation/**` (Invariant
// #43) but permitted under `apps/*/__tests__/`, and the numbers are logged on
// every run so the baseline is visible wherever the suite runs.
//
// Two grids, treated differently on purpose. 500 × 4 is the grid a game is asked
// to design against and is gated against the tick budget. 2000 × 8 is LOGGED
// ONLY: its case compares nothing against the budget.

import { describe, expect, it } from 'vitest';

import type {
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import { crc32 } from '@chimera-engine/simulation/foundation/crc32.js';
import { diffSnapshots } from '@chimera-engine/simulation/foundation/snapshot-diff.js';
import { toSnapshotDelta } from '@chimera-engine/simulation/foundation/snapshot-delta.js';
import { TICK_BUDGET_MS } from '@chimera-engine/simulation/foundation/perf-budget.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';

import type { ActionPrimitiveEntity, ActionVelocityComponent } from '../simulation/action-types.js';
import { ACTION_PRIMITIVE_SHAPES } from '../simulation/constants.js';
import { buildInitialActionEntities } from '../simulation/entities.js';
import { actionVisibilityRules } from '../simulation/visibility-rules.js';

// ─── Gating policy (duplicated from the tactics bench) ────────────────────────

const STRICT = process.env['CHIMERA_PERF_STRICT'] === '1' || process.env['CI'] === undefined;

/** Hard-assert locally or when explicitly opted in; on CI the failure is deferred to the end of the case. */
function gate(actual: number, budget: number, label: string): void {
    if (STRICT) {
        expect(actual, label).toBeLessThan(budget);
    } else {
        if (actual >= budget) {
            console.warn(`[perf][CI] ${label}: ${actual} ≥ budget ${budget}`);
        }
        expect.soft(actual, label).toBeLessThan(budget);
    }
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

/** The grids the standards quote: (entities, viewers, gated against the budget). */
const GRIDS: readonly (readonly [number, number, boolean])[] = [
    [500, 4, true],
    [2000, 8, false],
];

function seats(count: number): readonly PlayerId[] {
    return Array.from({ length: count }, (_, i) => playerId(`seat-${i.toString()}`));
}

/**
 * The app's real initial arena, then primitives on the same record shape until
 * `entityCount` entities exist. Positions vary so the JSON is not a run of
 * identical bytes.
 *
 * `shift` moves the first `movedCount` synthesised primitives by one cell, so
 * two arenas built a shift apart differ in exactly that many entities — the
 * eventful beat both arms are measured on, at whatever motion the caller asks
 * for.
 */
function makeArena(
    entityCount: number,
    viewers: readonly PlayerId[],
    shift = 0,
    movedCount = Number.POSITIVE_INFINITY,
): BaseGameSnapshot {
    const entities: Record<EntityId, BaseEntityState> = {
        ...buildInitialActionEntities(viewers.slice(0, 3)),
    };
    const velocities: readonly ActionVelocityComponent[] = [-1, 0, 1];
    let index = 0;
    while (Object.keys(entities).length < entityCount) {
        const id = entityId(`synth-${index.toString()}`);
        const shape = ACTION_PRIMITIVE_SHAPES[index % ACTION_PRIMITIVE_SHAPES.length];
        const dx = velocities[index % velocities.length];
        const dy = velocities[(index + 1) % velocities.length];
        const moved = index < movedCount ? shift : 0;
        if (shape === undefined || dx === undefined || dy === undefined) {
            throw new Error('unreachable: modulo of a non-empty tuple');
        }
        const primitive: ActionPrimitiveEntity = {
            id,
            kind: 'primitive',
            shape,
            x: ((index + moved) % 17) - 8,
            y: ((index + moved) % 11) - 5,
            dx,
            dy,
            ownerId: viewers[index % viewers.length] ?? null,
        };
        entities[id] = primitive;
        index += 1;
    }
    const host = viewers[0];
    return {
        tick: 1 + shift,
        seed: 42,
        players: Object.fromEntries(viewers.map((id) => [id, { id }])),
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        ...(host === undefined ? {} : { hostPlayerId: host }),
        timers: {},
        gameResult: null,
    };
}

// ─── Measurement ──────────────────────────────────────────────────────────────

interface WaveStats {
    readonly median: number;
    readonly p95: number;
    readonly bytesPerViewer: number;
    /**
     * Entities that actually differ between the two arenas — counted, not
     * requested. The shift reaches only the synthesised primitives, so what the
     * arena is seeded with stays where it was and a request of "all of them"
     * measures fewer.
     */
    readonly movedEntities: number;
}

/**
 * One WAVE = project + stringify + crc32 for every viewer, which is what Stage 7
 * costs the host per eventful beat. Warm up untimed, then time `iterations`
 * waves.
 */
function measureWave(entityCount: number, viewerCount: number, iterations: number): WaveStats {
    const viewers = seats(viewerCount);
    const snapshot = makeArena(entityCount, viewers);
    // The grid label is what the standards table quotes; pin that the arena is
    // actually that wide, or a fixture change would silently relabel a row.
    expect(Object.keys(snapshot.entities)).toHaveLength(entityCount);
    const projector = new DefaultStateProjector(actionVisibilityRules);
    let sink = 0;
    let bytesPerViewer = 0;

    const wave = (): void => {
        for (const viewerId of viewers) {
            const body = JSON.stringify(projector.project(snapshot, viewerId));
            bytesPerViewer = body.length;
            sink ^= crc32(body);
        }
    };

    for (let i = 0; i < Math.min(100, iterations); i += 1) wave();

    const samples = new Float64Array(iterations);
    for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        wave();
        samples[i] = performance.now() - start;
    }
    expect(Number.isFinite(sink)).toBe(true);

    const sorted = Array.from(samples).sort((a, b) => a - b);
    const pick = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const stats: WaveStats = {
        median: pick(0.5),
        p95: pick(0.95),
        bytesPerViewer,
        movedEntities: 0,
    };
    console.log(
        `[perf] outbound wave ${entityCount.toString()} entities × ${viewerCount.toString()} viewers: ` +
            `median=${stats.median.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms ` +
            `body=${bytesPerViewer.toString()}B/viewer (n=${iterations.toString()}, strict=${STRICT.toString()})`,
    );
    return stats;
}

/**
 * One WAVE on the delta arm = project + diff against what that viewer was last
 * sent + stringify + crc32 of the DELTA, for every viewer. What
 * `StateBroadcaster` does on a beat between keyframes.
 *
 * `movedCount` is how many entities differ between the two arenas — the axis
 * the delta path lives or dies on, and the reason both ends of it are measured.
 */
function measureDeltaWave(
    entityCount: number,
    viewerCount: number,
    iterations: number,
    movedCount: number,
): WaveStats {
    const viewers = seats(viewerCount);
    const before = makeArena(entityCount, viewers, 0, movedCount);
    const after = makeArena(entityCount, viewers, 1, movedCount);
    expect(Object.keys(after.entities)).toHaveLength(entityCount);
    const projector = new DefaultStateProjector(actionVisibilityRules);
    // The baselines the host holds: what each viewer was last SENT.
    const baselines = new Map(viewers.map((id) => [id, projector.project(before, id)]));
    let sink = 0;
    let bytesPerViewer = 0;

    const wave = (): void => {
        for (const viewerId of viewers) {
            const projection = projector.project(after, viewerId);
            const baseline = baselines.get(viewerId);
            if (baseline === undefined) throw new Error('unreachable: baseline seeded per viewer');
            const body = JSON.stringify(toSnapshotDelta(diffSnapshots(baseline, projection)));
            bytesPerViewer = body.length;
            sink ^= crc32(body);
        }
    };

    for (let i = 0; i < Math.min(100, iterations); i += 1) wave();

    const samples = new Float64Array(iterations);
    for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        wave();
        samples[i] = performance.now() - start;
    }
    expect(Number.isFinite(sink)).toBe(true);

    const sorted = Array.from(samples).sort((a, b) => a - b);
    const pick = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const movedEntities = Object.keys(after.entities).filter(
        (id) =>
            JSON.stringify(after.entities[id as EntityId]) !==
            JSON.stringify(before.entities[id as EntityId]),
    ).length;
    const stats: WaveStats = { median: pick(0.5), p95: pick(0.95), bytesPerViewer, movedEntities };
    console.log(
        `[perf] outbound DELTA wave ${entityCount.toString()} entities × ${viewerCount.toString()} viewers: ` +
            `median=${stats.median.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms ` +
            `body=${bytesPerViewer.toString()}B/viewer (n=${iterations.toString()}, ` +
            `moved=${movedEntities.toString()}/${entityCount.toString()})`,
    );
    return stats;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('per-beat outbound baseline (project + stringify + crc32 per viewer)', () => {
    for (const [entityCount, viewerCount, gated] of GRIDS) {
        const label = `outbound wave p95 at ${entityCount.toString()}×${viewerCount.toString()}`;
        if (gated) {
            it(`fits a ${entityCount.toString()} × ${viewerCount.toString()} wave inside the tick budget`, () => {
                gate(measureWave(entityCount, viewerCount, 200).p95, TICK_BUDGET_MS, label);
            });
        } else {
            it(`logs a ${entityCount.toString()} × ${viewerCount.toString()} wave and compares it against nothing`, () => {
                // No budget in this arm: the number is for the standards table,
                // and a breach here must not be able to fail the suite.
                expect(Number.isFinite(measureWave(entityCount, viewerCount, 200).p95)).toBe(true);
            });
        }
    }
});

describe('per-beat outbound with deltas (project + diff + stringify + crc32 of the delta)', () => {
    for (const [entityCount, viewerCount] of GRIDS) {
        it(`logs the delta arm at both ends of the motion axis at ${entityCount.toString()} × ${viewerCount.toString()}`, () => {
            const whole = measureWave(entityCount, viewerCount, 200);
            const ratio = (part: number, of: number): string =>
                of === 0 ? 'n/a' : `${((100 * part) / of).toFixed(1)}%`;
            // A twentieth of the arena moving is a realtime beat; asking for
            // all of it is the worst a delta can be handed, and the case
            // `StateBroadcaster`'s size fallback exists for. Each run reports
            // the count `measureDeltaWave` counted.
            for (const movedCount of [Math.max(1, Math.round(entityCount / 20)), entityCount]) {
                const delta = measureDeltaWave(entityCount, viewerCount, 200, movedCount);
                console.log(
                    `[perf] delta vs whole at ${entityCount.toString()}×${viewerCount.toString()} ` +
                        `(${delta.movedEntities.toString()}/${entityCount.toString()} moved): ` +
                        `bytes ${ratio(delta.bytesPerViewer, whole.bytesPerViewer)} ` +
                        `(${delta.bytesPerViewer.toString()}B vs ${whole.bytesPerViewer.toString()}B/viewer), ` +
                        `p95 ${ratio(delta.p95, whole.p95)} ` +
                        `(${delta.p95.toFixed(3)}ms vs ${whole.p95.toFixed(3)}ms)`,
                );
                expect(Number.isFinite(delta.p95)).toBe(true);
                expect(delta.bytesPerViewer).toBeGreaterThan(0);
            }
            // Logged, not gated. Timings move with the machine, so a ratio
            // asserted here would gate the runner rather than the code; the
            // recorded numbers live in §7.5 beside the grid they were taken at.
        });
    }
});
