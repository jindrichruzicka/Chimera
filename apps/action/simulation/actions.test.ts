import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { createRng } from '@chimera-engine/simulation/engine/DeterministicRng.js';
import type {
    BaseGameSnapshot,
    EntityId,
    GameReduceContext,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_ARENA_MAX_X,
    ACTION_ARENA_MAX_Y,
    ACTION_ARENA_MIN_X,
    ACTION_ARENA_MIN_Y,
    ACTION_GAME_ID,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
} from './constants.js';
import {
    actionSelectPrimitiveDefinition,
    actionSetVelocityDefinition,
    advanceActionPrimitives,
    registerActionActions,
} from './actions.js';
import { buildInitialActionEntities } from './entities.js';
import { isActionPrimitiveEntity } from './entity-guards.js';
import type { ActionVelocityComponent } from './action-types.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const CUBE = entityId('primitive-cube');
const SPHERE = entityId('primitive-sphere');
const CONE = entityId('primitive-cone');
const GROUND = entityId('ground');

interface PrimitiveOverrides {
    readonly x?: number;
    readonly y?: number;
    readonly dx?: ActionVelocityComponent;
    readonly dy?: ActionVelocityComponent;
    readonly ownerId?: string | null;
}

function makeSnapshot(
    overrides: Readonly<Record<string, PrimitiveOverrides>> = {},
): BaseGameSnapshot {
    const entities = buildInitialActionEntities([P1, P2]);
    for (const [id, patch] of Object.entries(overrides)) {
        const existing = entities[id as EntityId];
        if (existing === undefined) throw new Error(`no seeded entity ${id}`);
        entities[id as EntityId] = { ...existing, ...patch };
    }
    return {
        tick: 1,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        timers: {},
        gameResult: null,
    };
}

function makeReduceContext(snapshot: BaseGameSnapshot): GameReduceContext {
    return { rng: createRng(snapshot.seed, snapshot.tick), dispatchDepth: 0 };
}

function primitive(
    snapshot: BaseGameSnapshot,
    id: EntityId,
): {
    readonly x: number;
    readonly y: number;
    readonly dx: number;
    readonly dy: number;
    readonly ownerId: string | null;
} {
    const entity = snapshot.entities[id];
    if (!isActionPrimitiveEntity(entity)) throw new Error(`no primitive ${id}`);
    return entity;
}

// ── Registration ─────────────────────────────────────────────────────────────

describe('registerActionActions', () => {
    it('registers both game actions under the game id', () => {
        const registry = new ActionRegistry();

        registerActionActions(registry);

        expect(registry.has(ACTION_SET_VELOCITY_ACTION)).toBe(true);
        expect(registry.has(ACTION_SELECT_PRIMITIVE_ACTION)).toBe(true);
    });

    it('registers the game definition with the seeded entity builder', () => {
        const registry = new ActionRegistry();

        registerActionActions(registry);

        const game = registry.resolveGame(ACTION_GAME_ID);
        // Registered under the game id the host resolves by: a definition filed
        // under any other key leaves `resolveGame` empty and the beat unreached.
        expect(game).toBeDefined();
        expect(game?.buildInitialEntities).toBe(buildInitialActionEntities);
        expect(game?.onBeat).toBe(advanceActionPrimitives);
    });

    it('resolves no game result while a match runs', () => {
        const registry = new ActionRegistry();

        registerActionActions(registry);

        const game = registry.resolveGame(ACTION_GAME_ID);
        expect(game?.resolveGameResult).toBeDefined();
        expect(game?.resolveGameResult?.(makeSnapshot())).toBeNull();
    });
});

// ── action:set-velocity ──────────────────────────────────────────────────────

