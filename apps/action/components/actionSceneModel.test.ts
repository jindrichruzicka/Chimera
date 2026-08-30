import { describe, expect, it } from 'vitest';
import { entityId, playerId } from '@chimera-engine/simulation/engine/types.js';
import type { ObservedEntityState } from '@chimera-engine/simulation/projection/types.js';
import type { EntityId } from '@chimera-engine/simulation/engine/types.js';

import { ACTION_ARENA_DEPTH_CELLS, ACTION_ARENA_WIDTH_CELLS } from '../simulation/constants.js';
import { ACTION_PRIMITIVE_HEIGHT, arenaToWorld, parseActionScene } from './actionSceneModel.js';

const P1 = playerId('player-1');

type Entities = Readonly<Record<EntityId, ObservedEntityState>>;

function entities(...records: readonly Record<string, unknown>[]): Entities {
    return Object.fromEntries(records.map((record) => [record['id'], record])) as Entities;
}

const cube = {
    id: entityId('primitive-cube'),
    kind: 'primitive',
    shape: 'cube',
    x: -2,
    y: 3,
    dx: 1,
    dy: 0,
    ownerId: P1,
};

const sphere = {
    id: entityId('primitive-sphere'),
    kind: 'primitive',
    shape: 'sphere',
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    ownerId: null,
};

const ground = {
    id: entityId('ground'),
    kind: 'ground',
    widthCells: ACTION_ARENA_WIDTH_CELLS,
    depthCells: ACTION_ARENA_DEPTH_CELLS,
};

describe('arenaToWorld', () => {
    it('maps an arena cell onto the world XZ plane at the given height', () => {
        // Arena y maps STRAIGHT onto world z — the top-down camera's screen-up
        // is world -z, which is why `game:move-up` is `dy: -1`.
        expect(arenaToWorld({ x: -2, y: 3 }, 0.5)).toEqual([-2, 0.5, 3]);
    });

    it('keeps the two axes distinct', () => {
        // An x/z swap is invisible against a symmetric fixture.
        expect(arenaToWorld({ x: 1, y: 4 }, 0)).toEqual([1, 0, 4]);
    });

    it('puts the arena origin at the world origin', () => {
        expect(arenaToWorld({ x: 0, y: 0 }, 0)).toEqual([0, 0, 0]);
    });
});

describe('parseActionScene', () => {
    it('projects every primitive with its shape, cell and world position', () => {
        const scene = parseActionScene(entities(cube, sphere, ground));

        expect(scene.primitives).toHaveLength(2);
        const first = scene.primitives[0];
        expect(first).toMatchObject({
            id: 'primitive-cube',
            shape: 'cube',
            grid: { x: -2, y: 3 },
            ownerId: P1,
        });
        expect(first?.world).toEqual(arenaToWorld({ x: -2, y: 3 }, ACTION_PRIMITIVE_HEIGHT));
    });

    it('orders primitives by id, so the render order does not follow record order', () => {
        const forwards = parseActionScene(entities(cube, sphere));
        const backwards = parseActionScene(entities(sphere, cube));

        expect(forwards.primitives.map((p) => p.id)).toEqual(backwards.primitives.map((p) => p.id));
        expect(forwards.primitives.map((p) => p.id)).toEqual([
            'primitive-cube',
            'primitive-sphere',
        ]);
    });

    it('keeps an unclaimed primitive, with a null owner', () => {
        const scene = parseActionScene(entities(sphere));

        expect(scene.primitives[0]?.ownerId).toBeNull();
    });

    it('projects the ground plane sized from the entity, not from the constants', () => {
        // The entity is the source of truth on the renderer side: a screen that
        // re-derived the size would stop following a resized arena in a save.
        const scene = parseActionScene(entities({ ...ground, widthCells: 5, depthCells: 3 }));

        expect(scene.ground).toEqual({ widthCells: 5, depthCells: 3 });
    });

    it('reports no ground when the snapshot carries none', () => {
        const scene = parseActionScene(entities(cube));

        expect(scene.ground).toBeNull();
    });

    it('drops an entity whose fields do not match the kind it claims', () => {
        // A malformed record from a hand-edited save must not reach the scene as
        // a primitive at NaN.
        const scene = parseActionScene(
            entities({ ...cube, x: 'over-there' }, { ...sphere, dx: 4 }),
        );

        expect(scene.primitives).toEqual([]);
    });

    it('drops an entity of an unknown kind', () => {
        const scene = parseActionScene(entities({ id: 'marker-1', kind: 'marker' }));

        expect(scene.primitives).toEqual([]);
        expect(scene.ground).toBeNull();
    });

    it('projects an empty record as an empty scene', () => {
        const scene = parseActionScene(entities());

        expect(scene.primitives).toEqual([]);
        expect(scene.ground).toBeNull();
    });

    it('names the primitive the given viewer drives', () => {
        const scene = parseActionScene(entities(cube, sphere));

        expect(scene.primitives.find((p) => p.ownerId === P1)?.id).toBe('primitive-cube');
    });
});
