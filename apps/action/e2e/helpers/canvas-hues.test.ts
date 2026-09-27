/**
 * The green classifier, against synthetic pixels rather than a screenshot.
 *
 * What it has to get right is the boundary, because the e2e reading it concludes
 * "these pixels came from the HDRI" from nothing else. Two classes of fixture do
 * that work: the arena's own palette, which must not classify at any brightness,
 * and the shell chrome painted into the same element screenshot — whose
 * connection indicator IS green, and is excluded by brightness alone.
 */

import { describe, expect, it } from 'vitest';

import { countLitGreen, isGreenPixel } from './canvas-hues';

/** The colours the action scene paints without any environment map. */
const ARENA_PALETTE = {
    controlled: [0xf5, 0x9e, 0x0b],
    otherSeat: [0x38, 0xbd, 0xf8],
    unclaimed: [0x94, 0xa3, 0xb8],
    floor: [0x1f, 0x29, 0x37],
    hostRing: [0xf5, 0x9e, 0x0b],
    secondRing: [0xa8, 0x55, 0xf7],
} as const;

/**
 * The engine's connection indicator, composited.
 *
 * `--ch-color-success` (#15803d) at `--ch-opacity-disabled` (0.6) over the shell
 * surface (#111113). It is green-dominant and it IS in the frame the e2e
 * screenshots, so the dominance rules alone would admit it; brightness is what
 * keeps it out.
 */
const CONNECTION_DOT = [19, 84, 44] as const;

/**
 * The mirror ball's reflection, as the shipped menu renders it.
 *
 * Measured off a screenshot of the scene: the pixels the e2e counts read a mean
 * of this. A brightness floor raised past it would leave the measurement
 * counting nothing at all.
 */
const REFLECTED_SKY = [143, 197, 154] as const;

function frameOf(pixels: readonly (readonly number[])[]) {
    return {
        width: pixels.length,
        height: 1,
        rgba: pixels.flatMap((pixel) => [...pixel]),
    };
}

describe('the green classifier', () => {
    it('reads a lit green', () => {
        expect(isGreenPixel(40, 200, 70)).toBe(true);
    });

    it('reads no colour the action scene paints as green', () => {
        for (const [name, [red, green, blue]] of Object.entries(ARENA_PALETTE)) {
            expect(isGreenPixel(red, green, blue), name).toBe(false);
        }
    });

    it('reads the shell chrome that IS green as not lit', () => {
        // A competing green, and the reason the brightness floor is where it is
        // rather than at the noise floor: this pixel clears both dominance rules
        // and fails on brightness alone.
        const [red, green, blue] = CONNECTION_DOT;

        expect(green - red).toBeGreaterThanOrEqual(25);
        expect(green - blue).toBeGreaterThanOrEqual(25);
        expect(isGreenPixel(red, green, blue)).toBe(false);
    });

    it('takes the reflection the e2e counts', () => {
        // The other side of the bracket, and both sides are MEASURED colours
        // rather than the constant itself: a fixture written as
        // `MIN_GREEN_CHANNEL - 1` moves with the constant and so pins nothing.
        // Between the dot above and this, the floor has a range it may sit in
        // and two values it may not.
        const [red, green, blue] = REFLECTED_SKY;

        expect(isGreenPixel(red, green, blue)).toBe(true);
    });

    it.each([
        ['red', 190, 200, 100],
        ['blue', 100, 200, 190],
    ] as const)(
        'refuses a pixel whose lead over %s is inside the margin',
        (_channel, red, green, blue) => {
            // ASYMMETRIC on purpose, one case per channel: each clears one
            // margin and sits inside the other, so each is decided by the margin
            // it names. A symmetric pixel is rejected by either conjunct alone,
            // which leaves both free to be dropped unnoticed.
            expect(isGreenPixel(red, green, blue)).toBe(false);
        },
    );

    it('refuses a pixel whose lead is inside the margin on both channels', () => {
        expect(isGreenPixel(180, 200, 180)).toBe(false);
    });

    it('counts green once and skips transparent pixels', () => {
        const counts = countLitGreen(
            frameOf([
                [40, 200, 70, 255],
                [40, 200, 70, 0],
                [0x1f, 0x29, 0x37, 255],
                [...CONNECTION_DOT, 255],
            ]),
        );

        expect(counts).toEqual({ green: 1, visible: 3 });
    });

    it('refuses a frame whose byte count does not match its size', () => {
        expect(() => countLitGreen({ width: 2, height: 1, rgba: [1, 2, 3, 4] })).toThrow(
            /expected 8/u,
        );
    });
});