describe('action:set-velocity', () => {
    it('is typed with its own action id', () => {
        expect(actionSetVelocityDefinition.type).toBe(ACTION_SET_VELOCITY_ACTION);
    });

    it('parses a legal payload and rejects an illegal one', () => {
        expect(actionSetVelocityDefinition.parsePayload({ dx: -1, dy: 1 })).toEqual({
            dx: -1,
            dy: 1,
        });
        expect(() => actionSetVelocityDefinition.parsePayload({ dx: 3, dy: 0 })).toThrow();
    });

    it('accepts a seat that owns a primitive', () => {
        const snapshot = makeSnapshot();

        expect(
            actionSetVelocityDefinition.validate(
                { dx: 1, dy: 0 },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: true });
    });

    it('rejects a seat that owns no primitive', () => {
        const snapshot = makeSnapshot({ 'primitive-cube': { ownerId: null } });

        expect(
            actionSetVelocityDefinition.validate(
                { dx: 1, dy: 0 },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'no_controlled_primitive' });
    });

    it('writes the velocity onto the acting seat’s primitive', () => {
        const snapshot = makeSnapshot();

        const next = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: -1, dy: 1 },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, CUBE).dx).toBe(-1);
        expect(primitive(next, CUBE).dy).toBe(1);
    });

    it('leaves another seat’s primitive untouched', () => {
        // The seat lookup must be by OWNER, not "the first primitive": a reducer
        // that ignored `playerId` would move the cube for both seats.
        const snapshot = makeSnapshot();

        const next = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 1, dy: 0 },
            P2,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, SPHERE).dx).toBe(1);
        expect(primitive(next, CUBE).dx).toBe(0);
    });

    it('moves nothing on its own — velocity is applied by the beat', () => {
        const snapshot = makeSnapshot();

        const next = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 1, dy: 1 },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, CUBE).x).toBe(primitive(snapshot, CUBE).x);
        expect(primitive(next, CUBE).y).toBe(primitive(snapshot, CUBE).y);
    });

    it('advances the tick by exactly one', () => {
        // Invariant #42. A reducer that changes the snapshot without advancing
        // the tick records an action `ReplayPlayer.step()` refuses to replay.
        //
        // Off the fixed point on purpose: `makeSnapshot` seeds tick 1, where
        // `+ 1` and `* 2` agree. Three tells them apart, and the expectation
        // is the literal rather than the formula, so it cannot be satisfied by
        // copying whatever the reducer does.
        const snapshot = { ...makeSnapshot(), tick: 3 };

        const next = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: -1, dy: 1 },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next.tick).toBe(4);
    });

    it('returns the SAME snapshot when the seat drives nothing', () => {
        // The total-reduce arm. `validate` already refuses this, so the arm is
        // reachable only from an engine path that reduced without validating —
        // and it must stay a true no-op: reference-identical, tick unadvanced.
        // An unconditional `tick: state.tick + 1` on the way out would break
        // both halves at once, so each is asserted.
        //
        // `action:select-primitive` has two arms of the same shape, each with
        // its own test below.
        const snapshot = makeSnapshot({ 'primitive-cube': { ownerId: null } });

        const next = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 1, dy: 0 },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next).toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick);
    });

    it('does not mutate the input snapshot', () => {
        // The whole snapshot, not just `entities`: a tick advance written as
        // `state.tick += 1` would leave the entity map untouched.
        const snapshot = makeSnapshot();
        const before = structuredClone(snapshot);

        actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 1, dy: -1 },
            P1,
            makeReduceContext(snapshot),
        );

        expect(snapshot).toEqual(before);
    });

    it('is not predictable — the host owns the realtime clock', () => {
        expect(actionSetVelocityDefinition.predictable).not.toBe(true);
    });
});

// ── action:select-primitive ──────────────────────────────────────────────────

