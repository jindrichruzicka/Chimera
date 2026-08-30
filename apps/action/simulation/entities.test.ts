import { describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import type { EntityId } from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_ARENA_DEPTH_CELLS,
    ACTION_ARENA_WIDTH_CELLS,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_GROUND_ENTITY_ID_VALUE,
    ACTION_PRIMITIVE_SEEDS,
} from './constants.js';
import { buildInitialActionEntities } from './entities.js';
import { isActionGroundEntity, isActionPrimitiveEntity } from './entity-guards.js';

const alice = playerId('alice');
const bob = playerId('bob');
const carol = playerId('carol');
const dave = playerId('dave');

describe('buildInitialActionEntities', () => {
    it('seeds three primitives plus one ground plane', () => {
        const entities = buildInitialActionEntities([alice]);

        const kinds = Object.values(entities).map((entity) =>
            isActionPrimitiveEntity(entity)
                ? 'primitive'
                : isActionGroundEntity(entity)
                  ? 'ground'
                  : 'unrecognised',
        );
        expect(kinds.filter((kind) => kind === 'primitive')).toHaveLength(3);
        expect(kinds.filter((kind) => kind === 'ground')).toHaveLength(1);
        expect(Object.keys(entities)).toHaveLength(4);
    });

    it('seeds one primitive per declared shape at its declared cell, stationary', () => {
        const entities = buildInitialActionEntities([]);

        for (const seed of ACTION_PRIMITIVE_SEEDS) {
            const entity = entities[seed.id as EntityId];
            expect(isActionPrimitiveEntity(entity), seed.id).toBe(true);
            if (!isActionPrimitiveEntity(entity)) throw new Error('unreachable');
            expect(entity.shape).toBe(seed.shape);
            expect(entity.x).toBe(seed.x);
            expect(entity.y).toBe(seed.y);
            expect(entity.dx).toBe(0);
            expect(entity.dy).toBe(0);
        }
    });

    it('sizes the ground plane from the arena extents', () => {
        const entities = buildInitialActionEntities([]);

        const ground = entities[ACTION_GROUND_ENTITY_ID_VALUE as keyof typeof entities];
        expect(isActionGroundEntity(ground)).toBe(true);
        if (!isActionGroundEntity(ground)) throw new Error('unreachable');
        expect(ground.widthCells).toBe(ACTION_ARENA_WIDTH_CELLS);
        expect(ground.depthCells).toBe(ACTION_ARENA_DEPTH_CELLS);
        // The two extents differ, so a width/depth swap is observable here.
        expect(ground.widthCells).not.toBe(ground.depthCells);
    });

    it('gives seat N the Nth primitive and leaves the rest unclaimed', () => {
        const entities = buildInitialActionEntities([alice, bob]);

        const owners = ACTION_PRIMITIVE_SEEDS.map((seed) => {
            const entity = entities[seed.id as keyof typeof entities];
            if (!isActionPrimitiveEntity(entity)) throw new Error(`missing primitive ${seed.id}`);
            return entity.ownerId;
        });
        expect(owners).toEqual([alice, bob, null]);
    });

    it('leaves every primitive unclaimed for an empty roster', () => {
        const entities = buildInitialActionEntities([]);

        for (const seed of ACTION_PRIMITIVE_SEEDS) {
            const entity = entities[seed.id as keyof typeof entities];
            if (!isActionPrimitiveEntity(entity)) throw new Error(`missing primitive ${seed.id}`);
            expect(entity.ownerId, seed.id).toBeNull();
        }
    });

    it('refuses a roster longer than the seeded primitives rather than colliding two seats', () => {
        expect(() => buildInitialActionEntities([alice, bob, carol, dave])).toThrow(
            /exceeds 3 available primitives/u,
        );
    });

    it('seats the longest roster it does accept', () => {
        // The ON-boundary case for the guard above: three seats is the last
        // roster that fits, so a `>=` there would reject a legal match.
        const entities = buildInitialActionEntities([alice, bob, carol]);

        const owners = ACTION_PRIMITIVE_SEEDS.map((seed) => {
            const entity = entities[seed.id as keyof typeof entities];
            if (!isActionPrimitiveEntity(entity)) throw new Error(`missing primitive ${seed.id}`);
            return entity.ownerId;
        });
        expect(owners).toEqual([alice, bob, carol]);
    });

    it('does not mutate the roster it is handed', () => {
        const roster = [alice, bob];
        const before = [...roster];

        buildInitialActionEntities(roster);

        expect(roster).toEqual(before);
    });

    it('builds an independent record per call', () => {
        // A module-level record reused across matches would leak one match's
        // ownership into the next.
        const first = buildInitialActionEntities([alice]);
        const second = buildInitialActionEntities([bob]);

        expect(first).not.toBe(second);
        const firstCube = first[ACTION_PRIMITIVE_SEEDS[0]?.id as keyof typeof first];
        const secondCube = second[ACTION_PRIMITIVE_SEEDS[0]?.id as keyof typeof second];
        if (!isActionPrimitiveEntity(firstCube) || !isActionPrimitiveEntity(secondCube)) {
            throw new Error('missing seeded cube');
        }
        expect(firstCube.ownerId).toBe(alice);
        expect(secondCube.ownerId).toBe(bob);
    });
});

