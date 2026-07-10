import { PNG } from 'pngjs';

/** One RGBA color, each channel an integer byte (0-255). */
export interface SolidPngColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

const CHANNEL_ORDER = ['r', 'g', 'b', 'a'] as const;

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Solid PNG ${label} must be a positive integer.`);
    }
}

function assertChannelByte(value: number, channel: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`Solid PNG channel "${channel}" must be an integer between 0 and 255.`);
    }
}

/**
 * Encode a single-color RGBA PNG of the given dimensions. Used by cursor
 * e2e specs to synthesize replacement cursor art with an unambiguous pixel
 * signature (e.g. solid red vs the committed solid-white placeholders).
 */
export function encodeSolidPng(width: number, height: number, color: SolidPngColor): Buffer {
    assertPositiveInteger(width, 'width');
    assertPositiveInteger(height, 'height');
    for (const channel of CHANNEL_ORDER) {
        assertChannelByte(color[channel], channel);
    }

    const png = new PNG({ width, height });
    for (let offset = 0; offset < png.data.length; offset += 4) {
        png.data[offset] = color.r;
        png.data[offset + 1] = color.g;
        png.data[offset + 2] = color.b;
        png.data[offset + 3] = color.a;
    }

    return PNG.sync.write(png);
}
