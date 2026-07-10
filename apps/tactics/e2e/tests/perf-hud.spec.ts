/**
 * F41 — perf-hud.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies Performance HUD toggle behaviour:
 *   - HUD is hidden by default (F3 not pressed, showPerfHud=false)
 *   - Pressing F3 makes the HUD visible
 *   - Pressing F3 again hides the HUD
 *   - GL metrics (FPS, draw calls, triangles) go live during a match — pins the
 *     PerfProbe mount inside the game's <Canvas> (metrics froze at 0 when the
 *     probe was only mounted in the never-rendered GameCanvas)
 *
 * `settings.gameplay.showPerfHud` is explicitly set to `false` before assertions
 * so the settings force-visible path cannot mask the F3 toggle behaviour.
 *
 * Invariant #65: PerfHud is a DOM overlay outside the R3F canvas; toggled via
 * perfStore.toggle() which is wired to the `engine:toggle-perf-hud` input action.
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
});
