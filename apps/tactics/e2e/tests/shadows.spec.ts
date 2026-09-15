/**
 * The tactics board renders a VISIBLE shadow — measured in pixels, not flags.
 *
 * The spec repeats a whole off → on → off cycle until one cycle shows the shadow
 * appear, the shadow vanish again, and the two off frames agree — the last is
 * what keeps anything else moving on the board from passing for a shadow.
 */

import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures/direct-game.fixture';
import { countDarkenedPixels, decodePngToRgbaFrame } from '../helpers/canvas-pixels';
import type { CanvasRgbaFrame } from '../helpers/canvas-pixels';
import { waitForCanvasFrame } from '../helpers/canvas-probe';
import { GamePage } from '../pages/GamePage';

const GAME_ID = 'tactics';

/** A pixel counts as shadowed when its RGB sum fell by at least this much. */
const SHADOW_SUM_DROP = 45;

/** How many shadowed pixels mean "a shadow is on the board". */
const MIN_SHADOW_PIXELS = 200;

/** The budget for one frame to hold still. */
const STILL_FRAME_TIMEOUT_MS = 20_000;

/** The budget for a whole cycle to come out clean, retries included. */
const CYCLE_TIMEOUT_MS = 120_000;

// This spec only exercises the host window; no client process is needed.
test.use({ passAndPlay: true });

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
        { gameId: GAME_ID, tier: shadowQuality },
    );
}

/** A frame of the board taken once two consecutive frames are identical. */
async function stillBoardFrame(page: Page, game: GamePage): Promise<CanvasRgbaFrame> {
    let previous = await game.tacticsCanvas.screenshot({ type: 'png' });
    let still: Buffer | null = null;
    await expect
        .poll(
            async () => {
                await waitForCanvasFrame(page);
                const next = await game.tacticsCanvas.screenshot({ type: 'png' });
                still = next.equals(previous) ? next : null;
                previous = next;
                return still !== null;
            },
            { timeout: STILL_FRAME_TIMEOUT_MS },
        )
        .toBe(true);

    if (still === null) {
        throw new Error('The tactics board never held still for two frames.');
    }
    return decodePngToRgbaFrame(still);
}

test.describe('Tactics shadows', () => {
    test('a unit casts a shadow when shadow quality is on and drops it at off', async ({
        hostWindow,
    }) => {
        test.slow();

        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible();
        await game.assertTacticsCanvasIsNonBlank();

        let lastCycle = 'no cycle completed';
        try {
            await expect
                .poll(
                    async () => {
                        await setShadowQuality(hostWindow, 'off');
                        const off = await stillBoardFrame(hostWindow, game);
                        await setShadowQuality(hostWindow, 'medium');
                        const on = await stillBoardFrame(hostWindow, game);
                        await setShadowQuality(hostWindow, 'off');
                        const offAgain = await stillBoardFrame(hostWindow, game);

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
