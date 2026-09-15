/**
 * The action shell background renders a VISIBLE shadow — measured in pixels,
 * not flags.
 *
 * The background mounts its own overlay canvas on the menu route, so it resolves
 * its own shadow configuration rather than inheriting a match canvas's.
 *
 * The spec repeats a whole off → on → off cycle until one cycle shows the
 * shadows appear, the shadows vanish again, and the two off frames agree — the
 * last is what keeps a camera move from passing for a shadow.
 */

import type { Locator, Page } from '@playwright/test';

import { ACTION_GAME_ID } from '@chimera-engine/action/simulation/constants.js';
import { expect, test } from '../fixtures/electron.fixture';
import { countDarkenedPixels, decodePngToRgbaFrame } from '../helpers/canvas-darkening';
import type { CanvasRgbaFrame } from '../helpers/canvas-darkening';
import { SHELL_LOAD_TIMEOUT_MS } from '../helpers/enter-match';
import { ActionShellBackgroundPage } from '../pages/ActionShellBackgroundPage';

test.use({ actionPort: '7820' });

/**
 * A pixel counts as shadowed when its RGB sum fell by at least this much.
 *
 * Low, because the arena floor is a dark slate: a shadow on it takes away far
 * less brightness than it would on a light surface. Two frames of an unchanged
 * scene are byte-identical, so a low threshold picks up no noise.
 */
const SHADOW_SUM_DROP = 16;

/** How many shadowed pixels mean "a shadow is in the scene". */
const MIN_SHADOW_PIXELS = 200;

/** The budget for one frame to hold still. */
const STILL_FRAME_TIMEOUT_MS = 20_000;

/** The budget for a whole cycle to come out clean, retries included. */
const CYCLE_TIMEOUT_MS = 120_000;

type RendererGlobal = typeof globalThis & {
    readonly __chimera: {
        readonly settings: {
            update(gameId: string, patch: Record<string, unknown>): Promise<unknown>;
        };
    };
};

async function setShadowQuality(page: Page, shadowQuality: 'off' | 'medium'): Promise<void> {
    await page.evaluate(
        async ({ gameId, tier }) => {
            await (globalThis as RendererGlobal).__chimera.settings.update(gameId, {
                display: { shadowQuality: tier },
            });
        },
        { gameId: ACTION_GAME_ID, tier: shadowQuality },
    );
}

/** Resolves after two animation frames, so the latest change has been drawn. */
async function settleFrames(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                // Cast rather than a DOM lib: this callback runs in the page, but it
                // is type-checked by a program that carries no DOM types.
                const scheduleFrame = (
                    globalThis as typeof globalThis & {
                        readonly requestAnimationFrame: (callback: () => void) => number;
                    }
                ).requestAnimationFrame;
                scheduleFrame(() => scheduleFrame(() => resolve()));
            }),
    );
}

/** A frame of `scene` taken once two consecutive frames are identical. */
async function stillFrame(page: Page, scene: Locator): Promise<CanvasRgbaFrame> {
    let previous = await scene.screenshot({ type: 'png' });
    let still: Buffer | null = null;
    await expect
        .poll(
            async () => {
                await settleFrames(page);
                const next = await scene.screenshot({ type: 'png' });
                still = next.equals(previous) ? next : null;
                previous = next;
                return still !== null;
            },
            { timeout: STILL_FRAME_TIMEOUT_MS },
        )
        .toBe(true);

    if (still === null) {
        throw new Error('The shell background never held still for two frames.');
    }
    return decodePngToRgbaFrame(still);
}

test.describe('Action shadows', () => {
    test('the shell background casts shadows when shadow quality is on and drops them at off', async ({
        mainWindow,
    }) => {
        test.slow();

        const background = new ActionShellBackgroundPage(mainWindow);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);

        let lastCycle = 'no cycle completed';
        try {
            await expect
                .poll(
                    async () => {
                        await setShadowQuality(mainWindow, 'off');
                        const off = await stillFrame(mainWindow, background.scene);
                        await setShadowQuality(mainWindow, 'medium');
                        const on = await stillFrame(mainWindow, background.scene);
                        await setShadowQuality(mainWindow, 'off');
                        const offAgain = await stillFrame(mainWindow, background.scene);

                        const appeared = countDarkenedPixels(off, on, SHADOW_SUM_DROP);
                        const vanished = countDarkenedPixels(offAgain, on, SHADOW_SUM_DROP);
                        const drift =
                            countDarkenedPixels(off, offAgain, SHADOW_SUM_DROP) +
                            countDarkenedPixels(offAgain, off, SHADOW_SUM_DROP);
                        lastCycle = `appeared=${appeared} vanished=${vanished} drift=${drift}`;

                        return (
                            appeared >= MIN_SHADOW_PIXELS &&
                            vanished >= MIN_SHADOW_PIXELS &&
                            drift < MIN_SHADOW_PIXELS
                        );
                    },
                    { timeout: CYCLE_TIMEOUT_MS },
                )
                .toBe(true);
        } catch (error) {
            throw new Error(`No clean off/on/off shadow cycle. Last cycle: ${lastCycle}.`, {
                cause: error,
            });
        }
    });
});
