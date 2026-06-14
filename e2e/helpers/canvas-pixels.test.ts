import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
    analyzeCanvasPixels,
    decodePngToRgbaFrame,
    formatCanvasPixelStats,
    summarizeOpaqueColor,
} from './canvas-pixels';

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
            }),
        ).toBe('canvas=10x5 pixels=50 nonblank=42 blue=7 red=0 green=3 amber=1');
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