describe('action:select-primitive', () => {
    it('is typed with its own action id', () => {
        expect(actionSelectPrimitiveDefinition.type).toBe(ACTION_SELECT_PRIMITIVE_ACTION);
    });

    it('parses a legal payload and rejects an illegal one', () => {
        expect(
            actionSelectPrimitiveDefinition.parsePayload({ entityId: 'primitive-cone' }),
        ).toEqual({ entityId: 'primitive-cone' });
        expect(() => actionSelectPrimitiveDefinition.parsePayload({ entityId: '' })).toThrow();
    });

    it('accepts an unclaimed primitive', () => {
        const snapshot = makeSnapshot();

        expect(
            actionSelectPrimitiveDefinition.validate(
                { entityId: 'primitive-cone' },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: true });
    });

    it('refuses re-selecting the primitive the seat already drives', () => {
        // A click on your own primitive changes nothing. Accepting it would let
        // the pipeline APPLY an action whose reduce returns the input reference
        // — see `HostSessionPipeline.processAction` for what an applied action
        // then meets, and the recording tests in
        // `__tests__/replay-determinism.test.ts`, which drive the gesture
        // through the real pipeline.
        const snapshot = makeSnapshot();

        expect(
            actionSelectPrimitiveDefinition.validate(
                { entityId: 'primitive-cube' },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'already_controlled' });
    });

    it('rejects an entity id no entity carries', () => {
        const snapshot = makeSnapshot();

        expect(
            actionSelectPrimitiveDefinition.validate(
                { entityId: 'primitive-torus' },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'unknown_entity' });
    });

    it('rejects the ground plane', () => {
        // Present in `entities`, so an existence-only check would let a seat
        // "drive" the floor.
        const snapshot = makeSnapshot();

        expect(
            actionSelectPrimitiveDefinition.validate(
                { entityId: 'ground' },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'not_a_primitive' });
    });

    it('rejects a primitive another seat already drives', () => {
        const snapshot = makeSnapshot();

        expect(
            actionSelectPrimitiveDefinition.validate(
                { entityId: 'primitive-sphere' },
                snapshot,
                P1,
                makeReduceContext(snapshot),
            ),
        ).toEqual({ ok: false, reason: 'primitive_taken' });
    });

    it('moves the seat onto the selected primitive', () => {
        const snapshot = makeSnapshot();

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, CONE).ownerId).toBe(P1);
    });

    it('releases the primitive the seat was driving, and stops it', () => {
        // A released primitive that kept its velocity would coast across the
        // arena with nobody driving it.
        const snapshot = makeSnapshot({ 'primitive-cube': { dx: 1, dy: -1 } });

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, CUBE).ownerId).toBeNull();
        expect(primitive(next, CUBE).dx).toBe(0);
        expect(primitive(next, CUBE).dy).toBe(0);
    });

    it('leaves the other seat’s primitive owned', () => {
        const snapshot = makeSnapshot();

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, SPHERE).ownerId).toBe(P2);
    });

    it('keeps the moving primitive’s velocity when a seat re-selects it', () => {
        // Re-selecting is a no-op, not a stop: the release arm must not fire on
        // the primitive being selected.
        const snapshot = makeSnapshot({ 'primitive-cube': { dx: 1, dy: 0 } });

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cube' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(primitive(next, CUBE).ownerId).toBe(P1);
        expect(primitive(next, CUBE).dx).toBe(1);
    });

    it('advances the tick by exactly one', () => {
        // Invariant #42, same rule — and the same off-the-fixed-point tick as
        // `action:set-velocity`, for the same reason.
        const snapshot = { ...makeSnapshot(), tick: 3 };

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next.tick).toBe(4);
    });

    it('does not mutate the input snapshot', () => {
        // The whole snapshot, not just `entities` — see the same guard on
        // `action:set-velocity`.
        const snapshot = makeSnapshot();
        const before = structuredClone(snapshot);

        actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(snapshot).toEqual(before);
    });

    it('leaves the ground plane in the record it rewrites', () => {
        const snapshot = makeSnapshot();

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next.entities[GROUND]).toStrictEqual(snapshot.entities[GROUND]);
    });

    it('returns the SAME snapshot when the target is not a primitive', () => {
        // The other total-reduce arm. `validate` refuses the ground plane with
        // `not_a_primitive`, so this is reachable only from an engine path that
        // reduced without validating — and like every no-op arm it must stay
        // reference-identical with the tick unadvanced.
        const snapshot = makeSnapshot();

        const next = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: GROUND },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next).toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick);
    });

    it('returns the SAME snapshot when a seat re-selects what it already drives', () => {
        // The fast path.
        const snapshot = makeSnapshot({ 'primitive-cube': { dx: 1, dy: 0 } });

        expect(
            actionSelectPrimitiveDefinition.reduce(
                snapshot,
                { entityId: 'primitive-cube' },
                P1,
                makeReduceContext(snapshot),
            ),
        ).toBe(snapshot);
    });
});

