import type { Locator, Page } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CANVAS_PIXEL_TIMEOUT_MS,
    MIN_COLOR_PIXELS,
    MIN_COLOR_PIXEL_RATIO,
    minimumColorPixels,
    readCanvasPixelStats,
    waitForCanvasFrame,
    waitForCanvasPixelExpectation,
} from './canvas-probe';
import type { CanvasPixelStats } from './canvas-pixels';
import { encodeSolidPng } from './solid-png';

/**
 * These budgets and counts are the reason `canvas-probe` exists as one module,
 * so they are pinned here rather than left to a full Playwright run — which is
 * the only other thing that reads them, and the most expensive gate in the
 * repo. The measured rationale behind each number lives in `canvas-probe`'s
 * own JSDoc and is not restated per test.
 */

const MAGENTA = { r: 255, g: 0, b: 255, a: 255 } as const;

// `expect.poll` is the seam between the module and Playwright, and the
// module's contract with it has three legs: the budget it HANDS the poller,
// the verdict it asks the poller to converge on, and how it reacts when the
// poller gives up. The fake records the budget, compares verdicts as the
// real matcher does, and compresses the real timeout into `probeRuns`
// runs before throwing — the real `expect.poll` likewise keeps polling on a
// mismatch and THROWS at timeout.
const pollFake = vi.hoisted(() => ({
    calls: [] as { readonly timeout: number | undefined }[],
    probeRuns: 1,
    reset(): void {
        pollFake.calls = [];
        pollFake.probeRuns = 1;
    },
}));

vi.mock('@playwright/test', () => ({
    expect: {
        poll: (probe: () => Promise<unknown>, options?: { readonly timeout?: number }) => {
            pollFake.calls.push({ timeout: options?.timeout });
            return {
                async toBe(expected: unknown): Promise<void> {
                    for (let run = 0; run < pollFake.probeRuns; run += 1) {
                        if ((await probe()) === expected) {
                            return;
                        }
                    }
                    throw new Error('poll budget exhausted (fake)');
                },
            };
        },
    },
}));

beforeEach(() => {
    pollFake.reset();
});

function statsFor(width: number, height: number): CanvasPixelStats {
    return {
        width,
        height,
        totalPixels: width * height,
        nonBlankPixels: 0,
        bluePixels: 0,
        redPixels: 0,
        greenPixels: 0,
        amberPixels: 0,
        magentaPixels: 0,
    };
}

function fakePage(): { readonly page: Page; readonly waitForFunctionArgs: unknown[][] } {
    const waitForFunctionArgs: unknown[][] = [];
    const page = {
        waitForFunction: vi.fn((...args: unknown[]) => {
            waitForFunctionArgs.push(args);
            return Promise.resolve();
        }),
    } as unknown as Page;
    return { page, waitForFunctionArgs };
}

/** A canvas whose successive screenshots step through `frames`, then repeat the last. */
function fakeCanvas(frames: readonly Buffer[]): Locator {
    let call = 0;
    return {
        screenshot: vi.fn(() => {
            const frame = frames[Math.min(call, frames.length - 1)];
            call += 1;
            return Promise.resolve(frame);
        }),
    } as unknown as Locator;
}

describe('minimumColorPixels', () => {
    it('scales with the canvas at one pixel in ten thousand', () => {
        // A coarser ratio would let a colour count as "on screen" from a
        // handful of stray anti-aliased pixels.
        expect(minimumColorPixels(statsFor(1000, 1000))).toBe(100);
        expect(MIN_COLOR_PIXEL_RATIO).toBe(0.0001);
    });

    it('never drops below the floor on a small canvas', () => {
        // The floor is pinned as a LITERAL: comparing the function's output
        // against MIN_COLOR_PIXELS itself holds for every value of the
        // constant, and raising the floor raises the "colour is on screen"
        // bar for every consumer.
        expect(minimumColorPixels(statsFor(10, 10))).toBe(2);
        expect(MIN_COLOR_PIXELS).toBe(2);
    });

    it('takes the larger of floor and ratio, never the smaller', () => {
        expect(minimumColorPixels(statsFor(1000, 1000))).toBeGreaterThan(MIN_COLOR_PIXELS);
    });
});

describe('CANVAS_PIXEL_TIMEOUT_MS', () => {
    it('is the measured CI poll budget', () => {
        // Why 45s fits worst-case CI screenshots: canvas-probe's module JSDoc.
        // Pinned as a literal so a budget edit is a deliberate act, in either
        // direction.
        expect(CANVAS_PIXEL_TIMEOUT_MS).toBe(45_000);
    });
});

