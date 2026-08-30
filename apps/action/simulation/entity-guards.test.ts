import { describe, expect, it } from 'vitest';
import { entityId, type BaseEntityState } from '@chimera-engine/simulation/engine/types.js';

import { isActionGroundEntity, isActionPrimitiveEntity } from './entity-guards.js';

// Both guards run against untrusted data (a save file, a wire snapshot), so
// every conjunct gets a fixture that trips ONLY it: a guard that dropped one
// check would still reject each of the others' fixtures and look healthy.
const validPrimitive = {
    id: entityId('primitive-cube'),
    kind: 'primitive',
    shape: 'cube',
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    ownerId: null,
} as unknown as BaseEntityState;

const validGround = {
    id: entityId('ground'),
    kind: 'ground',
    widthCells: 17,
    depthCells: 11,
} as unknown as BaseEntityState;

function primitiveWith(overrides: Record<string, unknown>): BaseEntityState {
    return { ...validPrimitive, ...overrides };
}

function groundWith(overrides: Record<string, unknown>): BaseEntityState {
    return { ...validGround, ...overrides };
}

describe('isActionPrimitiveEntity', () => {
    it('accepts a fully-formed primitive', () => {
        expect(isActionPrimitiveEntity(validPrimitive)).toBe(true);
    });

    it('accepts an owned primitive', () => {
        expect(isActionPrimitiveEntity(primitiveWith({ ownerId: 'alice' }))).toBe(true);
    });

    it('accepts each velocity component of the closed vocabulary', () => {
        for (const component of [-1, 0, 1]) {
            expect(
                isActionPrimitiveEntity(primitiveWith({ dx: component })),
                `dx ${component}`,
            ).toBe(true);
            expect(
                isActionPrimitiveEntity(primitiveWith({ dy: component })),
                `dy ${component}`,
            ).toBe(true);
        }
    });

    it('rejects undefined', () => {
        expect(isActionPrimitiveEntity(undefined)).toBe(false);
    });

    it('rejects the ground plane', () => {
        expect(isActionPrimitiveEntity(validGround)).toBe(false);
    });

    it('rejects an unknown shape', () => {
        expect(isActionPrimitiveEntity(primitiveWith({ shape: 'torus' }))).toBe(false);
    });

    it('rejects a fractional position on either axis', () => {
        expect(isActionPrimitiveEntity(primitiveWith({ x: 0.5 }))).toBe(false);
        expect(isActionPrimitiveEntity(primitiveWith({ y: 0.5 }))).toBe(false);
    });

    it('rejects a velocity component outside the vocabulary, on either axis', () => {
        expect(isActionPrimitiveEntity(primitiveWith({ dx: 2 }))).toBe(false);
        expect(isActionPrimitiveEntity(primitiveWith({ dy: 2 }))).toBe(false);
    });

    it('rejects an ownerId that is neither a string nor null', () => {
        expect(isActionPrimitiveEntity(primitiveWith({ ownerId: 7 }))).toBe(false);
        expect(isActionPrimitiveEntity(primitiveWith({ ownerId: undefined }))).toBe(false);
    });
});

describe('isActionGroundEntity', () => {
    it('accepts a fully-formed ground plane', () => {
        expect(isActionGroundEntity(validGround)).toBe(true);
    });

    it('rejects undefined', () => {
        expect(isActionGroundEntity(undefined)).toBe(false);
    });

    it('rejects a primitive', () => {
        expect(isActionGroundEntity(validPrimitive)).toBe(false);
    });

    it('rejects a fractional extent on either axis', () => {
        expect(isActionGroundEntity(groundWith({ widthCells: 1.5 }))).toBe(false);
        expect(isActionGroundEntity(groundWith({ depthCells: 1.5 }))).toBe(false);
    });
});