// ── The per-beat movement pass ───────────────────────────────────────────────

describe('advanceActionPrimitives', () => {
    const beatCtx = { rng: createRng(1, 1), dispatchDepth: 0 } satisfies GameReduceContext;

    it('advances a moving primitive by its velocity, one cell per axis per beat', () => {
        const snapshot = makeSnapshot({ 'primitive-cube': { x: 0, y: 0, dx: 1, dy: -1 } });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).x).toBe(1);
        expect(primitive(next, CUBE).y).toBe(-1);
    });

    it('advances every moving primitive in the same beat', () => {
        const snapshot = makeSnapshot({
            'primitive-cube': { x: 0, y: 0, dx: 1, dy: 0 },
            'primitive-sphere': { x: 0, y: 0, dx: 0, dy: 1 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).x).toBe(1);
        expect(primitive(next, SPHERE).y).toBe(1);
    });

    it('leaves a stationary primitive where it is', () => {
        const snapshot = makeSnapshot({ 'primitive-cube': { x: 2, y: 3 } });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).x).toBe(2);
        expect(primitive(next, CUBE).y).toBe(3);
    });

    it('returns the same snapshot reference when nothing is moving', () => {
        const snapshot = makeSnapshot();

        expect(advanceActionPrimitives(snapshot, beatCtx, [])).toBe(snapshot);
    });

    it('returns the same snapshot AND entity when a held velocity is fully clamped', () => {
        // The case the "nothing moved" fast path exists for, and the one that
        // actually recurs: a seat holding a key into the wall is MOVING — the
        // stationary check above short-circuits before the clamp and never
        // reaches this arm — so without the post-clamp comparison every beat of
        // the rest of the match allocates a fresh snapshot and a fresh entity
        // for a primitive that did not move.
        const snapshot = makeSnapshot({
            'primitive-cube': { x: ACTION_ARENA_MAX_X, y: ACTION_ARENA_MAX_Y, dx: 1, dy: 1 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(next).toBe(snapshot);
        expect(next.entities[CUBE]).toBe(snapshot.entities[CUBE]);
    });

    it('still rebuilds the snapshot when ONE of two primitives moves', () => {
        // The other side of the same fork: a fast path that keyed on "some
        // primitive was clamped" rather than "nothing moved at all" would drop
        // the seat that did move.
        const snapshot = makeSnapshot({
            'primitive-cube': { x: ACTION_ARENA_MAX_X, y: ACTION_ARENA_MAX_Y, dx: 1, dy: 1 },
            'primitive-sphere': { x: 0, y: 0, dx: 1, dy: 0 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(next).not.toBe(snapshot);
        expect(next.entities[CUBE]).toBe(snapshot.entities[CUBE]);
        expect(primitive(next, SPHERE).x).toBe(1);
    });

    it('holds a primitive ON each arena bound rather than pushing it past', () => {
        const snapshot = makeSnapshot({
            'primitive-cube': { x: ACTION_ARENA_MAX_X, y: ACTION_ARENA_MAX_Y, dx: 1, dy: 1 },
            'primitive-sphere': { x: ACTION_ARENA_MIN_X, y: ACTION_ARENA_MIN_Y, dx: -1, dy: -1 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).x).toBe(ACTION_ARENA_MAX_X);
        expect(primitive(next, CUBE).y).toBe(ACTION_ARENA_MAX_Y);
        expect(primitive(next, SPHERE).x).toBe(ACTION_ARENA_MIN_X);
        expect(primitive(next, SPHERE).y).toBe(ACTION_ARENA_MIN_Y);
    });

    it('keeps a clamped primitive moving on the axis that is still free', () => {
        // A clamp written as "if either axis is blocked, skip the primitive"
        // would pin the whole entity against one wall.
        const snapshot = makeSnapshot({
            'primitive-cube': { x: ACTION_ARENA_MAX_X, y: 0, dx: 1, dy: 1 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).x).toBe(ACTION_ARENA_MAX_X);
        expect(primitive(next, CUBE).y).toBe(1);
    });

    it('keeps the velocity while clamped, so leaving the wall needs no re-press', () => {
        const snapshot = makeSnapshot({
            'primitive-cube': { x: ACTION_ARENA_MAX_X, y: 0, dx: 1, dy: 0 },
        });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(primitive(next, CUBE).dx).toBe(1);
    });

    it('never leaves the arena over a long run of beats', () => {
        let snapshot = makeSnapshot({ 'primitive-cube': { x: 0, y: 0, dx: 1, dy: 1 } });

        for (let beat = 0; beat < 40; beat += 1) {
            snapshot = advanceActionPrimitives(snapshot, beatCtx, []);
            const cube = primitive(snapshot, CUBE);
            expect(cube.x).toBeLessThanOrEqual(ACTION_ARENA_MAX_X);
            expect(cube.y).toBeLessThanOrEqual(ACTION_ARENA_MAX_Y);
        }
    });

    it('does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot({ 'primitive-cube': { dx: 1, dy: 1 } });
        const before = structuredClone(snapshot.entities);

        advanceActionPrimitives(snapshot, beatCtx, []);

        expect(snapshot.entities).toEqual(before);
    });

    it('leaves the ground plane untouched', () => {
        const snapshot = makeSnapshot({ 'primitive-cube': { dx: 1, dy: 0 } });

        const next = advanceActionPrimitives(snapshot, beatCtx, []);

        expect(next.entities[GROUND]).toStrictEqual(snapshot.entities[GROUND]);
    });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('action simulation determinism', () => {
    const beatCtx = { rng: createRng(1, 1), dispatchDepth: 0 } satisfies GameReduceContext;

    /** Replays a fixed script of actions and beats from a fresh initial state. */
    function run(): BaseGameSnapshot {
        let snapshot = makeSnapshot();

        snapshot = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 1, dy: 0 },
            P1,
            makeReduceContext(snapshot),
        );
        snapshot = advanceActionPrimitives(snapshot, beatCtx, []);
        snapshot = advanceActionPrimitives(snapshot, beatCtx, []);
        snapshot = actionSelectPrimitiveDefinition.reduce(
            snapshot,
            { entityId: 'primitive-cone' },
            P1,
            makeReduceContext(snapshot),
        );
        snapshot = actionSetVelocityDefinition.reduce(
            snapshot,
            { dx: 0, dy: -1 },
            P1,
            makeReduceContext(snapshot),
        );
        snapshot = advanceActionPrimitives(snapshot, beatCtx, []);
        return snapshot;
    }

    it('produces identical state from identical actions', () => {
        expect(run().entities).toEqual(run().entities);
    });

    it('produces the state the script actually describes', () => {
        // A determinism check alone passes against a reducer that does nothing;
        // this pins the run's OUTCOME so "identical" means identical to this.
        const final = run();

        expect(primitive(final, CUBE)).toMatchObject({ x: -2, y: 0, dx: 0, dy: 0, ownerId: null });
        expect(primitive(final, CONE)).toMatchObject({ x: 4, y: -1, dx: 0, dy: -1, ownerId: P1 });
    });

    it('survives a JSON round trip, so a match can be saved and reloaded', () => {
        // Integer positions rather than a `FixedPoint` bigint are what make this
        // true, and BOTH directions matter: the engine's save serialiser is
        // `JsonSaveSerializer`, whose `JSON.stringify` throws on a bigint on the
        // way out and whose reviver could never produce one on the way back.
        const entities = run().entities;

        expect(() => JSON.stringify(entities)).not.toThrow();
        expect(JSON.parse(JSON.stringify(entities))).toEqual(entities);
    });
});
