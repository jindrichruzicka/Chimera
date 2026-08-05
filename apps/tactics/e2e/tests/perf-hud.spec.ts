/**
 * F41 — perf-hud.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies Performance HUD toggle behaviour:
 *   - HUD is hidden by default (F3 not pressed, showPerfHud=false)
 *   - Pressing F3 makes the HUD visible
 *   - Pressing F3 again hides the HUD
 *   - GL metrics (FPS, draw calls, triangles) go live during a match — pins the
 *     PerfProbe mount inside the RENDERED game canvas (metrics froze at 0 when
 *     the probe was only mounted in a GameCanvas nothing rendered; the board now
 *     renders through GameCanvas, which mounts the probe)
 *   - Under `display.targetFps: 30` the canvas still PAINTS and the reported FPS
 *     stays bounded. A capped canvas runs `frameloop: "never"` and renders
 *     nothing until the engine's loop driver calls `advance()`, so the paint
 *     guard is read from canvas PIXELS (the HUD's own metrics survive a dead
 *     driver as a stale sample), and the FPS bound guards against the cap
 *     silently not applying.
 *
 * `settings.gameplay.showPerfHud` is explicitly set to `false` before assertions
 * so the settings force-visible path cannot mask the F3 toggle behaviour.
 *
 * PerfHud is a DOM overlay outside the R3F canvas, toggled via perfStore.toggle()
 * which is wired to the `engine:toggle-perf-hud` input action.
 */

import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

const GAME_ID = 'tactics';

// This spec only exercises the host window; no client process is needed.
test.use({ passAndPlay: true });

type RendererGlobal = typeof globalThis & {
    readonly __chimera: {
        readonly settings: {
            update(gameId: string, patch: Record<string, unknown>): Promise<unknown>;
        };
    };
};

