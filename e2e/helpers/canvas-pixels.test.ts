import { describe, expect, it } from 'vitest';
import { analyzeCanvasPixels, formatCanvasPixelStats } from './canvas-pixels';

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
            }),
        ).toBe('canvas=10x5 pixels=50 nonblank=42 blue=7 red=0');
    });
});
