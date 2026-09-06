// apps/action/__tests__/ActionBeatPerf.bench.test.ts
//
// Executable §13.1 baseline for the SIMULATION leg of a realtime beat: one
// `ActionPipeline.process()`, which runs the engine's tick reduce and then the
// game's `onBeat` hook — here `advanceActionPrimitives`, the pass that moves a
// primitive.
//
// It is the simulation leg only. A live beat also pays the Stage-7 outbound
// wave, which is `OutboundPerBeatPerf.bench.test.ts`'s. Neither number is a
// whole beat on its own.
//
// The action app declares `tickRateMs: 100`, so the budget is
// `tickBudgetMsFor(ACTION_TICK_RATE_MS)` rather than the default-rate
// `TICK_BUDGET_MS` the tactics and outbound benches use.
//
// What this catches, stated plainly: the app's own roster is three primitives
// and a ground plane, and the hook is one pass of integer add and clamp, so the
// real-roster case has headroom no small regression could cross. The value is
// the HARNESS and the SCALED case beside it — a place for a realtime game with
// a real entity count to be measured before it ships. Every run logs
// median/p95/max against the budget, so the baseline is read off the log rather
// than written down here.
//
// It uses `performance.now`, ESLint-banned in the gameplay zones listed in
// `eslint.config.mjs` (Invariant #43) but permitted under `apps/*/__tests__/`.
// The gating policy and the measurement shape are the tactics and outbound
// benches', duplicated rather than shared.

import { describe, expect, it } from 'vitest';

import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseEntityState,
    BaseGameSnapshot,
    EntityId,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import { DEFAULT_TICK_RATE_MS } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import {
    TICK_BUDGET_MS,
    tickBudgetMsFor,
} from '@chimera-engine/simulation/foundation/perf-budget.js';

import { registerActionActions } from '../simulation/actions.js';
import type { ActionPrimitiveEntity, ActionVelocityComponent } from '../simulation/action-types.js';
import {
    ACTION_GAME_ID,
    ACTION_PRIMITIVE_SHAPES,
    ACTION_SET_VELOCITY_ACTION,
    ACTION_TICK_RATE_MS,
    clampToArenaX,
    clampToArenaY,
} from '../simulation/constants.js';
import { buildInitialActionEntities } from '../simulation/entities.js';
import { isActionPrimitiveEntity } from '../simulation/entity-guards.js';

// ─── Gating policy (duplicated from the tactics and outbound benches) ────────

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

/** The budget this app's declared heartbeat earns. */
const BEAT_BUDGET_MS = tickBudgetMsFor(ACTION_TICK_RATE_MS);

/** Width of the synthetic arena — the larger grid the outbound bench also drives. */
const SYNTHETIC_ENTITY_COUNT = 2_000;

const SYNTHETIC_LABEL = SYNTHETIC_ENTITY_COUNT.toString();

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SEATS: readonly PlayerId[] = [playerId('p1'), playerId('p2'), playerId('p3')];

/** Non-zero velocities, so no primitive sits on the hook's early-`continue`. */
const VELOCITIES: readonly (readonly [ActionVelocityComponent, ActionVelocityComponent])[] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

function reverse(v: ActionVelocityComponent): ActionVelocityComponent {
    if (v === 1) return -1;
    if (v === -1) return 1;
    return 0;
}

/** Mutates `entities` in place, so callers pass a copy they own. */
function setInMotion(
    entities: Record<EntityId, BaseEntityState>,
): Record<EntityId, BaseEntityState> {
    let index = 0;
    for (const [id, entity] of Object.entries(entities)) {
        if (!isActionPrimitiveEntity(entity)) continue;
        const velocity = VELOCITIES[index % VELOCITIES.length];
        if (velocity === undefined) throw new Error('unreachable: modulo of a non-empty tuple');
        const moving: ActionPrimitiveEntity = { ...entity, dx: velocity[0], dy: velocity[1] };
        entities[id as EntityId] = moving;
        index += 1;
    }
    return entities;
}

/**
 * The app's REAL arena — the three shipped primitive seeds plus the ground
 * plane — with every primitive under way.
 */
function makeRealArena(): Record<EntityId, BaseEntityState> {
    return setInMotion({ ...buildInitialActionEntities(SEATS) });
}

/**
 * SYNTHETIC: the real arena widened to `entityCount` entities with primitives
 * built on the shipped record's exact shape. No match this app can start has a
 * roster like this — `buildInitialActionEntities` refuses a fourth seat — so
 * this case exists to give the beat pass an entity count worth timing, not to
 * describe the game.
 */
function makeScaledArena(entityCount: number): Record<EntityId, BaseEntityState> {
    const entities = makeRealArena();
    let index = 0;
    while (Object.keys(entities).length < entityCount) {
        const id = entityId(`synth-${index.toString()}`);
        const shape = ACTION_PRIMITIVE_SHAPES[index % ACTION_PRIMITIVE_SHAPES.length];
        const velocity = VELOCITIES[index % VELOCITIES.length];
        if (shape === undefined || velocity === undefined) {
            throw new Error('unreachable: modulo of a non-empty tuple');
        }
        const primitive: ActionPrimitiveEntity = {
            id,
            kind: 'primitive',
            shape,
            x: (index % 17) - 8,
            y: (index % 11) - 5,
            dx: velocity[0],
            dy: velocity[1],
            ownerId: SEATS[index % SEATS.length] ?? null,
        };
        entities[id] = primitive;
        index += 1;
    }
    return entities;
}

