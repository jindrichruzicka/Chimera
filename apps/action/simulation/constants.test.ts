import { describe, expect, it } from 'vitest';

import {
    ACTION_ARENA_MAX_X,
    ACTION_ARENA_MAX_Y,
    ACTION_ARENA_MIN_X,
    ACTION_ARENA_MIN_Y,
    ACTION_CONTROL_ATTRIBUTE,
    ACTION_GAME_ID,
    ACTION_GROUND_ENTITY_ID_VALUE,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_PRIMITIVE_SEEDS,
    ACTION_PRIMITIVE_SHAPES,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
    ACTION_TICK_RATE_MS,
    ACTION_WASD_CONTROL,
    clampToArenaX,
    clampToArenaY,
    isActionPrimitiveShape,
} from './constants.js';

// The action app's identity + arena geometry. Every other module derives from
// here, so these assertions are what stop a rename drifting the action ids away
// from the game id the host registers under.
describe('action constants', () => {
    it('namespaces both action ids under the game id', () => {
        expect(ACTION_GAME_ID).toBe('action');
        expect(ACTION_SET_VELOCITY_ACTION).toBe(`${ACTION_GAME_ID}:set-velocity`);
        expect(ACTION_SELECT_PRIMITIVE_ACTION).toBe(`${ACTION_GAME_ID}:select-primitive`);
    });

    it('pins a modest integer heartbeat', () => {
        // The manifest hands this straight to the host's RealtimeTicker; a
        // fractional or non-positive interval is not a valid heartbeat.
        expect(Number.isInteger(ACTION_TICK_RATE_MS)).toBe(true);
        expect(ACTION_TICK_RATE_MS).toBeGreaterThan(0);
        expect(ACTION_TICK_RATE_MS).toBe(100);
    });

    it('spans a non-empty integer arena', () => {
        for (const bound of [
            ACTION_ARENA_MIN_X,
            ACTION_ARENA_MAX_X,
            ACTION_ARENA_MIN_Y,
            ACTION_ARENA_MAX_Y,
        ]) {
            expect(Number.isInteger(bound)).toBe(true);
        }
        expect(ACTION_ARENA_MIN_X).toBeLessThan(ACTION_ARENA_MAX_X);
        expect(ACTION_ARENA_MIN_Y).toBeLessThan(ACTION_ARENA_MAX_Y);
    });

    it('seeds one primitive per shape, each inside the arena and distinctly placed', () => {
        expect(ACTION_PRIMITIVE_SEEDS.map((seed) => seed.shape)).toEqual([
            'cube',
            'sphere',
            'cone',
        ]);
        expect(new Set(ACTION_PRIMITIVE_SEEDS.map((seed) => seed.id)).size).toBe(
            ACTION_PRIMITIVE_SEEDS.length,
        );
        expect(new Set(ACTION_PRIMITIVE_SEEDS.map((seed) => `${seed.x}:${seed.y}`)).size).toBe(
            ACTION_PRIMITIVE_SEEDS.length,
        );
        for (const seed of ACTION_PRIMITIVE_SEEDS) {
            expect(seed.x, seed.id).toBeGreaterThanOrEqual(ACTION_ARENA_MIN_X);
            expect(seed.x, seed.id).toBeLessThanOrEqual(ACTION_ARENA_MAX_X);
            expect(seed.y, seed.id).toBeGreaterThanOrEqual(ACTION_ARENA_MIN_Y);
            expect(seed.y, seed.id).toBeLessThanOrEqual(ACTION_ARENA_MAX_Y);
        }
    });

    it('keeps the ground id out of the primitive id set', () => {
        // The ground shares the entity record with the primitives; a collision
        // would have one overwrite the other in `buildInitialActionEntities`.
        expect(ACTION_PRIMITIVE_SEEDS.map((seed) => seed.id)).not.toContain(
            ACTION_GROUND_ENTITY_ID_VALUE,
        );
    });

    describe('clampToArenaX', () => {
        it('passes an interior coordinate through unchanged', () => {
            expect(clampToArenaX(0)).toBe(0);
        });

        it('holds a coordinate ON each bound rather than nudging it', () => {
            expect(clampToArenaX(ACTION_ARENA_MIN_X)).toBe(ACTION_ARENA_MIN_X);
            expect(clampToArenaX(ACTION_ARENA_MAX_X)).toBe(ACTION_ARENA_MAX_X);
        });

        it('clamps one step past each bound back onto it', () => {
            expect(clampToArenaX(ACTION_ARENA_MIN_X - 1)).toBe(ACTION_ARENA_MIN_X);
            expect(clampToArenaX(ACTION_ARENA_MAX_X + 1)).toBe(ACTION_ARENA_MAX_X);
        });
    });

    describe('clampToArenaY', () => {
        it('passes an interior coordinate through unchanged', () => {
            expect(clampToArenaY(0)).toBe(0);
        });

        it('holds a coordinate ON each bound rather than nudging it', () => {
            expect(clampToArenaY(ACTION_ARENA_MIN_Y)).toBe(ACTION_ARENA_MIN_Y);
            expect(clampToArenaY(ACTION_ARENA_MAX_Y)).toBe(ACTION_ARENA_MAX_Y);
        });

        it('clamps one step past each bound back onto it', () => {
            expect(clampToArenaY(ACTION_ARENA_MIN_Y - 1)).toBe(ACTION_ARENA_MIN_Y);
            expect(clampToArenaY(ACTION_ARENA_MAX_Y + 1)).toBe(ACTION_ARENA_MAX_Y);
        });

        it('clamps on the Y bounds, not the X ones', () => {
            // The two axes have different extents, so a copy-paste that clamped
            // Y against the X bounds would survive a square-arena fixture.
            expect(clampToArenaY(ACTION_ARENA_MAX_X)).toBe(ACTION_ARENA_MAX_Y);
        });
    });

    it('clamps X on the X bounds, not the Y ones', () => {
        expect(clampToArenaX(ACTION_ARENA_MAX_X)).toBe(ACTION_ARENA_MAX_X);
        expect(ACTION_ARENA_MAX_X).not.toBe(ACTION_ARENA_MAX_Y);
    });
});

describe('seat attributes', () => {
    it('names the two attribute keys the shell writes and the match reads', () => {
        expect(ACTION_PRIMITIVE_ATTRIBUTE).toBe('primitive');
        expect(ACTION_CONTROL_ATTRIBUTE).toBe('control');
        expect(ACTION_WASD_CONTROL).toBe('wasd');
    });

    describe('isActionPrimitiveShape', () => {
        it.each(ACTION_PRIMITIVE_SHAPES)('admits the declared shape %s', (shape) => {
            expect(isActionPrimitiveShape(shape)).toBe(true);
        });

        it('rejects a string that names no shape', () => {
            expect(isActionPrimitiveShape('dodecahedron')).toBe(false);
        });

        it('rejects a shape name in the wrong case', () => {
            // The attribute travels on the wire verbatim; a case-folding check
            // would admit a value the seed list cannot match.
            expect(isActionPrimitiveShape('Cube')).toBe(false);
        });

        it.each([undefined, null, 0, {}, ['cube']])('rejects the non-string %s', (value) => {
            expect(isActionPrimitiveShape(value)).toBe(false);
        });
    });
});