test.describe('Performance HUD', () => {
    test('is hidden by default, shown by F3, and hidden again by second F3', async ({
        hostWindow,
    }) => {
        const game = new GamePage(hostWindow);

        // Ensure the settings force-visible path is off before asserting toggle behaviour.
        await hostWindow.evaluate(async (gameId: string) => {
            await (globalThis as RendererGlobal).__chimera.settings.update(gameId, {
                gameplay: { showPerfHud: false },
            });
        }, GAME_ID);

        // HUD must be absent before any toggle.
        await expect(game.perfHud).not.toBeVisible();

        // First F3 key press shows the HUD.
        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).toBeVisible();

        // Second F3 key press hides the HUD again.
        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).not.toBeVisible();
    });

    test('renders the minimap overlay canvas beside the board with the HUD still live', async ({
        hostWindow,
    }) => {
        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible();

        // Two canvas elements: the board plus the minimap overlay, both
        // mounted through the public GameCanvas root.
        await expect(game.canvas.locator('canvas')).toHaveCount(2);

        // The minimap sits INSIDE the board's bottom-right quadrant with a
        // real extent — not merely "visible somewhere at some size".
        const minimap = hostWindow.getByTestId('tactics-minimap');
        await expect(minimap).toBeVisible();
        const board = await game.tacticsCanvas.boundingBox();
        const box = await minimap.boundingBox();
        if (board === null || box === null) {
            throw new Error('Expected both the board canvas and the minimap to lay out');
        }
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThan(board.x + board.width / 2);
        expect(box.y).toBeGreaterThan(board.y + board.height / 2);
        expect(box.x + box.width).toBeLessThanOrEqual(board.x + board.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(board.y + board.height + 1);
        // Readout only: the overlay must not swallow bottom-right board clicks.
        await expect(minimap).toHaveCSS('pointer-events', 'none');

        // The perf HUD still publishes live metrics with the overlay mounted
        // (probe exclusivity per role is pinned at unit level, not re-derived
        // here).
        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).toBeVisible();
        await expect
            .poll(async () => (await game.perfFps.textContent()) ?? '', { timeout: 30_000 })
            .not.toBe('FPS: 0');
        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).not.toBeVisible();
    });

    test('shows live GL metrics during a match (PerfProbe mounted in the game canvas)', async ({
        hostWindow,
    }) => {
        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible();

        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).toBeVisible();

        // PerfProbe publishes every 500 ms from inside the R3F frame loop; until it
        // does, every GL metric sits at its initial zero. Assert the zero forms go
        // away — never exact values (CI renders slower and with different geometry).
        // Generous poll budgets absorb the ~10× slower CI runner.
        await expect
            .poll(async () => (await game.perfFps.textContent()) ?? '', { timeout: 30_000 })
            .not.toBe('FPS: 0');
        await expect
            .poll(async () => (await game.perfDrawCalls.textContent()) ?? '', { timeout: 30_000 })
            .not.toBe('Draw calls: 0');
        await expect
            .poll(async () => (await game.perfTriangles.textContent()) ?? '', { timeout: 30_000 })
            .not.toBe('Triangles: 0');
    });

    test('paints and stays under the cap with display.targetFps 30', async ({ hostWindow }) => {
        const game = new GamePage(hostWindow);
        await expect(game.canvas).toBeVisible();

        await hostWindow.evaluate(async (gameId: string) => {
            await (globalThis as RendererGlobal).__chimera.settings.update(gameId, {
                display: { targetFps: 30 },
            });
        }, GAME_ID);

        // (a) The canvas paints, read from PIXELS rather than from the HUD. The
        // HUD cannot serve as this guard: `targetFps` defaults to 60, so the
        // canvas was already `frameloop: 'never'` at boot and perfStore holds a
        // non-zero draw-call sample from before this test changed anything — a
        // driver that died at the cap change would leave that stale sample in
        // place and satisfy any assertion made against it.
        await game.assertTacticsCanvasIsNonBlank();

        // (b) …and it is still presenting NEW content after the cap change, not
        // showing a frozen framebuffer: selecting a unit must alter the pixels.
        // Inline rather than GamePage.assertOwnedSelectionFeedbackChangesCanvas():
        // that helper settles on three requestAnimationFrame callbacks, which are
        // NATIVE frames — under a 30 fps cap on a 120 Hz panel all three can
        // elapse inside ONE advanced frame, leaving it comparing a framebuffer
        // with itself. A bounded poll holds at any cap.
        const beforeSelection = await game.tacticsCanvas.screenshot();
        await game.selectOwnedPrimitive();
        await expect
            .poll(async () => (await game.tacticsCanvas.screenshot()).equals(beforeSelection), {
                timeout: 15_000,
            })
            .toBe(false);

        await hostWindow.keyboard.press('F3');
        await expect(game.perfHud).toBeVisible();

        // (c) The reported rate is live and bounded. Form, not value: the CI
        // runner is roughly 10x slower, so the floor is only "moving at all".
        await expect
            .poll(async () => readMetric(await game.perfFps.textContent()), { timeout: 30_000 })
            .toBeGreaterThan(0);

        // Converge first: right after the cap changes the 1 s window still holds
        // 16.7 ms frames alongside 33.3 ms ones, so the reading decays through
        // the ceiling rather than starting below it.
        await expect
            .poll(async () => readMetric(await game.perfFps.textContent()), { timeout: 30_000 })
            .toBeLessThanOrEqual(FPS_CEILING_AT_30_CAP);

        // Then settled, not first-satisfying: `fps` counts frames over
        // accumulated delta, so one hitch inside the window can drop an
        // uncapped reading under the ceiling for a single sample. Take three
        // readings a publish interval apart and require every one of them.
        const readings: number[] = [];
        for (let i = 0; i < 3; i++) {
            await hostWindow.waitForTimeout(PUBLISH_INTERVAL_MS + 200);
            readings.push(readMetric(await game.perfFps.textContent()));
        }
        for (const fps of readings) {
            expect(fps, `settled FPS readings: ${readings.join(', ')}`).toBeLessThanOrEqual(
                FPS_CEILING_AT_30_CAP,
            );
        }
    });
});

/**
 * A 30 fps cap plus jitter. The contrast this bound has to survive is 30-vs-60:
 * the canvas is never uncapped in this spec, since `display.targetFps` defaults
 * to 60, so a cap that silently stopped applying reports the previous 60 and
 * trips this — as does any panel-rate loop at 60/120/144.
 */
const FPS_CEILING_AT_30_CAP = 45;

/**
 * Mirrors `PUBLISH_INTERVAL_MS` in `renderer/components/shell/perf/PerfProbe.tsx`
 * — an e2e cannot import renderer internals, so this is a copy. A new sample
 * cannot appear faster than this.
 */
const PUBLISH_INTERVAL_MS = 500;

/**
 * Read the value of a `Label: 42` HUD row, anchored past the colon so a label
 * containing digits (`Frame p95: 8.3 ms`) yields the value and not the label.
 * Returns -1 when the row carries no number at all — an unmeasured `—` row.
 */
function readMetric(text: string | null): number {
    const match = /:\s*(-?\d+(?:\.\d+)?)/.exec(text ?? '');
    return match ? Number(match[1]) : -1;
}
