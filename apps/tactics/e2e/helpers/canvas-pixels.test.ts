import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
    analyzeCanvasPixels,
    countDarkenedPixels,
    decodePngToRgbaFrame,
    formatCanvasPixelStats,
    summarizeOpaqueColor,
} from './canvas-pixels';

describe('countDarkenedPixels', () => {
    /** A one-row frame of the given RGBA pixels. */
    function row(...pixels: readonly (readonly [number, number, number, number])[]) {
        return { width: pixels.length, height: 1, rgba: pixels.flat() };
    }

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
});

describe('analyzeCanvasPixels', () => {
    it('throws when width is not a positive integer', () => {
        expect(() => analyzeCanvasPixels({ width: 0, height: 1, rgba: [] })).toThrow(
            'Canvas pixel frame width must be a positive integer.',
        );
        expect(() => analyzeCanvasPixels({ width: -1, height: 1, rgba: [] })).toThrow(
            'Canvas pixel frame width must be a positive integer.',
        );
        expect(() =>
            analyzeCanvasPixels({ width: 1.5, height: 1, rgba: [0, 0, 0, 0, 0, 0] }),
        ).toThrow('Canvas pixel frame width must be a positive integer.');
    });

    it('throws when height is not a positive integer', () => {
        expect(() => analyzeCanvasPixels({ width: 1, height: 0, rgba: [] })).toThrow(
            'Canvas pixel frame height must be a positive integer.',
        );
        expect(() => analyzeCanvasPixels({ width: 1, height: -2, rgba: [] })).toThrow(
            'Canvas pixel frame height must be a positive integer.',
        );
    });

    it('throws when rgba length does not match width * height * 4', () => {
        expect(() => analyzeCanvasPixels({ width: 2, height: 1, rgba: [0, 0, 0, 255] })).toThrow(
            'Canvas pixel frame has 4 RGBA values; expected 8.',
        );
    });

    it('counts nonblank, blue, and red pixels with tolerant color dominance', () => {
        const stats = analyzeCanvasPixels({
            width: 6,
            height: 1,
            rgba: [
                37, 99, 235, 255, 20, 70, 180, 255, 220, 38, 38, 255, 63, 63, 70, 255, 245, 245,
                245, 255, 0, 0, 0, 0,
            ],
        });

        expect(stats).toEqual({
            width: 6,
            height: 1,
            totalPixels: 6,
            nonBlankPixels: 5,
            bluePixels: 2,
            redPixels: 1,
            greenPixels: 0,
            amberPixels: 0,
            magentaPixels: 0,
        });
    });

    it('counts green and amber primitive pixels by hue dominance', () => {
        // Pixel palette (raw tactics colours):
        //   green #16a34a, amber #f59e0b, blue #2563eb, red #dc2626, blank.
        const stats = analyzeCanvasPixels({
            width: 5,
            height: 1,
            rgba: [
                22, 163, 74, 255, 245, 158, 11, 255, 37, 99, 235, 255, 220, 38, 38, 255, 0, 0, 0, 0,
            ],
        });

        expect(stats.greenPixels).toBe(1);
        expect(stats.amberPixels).toBe(1);
        // Amber is also red-dominant, so it correctly trips the red counter too;
        // green/blue must never be misclassified as amber.
        expect(stats.bluePixels).toBe(1);
        expect(stats.redPixels).toBe(2);
    });

    it('counts magenta showcase-model pixels without tripping the red or blue counters', () => {
        // Pixel palette: magenta #ff00ff (showcase rig), blue #2563eb,
        // red #dc2626, blank. Magenta has red AND blue high, so the dominance
        // deltas in the red/blue classifiers must both reject it.
        const stats = analyzeCanvasPixels({
            width: 4,
            height: 1,
            rgba: [255, 0, 255, 255, 37, 99, 235, 255, 220, 38, 38, 255, 0, 0, 0, 0],
        });

        expect(stats.magentaPixels).toBe(1);
        expect(stats.bluePixels).toBe(1);
        expect(stats.redPixels).toBe(1);
    });

    it('rejects near-miss magenta pixels that each violate exactly one classifier conjunct', () => {
        // One pixel per conjunct, isolating it: low-alpha magenta; red below
        // its minimum; blue below its minimum; red under the green-suppression
        // delta; blue under the green-suppression delta. A dropped conjunct
        // admits its pixel and the count moves off zero.
        const stats = analyzeCanvasPixels({
            width: 5,
            height: 1,
            rgba: [
                255, 0, 255, 40, 100, 0, 255, 255, 255, 0, 100, 255, 200, 130, 255, 255, 255, 130,
                200, 255,
            ],
        });

        expect(stats.magentaPixels).toBe(0);
    });

    it('decodes a PNG buffer into a full-resolution RGBA frame analyzable in-process', () => {
        const png = new PNG({ width: 2, height: 1 });
        // Pixel 0: opaque blue primitive; pixel 1: transparent blank.
        png.data = Buffer.from([37, 99, 235, 255, 0, 0, 0, 0]);
        const encoded = PNG.sync.write(png);

        const frame = decodePngToRgbaFrame(encoded);

        expect(frame.width).toBe(2);
        expect(frame.height).toBe(1);
        expect(Array.from(frame.rgba)).toEqual([37, 99, 235, 255, 0, 0, 0, 0]);
        expect(analyzeCanvasPixels(frame)).toEqual({
            width: 2,
            height: 1,
            totalPixels: 2,
            nonBlankPixels: 1,
            bluePixels: 1,
            redPixels: 0,
            greenPixels: 0,
            amberPixels: 0,
            magentaPixels: 0,
        });
    });

    it('formats stats for Playwright failure output', () => {
        expect(
            formatCanvasPixelStats({
                width: 10,
                height: 5,
                totalPixels: 50,
                nonBlankPixels: 42,
                bluePixels: 7,
                redPixels: 0,
                greenPixels: 3,
                amberPixels: 1,
                magentaPixels: 0,
            }),
        ).toBe('canvas=10x5 pixels=50 nonblank=42 blue=7 red=0 green=3 amber=1 magenta=0');
    });
});

describe('summarizeOpaqueColor', () => {
    it('averages RGB over sufficiently opaque pixels, ignoring transparent ones', () => {
        const color = summarizeOpaqueColor({
            width: 3,
            height: 1,
            rgba: [30, 41, 59, 255, 10, 21, 39, 255, 200, 200, 200, 0],
        });

        expect(color).toEqual({ r: 20, g: 31, b: 49 });
    });

    it('returns black when no pixels are opaque', () => {
        const color = summarizeOpaqueColor({ width: 1, height: 1, rgba: [255, 255, 255, 0] });

        expect(color).toEqual({ r: 0, g: 0, b: 0 });
    });
});