function makeSnapshot(entities: Record<EntityId, BaseEntityState>): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 42,
        players: Object.fromEntries(SEATS.map((id) => [id, { id }])),
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: SEATS[0]!,
        timers: {},
        gameResult: null,
    };
}

function makePipeline(): ActionPipeline<BaseGameSnapshot> {
    const registry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(registry);
    registerActionActions(registry);
    return new ActionPipeline(registry, { gameId: ACTION_GAME_ID });
}

/** The heartbeat envelope, stamped off the live snapshot. */
function tickEnvelope(snapshot: BaseGameSnapshot): ActionEnvelope {
    return {
        type: 'engine:tick',
        playerId: SEATS[0]!,
        tick: snapshot.tick,
        payload: { seed: snapshot.seed },
    };
}

/**
 * UNTIMED: turn every primitive that has reached a wall around.
 *
 * The arena is 17 × 11 cells and the movement pass clamps, so a primitive
 * driven at a wall stops changing cell — and the hook's early-`continue` then
 * returns the input reference without building an entities copy. Left alone,
 * every beat after the first seventeen would measure that idle fast path
 * instead of the moving one. Bouncing between samples keeps every timed beat on
 * the arm that allocates.
 */
function bounce(snapshot: BaseGameSnapshot): BaseGameSnapshot {
    const entities: Record<EntityId, BaseEntityState> = { ...snapshot.entities };
    for (const entity of Object.values(snapshot.entities)) {
        if (!isActionPrimitiveEntity(entity)) continue;
        const dx =
            clampToArenaX(entity.x + entity.dx) === entity.x ? reverse(entity.dx) : entity.dx;
        const dy =
            clampToArenaY(entity.y + entity.dy) === entity.y ? reverse(entity.dy) : entity.dy;
        if (dx === entity.dx && dy === entity.dy) continue;
        const bounced: ActionPrimitiveEntity = { ...entity, dx, dy };
        entities[entity.id] = bounced;
    }
    return { ...snapshot, entities };
}

// ─── Measurement ─────────────────────────────────────────────────────────────

interface BeatStats {
    readonly median: number;
    readonly p95: number;
    readonly max: number;
}

/**
 * Sort `samples` ascending and reduce them to the three figures a measured case
 * logs, by nearest rank.
 *
 * The whole reduction lives here rather than inline in the measurement loop so
 * one test can pin it. The gate reads `p95` and the logged line is the baseline
 * a reader consults, so which figure each name carries has to be measurable —
 * a percentile picked at the call site would be unpinnable from outside.
 */
