import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import { countDarkenedPixels, decodePngToRgbaFrame } from './canvas-darkening';

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

    it('throws when the two frames differ in size', () => {
        expect(() =>
            countDarkenedPixels(row([0, 0, 0, 255]), row([0, 0, 0, 255], [0, 0, 0, 255]), 1),
        ).toThrow('Canvas pixel frames differ in size: 1x1 and 2x1.');
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
