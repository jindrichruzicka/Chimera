import { PNG } from 'pngjs';

/**
 * tools/e2e/canvas-frames.ts
 *
 * Reading a live canvas in the reference apps' Playwright e2e suites: decode a
 * screenshot into an RGBA frame, then count the pixels that went dark between
 * two frames of an otherwise identical scene.
 *
 * Decoding happens in the TEST process, never through `page.evaluate` — a
 * pixel payload shipped over CDP from a busy renderer is slow enough to eat a
 * poll budget.
 */

export interface CanvasRgbaFrame {
    readonly width: number;
    readonly height: number;
    /** Tightly packed RGBA bytes; accepts plain arrays as well as Buffer/Uint8Array. */
    readonly rgba: ArrayLike<number>;
}

/** Below this alpha a pixel is treated as not drawn. */
export const MIN_VISIBLE_ALPHA = 32;

/** Decode a PNG screenshot buffer into a full-resolution RGBA frame. */
export function decodePngToRgbaFrame(encodedPng: Buffer): CanvasRgbaFrame {
    const png = PNG.sync.read(encodedPng);
    return { width: png.width, height: png.height, rgba: png.data };
}

/**
 * How many pixels are darker in `after` than in `before` by at least
 * `minSumDrop`, measured on the sum of the three colour channels. A pixel
 * transparent in either frame is skipped.
 */
export function countDarkenedPixels(
    before: CanvasRgbaFrame,
    after: CanvasRgbaFrame,
    minSumDrop: number,
): number {
    assertValidFrame(before);
    assertValidFrame(after);
    if (before.width !== after.width || before.height !== after.height) {
        throw new Error(
            `Canvas pixel frames differ in size: ${before.width}x${before.height} and ${after.width}x${after.height}.`,
        );
    }

    let darkened = 0;
    for (let pixelOffset = 0; pixelOffset < before.rgba.length; pixelOffset += 4) {
        if (
            (before.rgba[pixelOffset + 3] ?? 0) < MIN_VISIBLE_ALPHA ||
            (after.rgba[pixelOffset + 3] ?? 0) < MIN_VISIBLE_ALPHA
        ) {
            continue;
        }
        const drop = channelSum(before.rgba, pixelOffset) - channelSum(after.rgba, pixelOffset);
        if (drop >= minSumDrop) {
            darkened += 1;
        }
    }

    return darkened;
}

function channelSum(rgba: ArrayLike<number>, pixelOffset: number): number {
    return (rgba[pixelOffset] ?? 0) + (rgba[pixelOffset + 1] ?? 0) + (rgba[pixelOffset + 2] ?? 0);
}

export function assertValidFrame(frame: CanvasRgbaFrame): void {
    if (!Number.isInteger(frame.width) || frame.width <= 0) {
        throw new Error('Canvas pixel frame width must be a positive integer.');
    }
    if (!Number.isInteger(frame.height) || frame.height <= 0) {
        throw new Error('Canvas pixel frame height must be a positive integer.');
    }
    const expectedChannelCount = frame.width * frame.height * 4;
    if (frame.rgba.length !== expectedChannelCount) {
        throw new Error(
            `Canvas pixel frame has ${frame.rgba.length} RGBA values; expected ${expectedChannelCount}.`,
        );
    }
}
