import { describe, expect, it } from 'vitest';
import { easeIn, easeInOut, easeOut, lerp, linear } from './curves.js';

describe('curves', () => {
    it('linearly interpolates without clamping t', () => {
        expect(lerp(10, 20, 0)).toBe(10);
        expect(lerp(10, 20, 0.5)).toBe(15);
        expect(lerp(10, 20, 1)).toBe(20);
        expect(lerp(10, 20, 1.5)).toBe(25);
    });

    it('preserves arbitrary endpoints for lerp boundary values', () => {
        expect(lerp(-12.5, 47.25, 0)).toBe(-12.5);
        expect(lerp(-12.5, 47.25, 1)).toBe(47.25);
    });

    it.each([
        ['linear', linear, 0, 0.5, 1],
        ['easeIn', easeIn, 0, 0.25, 1],
        ['easeOut', easeOut, 0, 0.75, 1],
        ['easeInOut', easeInOut, 0, 0.5, 1],
    ])(
        '%s returns expected boundary and midpoint values',
        (_name, easing, start, midpoint, end) => {
            expect(easing(0)).toBe(start);
            expect(easing(0.5)).toBe(midpoint);
            expect(easing(1)).toBe(end);
        },
    );
});
