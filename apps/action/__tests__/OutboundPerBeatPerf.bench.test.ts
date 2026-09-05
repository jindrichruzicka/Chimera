// apps/action/__tests__/OutboundPerBeatPerf.bench.test.ts
//
// Executable baseline for the host's per-beat OUTBOUND work — what a realtime
// game pays on every eventful beat for every seated viewer, and the number the
// simulation-layer standards (§7.5) quote for a game author to design against.
//
// The measured leg is what Stage 7 does per viewer in a shipped host:
// `StateProjector.project()` (`StateBroadcaster.broadcast`), then one
// `JSON.stringify` of the projection and a `crc32` over the body
// (`WsHostTransport.sendSnapshot`). Nothing here touches a socket, so it is the
// CPU floor of a broadcast wave, not its wall-clock cost on the wire.
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
 */
function makeArena(entityCount: number, viewers: readonly PlayerId[]): BaseGameSnapshot {
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
        if (shape === undefined || dx === undefined || dy === undefined) {
            throw new Error('unreachable: modulo of a non-empty tuple');
        }
        const primitive: ActionPrimitiveEntity = {
            id,
            kind: 'primitive',
            shape,
            x: (index % 17) - 8,
            y: (index % 11) - 5,
            dx,
            dy,
            ownerId: viewers[index % viewers.length] ?? null,
        };
        entities[id] = primitive;
        index += 1;
    }
    const host = viewers[0];
    return {
        tick: 1,
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
    const stats: WaveStats = { median: pick(0.5), p95: pick(0.95), bytesPerViewer };
    console.log(
        `[perf] outbound wave ${entityCount.toString()} entities × ${viewerCount.toString()} viewers: ` +
            `median=${stats.median.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms ` +
            `body=${bytesPerViewer.toString()}B/viewer (n=${iterations.toString()}, strict=${STRICT.toString()})`,
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
