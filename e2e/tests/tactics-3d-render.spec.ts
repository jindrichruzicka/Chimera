/**
 * Issue #641 — Add visual validation for tactics 3D rendering.
 *
 * Verifies the R3F tactics canvas renders projected state as pixels:
 *   - the canvas is nonblank after match start
 *   - the local primitive is visible as blue pixels
 *   - the hidden opponent primitive has no red pixels before reveal
 *   - proximity movement reveals the opponent as red pixels
 *
 * Invariant #3: the visual checks inspect rendered pixels only; they do not
 * read GameSnapshot or hidden debug overlays.
 * Invariant #57: camera framing remains renderer-local.
 */
import { test, expect } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

test.use({ passAndPlay: true });

test.describe('Tactics 3D render validation', () => {
    test('renders blue local primitive before reveal and red opponent primitive after reveal', async ({
        hostWindow,
    }) => {
        const game = new GamePage(hostWindow);

        await expect(game.canvas).toBeVisible({ timeout: 15_000 });

        await game.assertTacticsCanvasIsNonBlank();
        await game.assertTacticsCanvasHasBluePrimitive();
        await game.assertTacticsCanvasHasNoRedPrimitive();

        await game.selectOwnedPrimitive();
        await game.assertTacticsCanvasHasBluePrimitive();
        await game.clickTacticsGridPoint({ x: 1, y: 0 });

        await game.assertTacticsCanvasHasRedPrimitive();
    });
});
