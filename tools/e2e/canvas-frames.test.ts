import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import { assertValidFrame, countDarkenedPixels, decodePngToRgbaFrame } from './canvas-frames';

/** A one-row frame of the given RGBA pixels. */
function row(...pixels: readonly (readonly [number, number, number, number])[]) {
    return { width: pixels.length, height: 1, rgba: pixels.flat() };
}

describe('countDarkenedPixels', () => {
    it('counts a pixel whose RGB sum fell by the threshold, and not one that fell by one less', () => {
        const before = row([100, 100, 100, 255], [100, 100, 100, 255]);
        const after = row([90, 90, 90, 255], [91, 90, 90, 255]);

        expect(countDarkenedPixels(before, after, 30)).toBe(1);
    });

    it('does not count a pixel that brightened or stayed the same', () => {
        const before = row([100, 100, 100, 255], [100, 100, 100, 255]);
        const after = row([140, 140, 140, 255], [100, 100, 100, 255]);

        expect(countDarkenedPixels(before, after, 1)).toBe(0);
    });

    it('sums all three channels, so a drop on one channel alone counts', () => {
        const before = row([100, 100, 200, 255]);
        const after = row([100, 100, 150, 255]);

        expect(countDarkenedPixels(before, after, 50)).toBe(1);
    });

    it('skips a pixel that is transparent in either frame', () => {
        const before = row([200, 200, 200, 255], [200, 200, 200, 0]);
        const after = row([0, 0, 0, 0], [0, 0, 0, 255]);

        expect(countDarkenedPixels(before, after, 1)).toBe(0);
    });

    it('counts a pixel drawn at the visibility alpha, and skips one just below it in either frame', () => {
        // Literal, not read off MIN_VISIBLE_ALPHA: a fixture derived from the
        // constant would move with it.
        const drawn = 32;
        const notDrawn = 31;
        const before = row(
            [200, 200, 200, drawn],
            [200, 200, 200, notDrawn],
            [200, 200, 200, drawn],
        );
        const after = row([0, 0, 0, drawn], [0, 0, 0, drawn], [0, 0, 0, notDrawn]);

        expect(countDarkenedPixels(before, after, 1)).toBe(1);
    });

    it('throws when the two frames differ in size', () => {
        expect(() =>
            countDarkenedPixels(row([0, 0, 0, 255]), row([0, 0, 0, 255], [0, 0, 0, 255]), 1),
        ).toThrow('Canvas pixel frames differ in size: 1x1 and 2x1.');
    });

    it('throws when the two frames differ in height alone', () => {
        const oneRow = { width: 1, height: 1, rgba: [0, 0, 0, 255] };
        const twoRows = { width: 1, height: 2, rgba: [0, 0, 0, 255, 0, 0, 0, 255] };

        expect(() => countDarkenedPixels(oneRow, twoRows, 1)).toThrow(
            'Canvas pixel frames differ in size: 1x1 and 1x2.',
        );
    });

    it('throws when a frame carries the wrong number of RGBA values', () => {
        expect(() =>
            countDarkenedPixels(
                { width: 2, height: 1, rgba: [0, 0, 0, 255] },
                { width: 2, height: 1, rgba: [0, 0, 0, 255] },
                1,
            ),
        ).toThrow('Canvas pixel frame has 4 RGBA values; expected 8.');
    });

    it('checks each frame on its own, so either one carrying the wrong number of RGBA values throws', () => {
        const valid = { width: 2, height: 1, rgba: [0, 0, 0, 255, 0, 0, 0, 255] };
        const short = { width: 2, height: 1, rgba: [0, 0, 0, 255] };

        expect(() => countDarkenedPixels(short, valid, 1)).toThrow(
            'Canvas pixel frame has 4 RGBA values; expected 8.',
        );
        expect(() => countDarkenedPixels(valid, short, 1)).toThrow(
            'Canvas pixel frame has 4 RGBA values; expected 8.',
        );
    });
});

describe('assertValidFrame', () => {
    it('throws when width is not a positive integer', () => {
        expect(() => assertValidFrame({ width: 0, height: 1, rgba: [] })).toThrow(
            'Canvas pixel frame width must be a positive integer.',
        );
        expect(() => assertValidFrame({ width: -1, height: 1, rgba: [] })).toThrow(
            'Canvas pixel frame width must be a positive integer.',
        );
        expect(() => assertValidFrame({ width: 1.5, height: 1, rgba: [0, 0, 0, 0, 0, 0] })).toThrow(
            'Canvas pixel frame width must be a positive integer.',
        );
    });

    it('throws when height is not a positive integer', () => {
        expect(() => assertValidFrame({ width: 1, height: 0, rgba: [] })).toThrow(
            'Canvas pixel frame height must be a positive integer.',
        );
        expect(() => assertValidFrame({ width: 1, height: -2, rgba: [] })).toThrow(
            'Canvas pixel frame height must be a positive integer.',
        );
        expect(() => assertValidFrame({ width: 1, height: 1.5, rgba: [0, 0, 0, 0, 0, 0] })).toThrow(
            'Canvas pixel frame height must be a positive integer.',
        );
    });

    it('throws when rgba length does not match width * height * 4', () => {
        expect(() => assertValidFrame({ width: 2, height: 1, rgba: [0, 0, 0, 255] })).toThrow(
            'Canvas pixel frame has 4 RGBA values; expected 8.',
        );
    });

    it('accepts a frame whose size and byte count agree', () => {
        expect(() => assertValidFrame(row([0, 0, 0, 255], [0, 0, 0, 0]))).not.toThrow();
    });
});

describe('decodePngToRgbaFrame', () => {
    it('decodes a PNG into its size and tightly packed RGBA bytes', () => {
        const png = new PNG({ width: 2, height: 1 });
        png.data.set([10, 20, 30, 255, 40, 50, 60, 128]);

        const frame = decodePngToRgbaFrame(PNG.sync.write(png));

        expect(frame.width).toBe(2);
        expect(frame.height).toBe(1);
        expect(Array.from(frame.rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
    });
});
