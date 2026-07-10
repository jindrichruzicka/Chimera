import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { encodeSolidPng } from './solid-png';

function pixelAt(png: PNG, x: number, y: number): readonly [number, number, number, number] {
    const offset = (y * png.width + x) * 4;
    return [
        png.data[offset] ?? -1,
        png.data[offset + 1] ?? -1,
        png.data[offset + 2] ?? -1,
        png.data[offset + 3] ?? -1,
    ];
}

describe('encodeSolidPng', () => {
    it('throws when width or height is not a positive integer', () => {
        const red = { r: 255, g: 0, b: 0, a: 255 };
        expect(() => encodeSolidPng(0, 32, red)).toThrow(
            'Solid PNG width must be a positive integer.',
        );
        expect(() => encodeSolidPng(32, -1, red)).toThrow(
            'Solid PNG height must be a positive integer.',
        );
        expect(() => encodeSolidPng(1.5, 32, red)).toThrow(
            'Solid PNG width must be a positive integer.',
        );
    });

    it('throws when a channel is outside the 0-255 byte range', () => {
        expect(() => encodeSolidPng(32, 32, { r: 256, g: 0, b: 0, a: 255 })).toThrow(
            'Solid PNG channel "r" must be an integer between 0 and 255.',
        );
        expect(() => encodeSolidPng(32, 32, { r: 0, g: -1, b: 0, a: 255 })).toThrow(
            'Solid PNG channel "g" must be an integer between 0 and 255.',
        );
    });

    it('encodes a decodable PNG of the requested dimensions filled with the color', () => {
        const buffer = encodeSolidPng(32, 32, { r: 255, g: 0, b: 0, a: 255 });
        const decoded = PNG.sync.read(buffer);

        expect(decoded.width).toBe(32);
        expect(decoded.height).toBe(32);
        expect(pixelAt(decoded, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(decoded, 16, 16)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(decoded, 31, 31)).toEqual([255, 0, 0, 255]);
    });

    it('preserves distinct channel values including alpha', () => {
        const buffer = encodeSolidPng(2, 3, { r: 10, g: 20, b: 30, a: 40 });
        const decoded = PNG.sync.read(buffer);

        expect(decoded.width).toBe(2);
        expect(decoded.height).toBe(3);
        expect(pixelAt(decoded, 1, 2)).toEqual([10, 20, 30, 40]);
    });
});
