import { describe, expect, it } from 'vitest';

import {
    ActionSelectPrimitivePayloadSchema,
    ActionSetVelocityPayloadSchema,
} from './action-schemas.js';

// Stage-2 structural validation. `reduce` trusts whatever gets past these, so
// every rejection below is a state the reducers never have to defend against.
describe('ActionSetVelocityPayloadSchema', () => {
    for (const dx of [-1, 0, 1] as const) {
        for (const dy of [-1, 0, 1] as const) {
            it(`accepts the legal pair { dx: ${dx}, dy: ${dy} }`, () => {
                expect(ActionSetVelocityPayloadSchema.parse({ dx, dy })).toEqual({ dx, dy });
            });
        }
    }

    it('rejects a component one step outside the -1|0|1 vocabulary', () => {
        expect(() => ActionSetVelocityPayloadSchema.parse({ dx: 2, dy: 0 })).toThrow();
        expect(() => ActionSetVelocityPayloadSchema.parse({ dx: 0, dy: -2 })).toThrow();
    });

    it('rejects a fractional component', () => {
        // The whole point of the three-literal vocabulary: a fractional step
        // would be fractional gameplay state, which integer positions forbid.
        expect(() => ActionSetVelocityPayloadSchema.parse({ dx: 0.5, dy: 0 })).toThrow();
    });

    it('rejects a missing component', () => {
        expect(() => ActionSetVelocityPayloadSchema.parse({ dx: 1 })).toThrow();
        expect(() => ActionSetVelocityPayloadSchema.parse({ dy: 1 })).toThrow();
    });

    it('rejects an unknown extra key', () => {
        expect(() => ActionSetVelocityPayloadSchema.parse({ dx: 0, dy: 0, dz: 0 })).toThrow();
    });
});

describe('ActionSelectPrimitivePayloadSchema', () => {
    it('accepts a non-empty entity id', () => {
        expect(ActionSelectPrimitivePayloadSchema.parse({ entityId: 'primitive-cube' })).toEqual({
            entityId: 'primitive-cube',
        });
    });

    it('rejects an empty entity id', () => {
        expect(() => ActionSelectPrimitivePayloadSchema.parse({ entityId: '' })).toThrow();
    });

    it('rejects a non-string entity id', () => {
        expect(() => ActionSelectPrimitivePayloadSchema.parse({ entityId: 7 })).toThrow();
    });

    it('rejects an unknown extra key', () => {
        expect(() =>
            ActionSelectPrimitivePayloadSchema.parse({ entityId: 'primitive-cube', force: true }),
        ).toThrow();
    });
});