describe('waitForCanvasFrame', () => {
    /**
     * Runs the browser-side predicate `waitForCanvasFrame` hands to
     * `page.waitForFunction` against a counting `requestAnimationFrame`,
     * reporting how many frames it waited for.
     *
     * The predicate is recompiled from its SOURCE before running: Playwright
     * transfers a `waitForFunction` predicate as `String(pageFunction)`, so a
     * closure over module scope is lost in the browser. Compiling from source
     * reproduces that — extracting the frame count to a module constant would
     * pass a direct invocation here and throw ReferenceError only under the
     * full Playwright gate, the exact gate this suite exists to avoid.
     */
    async function countFramesAwaited(): Promise<number> {
        const { page, waitForFunctionArgs } = fakePage();
        await waitForCanvasFrame(page);

        const source = String(waitForFunctionArgs[0]?.[0]);
        // The eval IS the assertion: Playwright transfers the predicate as
        // source, and only compiling from source catches a closure over
        // module scope.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const transferred = new Function(`return ${source}`)() as () => Promise<boolean>;

        let scheduled = 0;
        const previous = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
        (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
            callback: () => void,
        ): number => {
            scheduled += 1;
            setTimeout(callback, 0);
            return scheduled;
        };
        try {
            await transferred();
        } finally {
            (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previous;
        }
        return scheduled;
    }

    it('waits three animation frames', async () => {
        // One frame is not enough to settle a just-committed R3F render; the
        // count is the whole content of this helper.
        expect(await countFramesAwaited()).toBe(3);
    });

    it('bounds the settle itself with the 5s inner budget', async () => {
        // Without its own bound, a stalled rAF chain (an occluded window
        // stops presenting) would consume the caller's whole poll budget in
        // one settle.
        const { page, waitForFunctionArgs } = fakePage();

        await waitForCanvasFrame(page);

        expect(waitForFunctionArgs[0]?.[2]).toEqual({ timeout: 5_000 });
    });
});

describe('readCanvasPixelStats', () => {
    it('settles frames BEFORE screenshotting, and classifies the decoded frame', async () => {
        const order: string[] = [];
        const page = {
            waitForFunction: vi.fn(() => {
                order.push('settle');
                return Promise.resolve();
            }),
        } as unknown as Page;
        const canvas = {
            screenshot: vi.fn(() => {
                order.push('screenshot');
                return Promise.resolve(encodeSolidPng(4, 5, MAGENTA));
            }),
        } as unknown as Locator;

        const stats = await readCanvasPixelStats(page, canvas);

        // Screenshotting an unsettled canvas reads the previous frame — the
        // failure mode this ordering exists to prevent.
        expect(order).toEqual(['settle', 'screenshot']);
        expect(stats.totalPixels).toBe(20);
        expect(stats.magentaPixels).toBe(20);
    });
});

describe('waitForCanvasPixelExpectation', () => {
    it('polls with the shared budget when the caller passes no timeout', async () => {
        // ModelShowcasePage's magenta assertion passes no timeoutMs, so this
        // default IS its poll budget: a broken default with the constant
        // intact breaks that assertion invisibly.
        const { page } = fakePage();
        const canvas = fakeCanvas([encodeSolidPng(4, 4, MAGENTA)]);

        await waitForCanvasPixelExpectation({
            page,
            canvas,
            predicate: () => true,
            failureMessage: 'unused',
        });

        expect(pollFake.calls).toEqual([{ timeout: CANVAS_PIXEL_TIMEOUT_MS }]);
    });

    it('polls with the caller-passed timeout when one is given', async () => {
        const { page } = fakePage();
        const canvas = fakeCanvas([encodeSolidPng(4, 4, MAGENTA)]);

        await waitForCanvasPixelExpectation({
            page,
            canvas,
            predicate: () => true,
            failureMessage: 'unused',
            timeoutMs: 123,
        });

        expect(pollFake.calls).toEqual([{ timeout: 123 }]);
    });

    it('reports the LAST observed stats when the budget expires, not a fresh read', async () => {
        // A fresh read after the poll gave up describes a frame the poll
        // never evaluated; the report must carry the frame that actually
        // failed the predicate. The canvas shrinks every screenshot so the
        // two are distinguishable: two probe runs observe 4×4 then 3×3, and
        // a post-failure fresh read would see 2×2.
        pollFake.probeRuns = 2;
        const { page } = fakePage();
        const canvas = fakeCanvas([
            encodeSolidPng(4, 4, MAGENTA),
            encodeSolidPng(3, 3, MAGENTA),
            encodeSolidPng(2, 2, MAGENTA),
        ]);

        await expect(
            waitForCanvasPixelExpectation({
                page,
                canvas,
                predicate: () => false,
                failureMessage: 'probe failed',
            }),
        ).rejects.toThrow(/probe failed\. canvas=3x3/);
    });
});
