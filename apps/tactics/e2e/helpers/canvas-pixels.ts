import { PNG } from 'pngjs';

export interface CanvasRgbaFrame {
    readonly width: number;
    readonly height: number;
    /** Tightly packed RGBA bytes; accepts plain arrays as well as Buffer/Uint8Array. */
    readonly rgba: ArrayLike<number>;
}

export interface CanvasPixelStats {
    readonly width: number;
    readonly height: number;
    readonly totalPixels: number;
    readonly nonBlankPixels: number;
    readonly bluePixels: number;
    readonly redPixels: number;
    readonly greenPixels: number;
    readonly amberPixels: number;
}

/** Mean RGB summary of a frame, used for board-colour parity assertions. */
export interface CanvasColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
}

const MIN_VISIBLE_ALPHA = 32;
const MIN_COLOR_ALPHA = 80;
const MIN_NONBLANK_CHANNEL_SUM = 48;
const MIN_BLUE_CHANNEL = 90;
const MIN_RED_CHANNEL = 100;
const BLUE_RED_DOMINANCE_DELTA = 40;
const BLUE_GREEN_DOMINANCE_DELTA = 30;
const RED_CHANNEL_DOMINANCE_DELTA = 40;
const MIN_GREEN_CHANNEL = 90;
const GREEN_RED_DOMINANCE_DELTA = 40;
const GREEN_BLUE_DOMINANCE_DELTA = 30;
// Amber (#f59e0b) is an orange band: red dominant, green mid-high, blue low —
// distinguished from pure red by a meaningful green channel.
const MIN_AMBER_RED_CHANNEL = 140;
const MIN_AMBER_GREEN_CHANNEL = 70;
const MAX_AMBER_BLUE_CHANNEL = 90;
const AMBER_RED_BLUE_DOMINANCE_DELTA = 80;
const AMBER_GREEN_BLUE_DOMINANCE_DELTA = 30;

export function analyzeCanvasPixels(frame: CanvasRgbaFrame): CanvasPixelStats {
    assertValidFrame(frame);

    let nonBlankPixels = 0;
    let bluePixels = 0;
    let redPixels = 0;
    let greenPixels = 0;
    let amberPixels = 0;

    for (let pixelOffset = 0; pixelOffset < frame.rgba.length; pixelOffset += 4) {
        const red = frame.rgba[pixelOffset] ?? 0;
        const green = frame.rgba[pixelOffset + 1] ?? 0;
        const blue = frame.rgba[pixelOffset + 2] ?? 0;
        const alpha = frame.rgba[pixelOffset + 3] ?? 0;

        if (isNonBlankPixel(red, green, blue, alpha)) {
            nonBlankPixels += 1;
        }
        if (isBluePrimitivePixel(red, green, blue, alpha)) {
            bluePixels += 1;
        }
        if (isRedPrimitivePixel(red, green, blue, alpha)) {
            redPixels += 1;
        }
        if (isGreenPrimitivePixel(red, green, blue, alpha)) {
            greenPixels += 1;
        }
        if (isAmberPrimitivePixel(red, green, blue, alpha)) {
            amberPixels += 1;
        }
    }

    const totalPixels = frame.width * frame.height;
    return {
        width: frame.width,
        height: frame.height,
        totalPixels,
        nonBlankPixels,
        bluePixels,
        redPixels,
        greenPixels,
        amberPixels,
    };
}

/**
 * Mean RGB over sufficiently-opaque pixels. The tactics board fills the vast
 * majority of opaque pixels (units occupy <1% of the canvas), so this is a
 * stable representative of the rendered board colour — used to assert board
 * parity between the host and client windows. Returns black when no pixel is
 * opaque.
 */
export function summarizeOpaqueColor(frame: CanvasRgbaFrame): CanvasColor {
    assertValidFrame(frame);

    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let opaqueCount = 0;

    for (let pixelOffset = 0; pixelOffset < frame.rgba.length; pixelOffset += 4) {
        const alpha = frame.rgba[pixelOffset + 3] ?? 0;
        if (alpha < MIN_VISIBLE_ALPHA) {
            continue;
        }
        redSum += frame.rgba[pixelOffset] ?? 0;
        greenSum += frame.rgba[pixelOffset + 1] ?? 0;
        blueSum += frame.rgba[pixelOffset + 2] ?? 0;
        opaqueCount += 1;
    }

    if (opaqueCount === 0) {
        return { r: 0, g: 0, b: 0 };
    }

    return {
        r: Math.round(redSum / opaqueCount),
        g: Math.round(greenSum / opaqueCount),
        b: Math.round(blueSum / opaqueCount),
    };
}

/**
 * Decode a PNG screenshot buffer into a full-resolution RGBA frame entirely in
 * the test process. Pixel reads must never round-trip through the renderer:
 * on CI runners the software-GL renderer main thread is the contended
 * resource, and shipping decoded pixels over CDP cost seconds per read
 * (the original cause of the tactics-3d-render CI failures).
 */
export function decodePngToRgbaFrame(encodedPng: Buffer): CanvasRgbaFrame {
    const png = PNG.sync.read(encodedPng);
    return { width: png.width, height: png.height, rgba: png.data };
}

export function formatCanvasPixelStats(stats: CanvasPixelStats): string {
    return [
        `canvas=${stats.width}x${stats.height}`,
        `pixels=${stats.totalPixels}`,
        `nonblank=${stats.nonBlankPixels}`,
        `blue=${stats.bluePixels}`,
        `red=${stats.redPixels}`,
        `green=${stats.greenPixels}`,
        `amber=${stats.amberPixels}`,
    ].join(' ');
}

function assertValidFrame(frame: CanvasRgbaFrame): void {
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

function isNonBlankPixel(red: number, green: number, blue: number, alpha: number): boolean {
    return alpha >= MIN_VISIBLE_ALPHA && red + green + blue >= MIN_NONBLANK_CHANNEL_SUM;
}

function isBluePrimitivePixel(red: number, green: number, blue: number, alpha: number): boolean {
    return (
        alpha >= MIN_COLOR_ALPHA &&
        blue >= MIN_BLUE_CHANNEL &&
        blue >= red + BLUE_RED_DOMINANCE_DELTA &&
        blue >= green + BLUE_GREEN_DOMINANCE_DELTA
    );
}

function isRedPrimitivePixel(red: number, green: number, blue: number, alpha: number): boolean {
    return (
        alpha >= MIN_COLOR_ALPHA &&
        red >= MIN_RED_CHANNEL &&
        red >= green + RED_CHANNEL_DOMINANCE_DELTA &&
        red >= blue + RED_CHANNEL_DOMINANCE_DELTA
    );
}

function isGreenPrimitivePixel(red: number, green: number, blue: number, alpha: number): boolean {
    return (
        alpha >= MIN_COLOR_ALPHA &&
        green >= MIN_GREEN_CHANNEL &&
        green >= red + GREEN_RED_DOMINANCE_DELTA &&
        green >= blue + GREEN_BLUE_DOMINANCE_DELTA
    );
}

function isAmberPrimitivePixel(red: number, green: number, blue: number, alpha: number): boolean {
    return (
        alpha >= MIN_COLOR_ALPHA &&
        red >= MIN_AMBER_RED_CHANNEL &&
        green >= MIN_AMBER_GREEN_CHANNEL &&
        green < red &&
        blue <= MAX_AMBER_BLUE_CHANNEL &&
        red >= blue + AMBER_RED_BLUE_DOMINANCE_DELTA &&
        green >= blue + AMBER_GREEN_BLUE_DOMINANCE_DELTA
    );
}