function summarise(samples: Iterable<number>): BeatStats {
    const sorted = Array.from(samples).sort((a, b) => a - b);
    const pick = (p: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    return { median: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

/**
 * One SAMPLE = one `pipeline.process()` of whatever `nextAction` builds, which
 * defaults to the heartbeat. Warm up untimed so V8 JITs the reduce, then time
 * `iterations` samples. The bounce between samples is untimed and never inside
 * the bracket.
 *
 * Every timed sample is asserted to have returned a NEW entities record — the
 * allocating arm of whichever reducer ran. A fixture drift that parked the
 * arena would otherwise leave this benchmarking an early-out while still
 * logging a number. It is a fixture guard, not a correctness check:
 * `actions.test.ts` owns what the reducers write.
 */
function measureBeat(
    label: string,
    entities: Record<EntityId, BaseEntityState>,
    iterations: number,
    nextAction: (snapshot: BaseGameSnapshot, i: number) => ActionEnvelope = tickEnvelope,
): BeatStats {
    const pipeline = makePipeline();
    let snapshot = makeSnapshot(entities);

    for (let i = 0; i < Math.min(500, iterations); i += 1) {
        snapshot = bounce(snapshot);
        snapshot = pipeline.process(snapshot, nextAction(snapshot, i));
    }

    const samples = new Float64Array(iterations);
    let movedBeats = 0;
    for (let i = 0; i < iterations; i += 1) {
        const before = bounce(snapshot);
        const action = nextAction(before, i);
        const start = performance.now();
        const after = pipeline.process(before, action);
        samples[i] = performance.now() - start;
        if (after.entities !== before.entities) movedBeats += 1;
        snapshot = after;
    }
    expect(movedBeats, `${label}: samples that rewrote the entities record`).toBe(iterations);

    const stats = summarise(samples);

    console.log(
        `[perf] beat ${label}: median=${stats.median.toFixed(4)}ms p95=${stats.p95.toFixed(4)}ms ` +
            `max=${stats.max.toFixed(4)}ms (n=${iterations.toString()}, entities=${Object.keys(
                entities,
            ).length.toString()}, budget=${BEAT_BUDGET_MS.toString()}ms, strict=${STRICT.toString()})`,
    );
    return stats;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// p95, not median: §13.1 is a per-beat requirement, so the tail is what matters.
// p95 ≥ median always, so gating the tail subsumes the central-tendency check;
// max stays informational, since one GC or scheduler outlier must not fail a gate.
describe('per-beat baseline (engine:tick + the game onBeat hook)', () => {
    it('reports the tail, not the middle', () => {
        // The gate reads `p95` and the logged line is the baseline a reader
        // consults, so a summary that quietly put the median under `p95` would
        // gate the middle against the budget and mislabel the log with nothing
        // red. 37 is coprime with 100, so this is 1…100 in scrambled order —
        // which also fails if the sort is dropped. Nearest-rank over n=100 puts
        // p95 at index 95 and the median at index 50.
        const scrambled = Array.from({ length: 100 }, (_, i) => ((i * 37) % 100) + 1);
        expect(new Set(scrambled).size).toBe(100);

        expect(summarise(scrambled)).toEqual({ median: 51, p95: 96, max: 100 });
        expect(summarise([])).toEqual({ median: 0, p95: 0, max: 0 });
    });

    it('derives its budget from the declared tick rate, not the default one', () => {
        // This app's period is a whole multiple of the engine default, so its
        // budget must be that multiple of the default-rate budget. Comparing
        // `BEAT_BUDGET_MS` against `tickBudgetMsFor(ACTION_TICK_RATE_MS)` would
        // be a tautology: a `tickBudgetMsFor` that ignored its argument and
        // returned the default-rate number would satisfy it and silently gate
        // this 100 ms beat against a 50 ms game's 16 ms.
        const periods = ACTION_TICK_RATE_MS / DEFAULT_TICK_RATE_MS;
        expect(periods).toBeGreaterThan(1);
        expect(BEAT_BUDGET_MS).toBe(TICK_BUDGET_MS * periods);
        expect(BEAT_BUDGET_MS).not.toBe(TICK_BUDGET_MS);
        expect(BEAT_BUDGET_MS).toBeLessThan(ACTION_TICK_RATE_MS);
    });

    it('fits the shipped 3-primitive arena inside the beat budget', () => {
        const stats = measureBeat('real roster', makeRealArena(), 5_000);
        gate(stats.p95, BEAT_BUDGET_MS, 'real roster p95 beat duration');
    });

    it('holds the synthetic width at 2000', () => {
        // Locked, the way `TICK_BUDGET_DUTY` is: the width is what gives the
        // synthetic arm its discriminating power, and every label below plus
        // §13.5 quotes this number. Asserting the built arena's size against
        // this same constant could not see it coarsened — both sides move
        // together — so the value itself is pinned here, and the labels are
        // built from it rather than typed out.
        expect(SYNTHETIC_ENTITY_COUNT).toBe(2000);
    });

    it(`fits a synthetic ${SYNTHETIC_LABEL}-entity arena inside the beat budget`, () => {
        // SYNTHETIC — see makeScaledArena. This is the arm a regression can
        // cross: the case above is four entities and would absorb one. The
        // width is the larger of the two grids the outbound bench drives, kept
        // well under budget on purpose — this file also runs inside
        // `pnpm -r test`, so it must hold on CI hardware slower than a dev
        // machine. Making the beat hook quadratic breaches the gate here.
        const arena = makeScaledArena(SYNTHETIC_ENTITY_COUNT);
        // The builder fills up to its argument, so this catches a builder that
        // stops short — the width itself is locked by the case above.
        expect(Object.keys(arena)).toHaveLength(SYNTHETIC_ENTITY_COUNT);
        const stats = measureBeat(`synthetic ${SYNTHETIC_LABEL}`, arena, 400);
        gate(stats.p95, BEAT_BUDGET_MS, `synthetic ${SYNTHETIC_LABEL}-entity p95 beat duration`);
    });

    it("processes the app's own reducer — a seat input — within the beat budget", () => {
        // A beat is not the only thing a realtime host pays inside a period:
        // seat inputs that arrived in it go through the same pipeline.
        // `action:set-velocity` scans for the acting seat's primitive and
        // rewrites the entities record, so it grows with the roster the way the
        // beat hook does. Measured on the synthetic arena, the wider of the two.
        const arena = makeScaledArena(SYNTHETIC_ENTITY_COUNT);
        const stats = measureBeat(
            `synthetic ${SYNTHETIC_LABEL} set-velocity`,
            arena,
            400,
            (snapshot, i) => ({
                type: ACTION_SET_VELOCITY_ACTION,
                playerId: SEATS[0]!,
                tick: snapshot.tick,
                payload: { dx: i % 2 === 0 ? 1 : -1, dy: 0 },
            }),
        );
        gate(
            stats.p95,
            BEAT_BUDGET_MS,
            `synthetic ${SYNTHETIC_LABEL}-entity p95 set-velocity duration`,
        );
    });
});
