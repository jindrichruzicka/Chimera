export interface CanvasRgbaFrame {
    readonly width: number;
    readonly height: number;
    readonly rgba: readonly number[];
}

export interface CanvasPixelStats {
    readonly width: number;
    readonly height: number;
    readonly totalPixels: number;
    readonly nonBlankPixels: number;
    readonly bluePixels: number;
    readonly redPixels: number;
}

const MIN_VISIBLE_ALPHA = 32;
const MIN_COLOR_ALPHA = 80;
const MIN_NONBLANK_CHANNEL_SUM = 48;
const MIN_BLUE_CHANNEL = 90;
const MIN_RED_CHANNEL = 100;
const BLUE_RED_DOMINANCE_DELTA = 40;
const BLUE_GREEN_DOMINANCE_DELTA = 30;
const RED_CHANNEL_DOMINANCE_DELTA = 40;

export function analyzeCanvasPixels(frame: CanvasRgbaFrame): CanvasPixelStats {
    assertValidFrame(frame);

    let nonBlankPixels = 0;
    let bluePixels = 0;
    let redPixels = 0;

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
    }

    const totalPixels = frame.width * frame.height;
    return {
        width: frame.width,
        height: frame.height,
        totalPixels,
        nonBlankPixels,
        bluePixels,
        redPixels,
    };
}

export function formatCanvasPixelStats(stats: CanvasPixelStats): string {
    return [
        `canvas=${stats.width}x${stats.height}`,
        `pixels=${stats.totalPixels}`,
        `nonblank=${stats.nonBlankPixels}`,
        `blue=${stats.bluePixels}`,
        `red=${stats.redPixels}`,
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
