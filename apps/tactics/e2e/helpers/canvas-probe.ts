import { expect, type Locator, type Page } from '@playwright/test';

import {
    analyzeCanvasPixels,
    decodePngToRgbaFrame,
    formatCanvasPixelStats,
    type CanvasPixelStats,
} from './canvas-pixels';

/**
 * Reading pixels out of a live R3F canvas, shared by every page object that
 * does it.
 *
 * The budgets and the decode strategy below are the whole reason this is one
 * module rather than a copy per page object: they encode measured CI numbers,
 * and a second hand-carried copy of a measured number silently diverges from
 * the run it came from.
 *
 * One pixel read = rAF settle + `locator.screenshot()`. On CI runners (2-core,
 * Xvfb + software GL) a single screenshot alone was measured at 6–11s, so the
 * poll budget must fit several worst-case iterations or the predicate never
 * gets evaluated at all.
 */
export const CANVAS_PIXEL_TIMEOUT_MS = 45_000;

/** A colour counts as present at 1 pixel in 10 000, with a floor for tiny canvases. */
export const MIN_COLOR_PIXEL_RATIO = 0.0001;
export const MIN_COLOR_PIXELS = 2;

/** The minimum pixel count that means "this colour is on screen" for `stats`. */
export function minimumColorPixels(stats: CanvasPixelStats): number {
    return Math.max(MIN_COLOR_PIXELS, Math.floor(stats.totalPixels * MIN_COLOR_PIXEL_RATIO));
}

/** Waits three animation frames, to settle the compositor before a pixel read. */
export async function waitForCanvasFrame(page: Page): Promise<void> {
    await page.waitForFunction(
        () =>
            new Promise<boolean>((resolve) => {
                const scheduleFrame = (
                    globalThis as typeof globalThis & {
                        readonly requestAnimationFrame: (callback: () => void) => number;
                    }
                ).requestAnimationFrame;
                let framesRemaining = 3;
                const waitForFrame = (): void => {
                    framesRemaining -= 1;
                    if (framesRemaining <= 0) {
                        resolve(true);
                        return;
                    }
                    scheduleFrame(waitForFrame);
                };

                scheduleFrame(waitForFrame);
            }),
        undefined,
        { timeout: 5_000 },
    );
}

/**
 * Screenshot `canvas` and classify its pixels.
 *
 * Decoding happens in the TEST process (pngjs), never via `page.evaluate`: on
 * CI the renderer main thread is saturated by software-GL R3F rendering, and a
 * CDP round-trip carrying the decoded pixel payload was measured at ~8s per
 * read, blowing the poll budget.
 */
export async function readCanvasPixelStats(page: Page, canvas: Locator): Promise<CanvasPixelStats> {
    await waitForCanvasFrame(page);
    const screenshot = await canvas.screenshot({ type: 'png' });
    return analyzeCanvasPixels(decodePngToRgbaFrame(screenshot));
}

export interface CanvasPixelExpectationOptions {
    readonly page: Page;
    readonly canvas: Locator;
    readonly predicate: (stats: CanvasPixelStats) => boolean;
    /** Prefixed to the reported stats when the poll never satisfies `predicate`. */
    readonly failureMessage: string;
    readonly timeoutMs?: number;
}

/**
 * Poll `canvas` until `predicate` holds, then return. On timeout, throw a
 * failure that reports the LAST observed stats — a bare poll timeout says
 * nothing about what was actually on screen.
 */
export async function waitForCanvasPixelExpectation({
    page,
    canvas,
    predicate,
    failureMessage,
    timeoutMs = CANVAS_PIXEL_TIMEOUT_MS,
}: CanvasPixelExpectationOptions): Promise<void> {
    let lastStats: CanvasPixelStats | null = null;
    try {
        await expect
            .poll(
                async () => {
                    lastStats = await readCanvasPixelStats(page, canvas);
                    return predicate(lastStats);
                },
                { timeout: timeoutMs },
            )
            .toBe(true);
    } catch (error) {
        const stats = lastStats ?? (await readCanvasPixelStats(page, canvas));
        throw new Error(`${failureMessage}. ${formatCanvasPixelStats(stats)}.`, { cause: error });
    }
}