describe('buildInitialActionEntities — primitive-driven seating', () => {
    const setupWith = (attributes: Record<string, Record<string, string>>) => ({
        gameParams: {},
        playerAttributes: attributes,
    });

    it('seats a player on the primitive their primitive attribute names', () => {
        const entities = buildInitialActionEntities(
            [alice],
            setupWith({ [alice]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' } }),
        );

        expect(ownerOfShape(entities, 'cone')).toBe(alice);
        expect(ownerOfShape(entities, 'cube')).toBeNull();
    });

    it('gives the SECOND seat its own named primitive, not the next seed in order', () => {
        const entities = buildInitialActionEntities(
            [alice, bob],
            setupWith({
                [alice]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
                [bob]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' },
            }),
        );

        expect(ownerOfShape(entities, 'cone')).toBe(alice);
        expect(ownerOfShape(entities, 'cube')).toBe(bob);
        expect(ownerOfShape(entities, 'sphere')).toBeNull();
    });

    it('falls back to seat order for a seat that names nothing', () => {
        const entities = buildInitialActionEntities([alice, bob], setupWith({}));

        expect(ownerOfShape(entities, 'cube')).toBe(alice);
        expect(ownerOfShape(entities, 'sphere')).toBe(bob);
    });

    it('gives a NAMED primitive to the seat that named it, over an earlier seat with no pick', () => {
        // Why there are two passes at all — the rule itself is
        // `assignActionPrimitiveOwners`' JSDoc. Folding the fallback into one
        // pass would let alice — who named nothing — take seed 0 first, and bob
        // would watch someone else drive the cube he chose.
        const entities = buildInitialActionEntities(
            [alice, bob],
            setupWith({ [bob]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' } }),
        );

        expect(ownerOfShape(entities, 'cube')).toBe(bob);
        expect(ownerOfShape(entities, 'sphere')).toBe(alice);
    });

    it('gives an earlier seat the primitive both named, and the later seat the first free one', () => {
        // Exclusivity is enforced on the shell side, so this is the wire arriving
        // in a state the picker cannot produce. It must still seat both.
        const entities = buildInitialActionEntities(
            [alice, bob],
            setupWith({
                [alice]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
                [bob]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
            }),
        );

        expect(ownerOfShape(entities, 'cone')).toBe(alice);
        expect(ownerOfShape(entities, 'cube')).toBe(bob);
    });

    it('ignores a primitive value that names no shape', () => {
        const entities = buildInitialActionEntities(
            [alice],
            setupWith({ [alice]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'dodecahedron' } }),
        );

        expect(ownerOfShape(entities, 'cube')).toBe(alice);
    });

    it('reads the primitive off the ACTING seat, never the first entry in the map', () => {
        // A lookup that took `Object.values(playerAttributes)[0]` would pass a
        // one-seat fixture and seat bob on alice's pick here.
        const entities = buildInitialActionEntities(
            [bob],
            setupWith({
                [alice]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cone' },
                [bob]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'sphere' },
            }),
        );

        expect(ownerOfShape(entities, 'sphere')).toBe(bob);
        expect(ownerOfShape(entities, 'cone')).toBeNull();
    });
});

/** The seat driving the primitive of `shape`, or `null` when it is unclaimed. */
function ownerOfShape(
    entities: ReturnType<typeof buildInitialActionEntities>,
    shape: string,
): string | null {
    for (const entity of Object.values(entities)) {
        if (isActionPrimitiveEntity(entity) && entity.shape === shape) {
            return entity.ownerId;
        }
    }
    throw new Error(`no primitive of shape ${shape}`);
}
