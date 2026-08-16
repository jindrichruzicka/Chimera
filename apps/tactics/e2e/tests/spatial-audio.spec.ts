/**
 * spatial-audio.spec.ts
 * §4.25 Audio System → Spatial Audio
 *
 * The F84 adoption's end-to-end proof in the real runtime. No spec can hear
 * panning, so this one asserts the observable facts the board mirrors into
 * hidden DOM markers (the way `TacticsAmbience` mirrors `data-track`) — and it
 * asserts their VALUES, not merely that nothing warned:
 *
 *   1. The LISTENER marker holds the board-centre focus `(1, 0, 0)` — the point
 *      the camera looks AT. The camera itself hangs at `(1, 12, 0)`, so the
 *      middle component is the tell that the pose was never derived from the
 *      camera — the load-bearing design decision of the feature.
 *   2. After a move and an attack, the positioned-SFX marker names the exact
 *      clip each action played and a real world position on the board plane
 *      (`y === 0` — units act from tiles, not from everywhere).
 */
import { expect, test } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

function parseWorldTriple(value: string | null): readonly number[] {
    return (value ?? '').split(',').map(Number);
}

test.describe('Spatial audio adoption', () => {
    test('the board mirrors a non-camera listener pose and positioned SFX values', async ({
        hostWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);

        const listener = hostWindow.getByTestId('tactics-audio-listener');
        await expect(listener).toHaveAttribute('data-position', '1,0,0');

        await hostGame.assertOwnedSelectionFeedbackChangesCanvas();
        await hostGame.moveSelectedPrimitiveNearOpponent();

        const sfx = hostWindow.getByTestId('tactics-audio-sfx');
        await expect(sfx).toHaveAttribute('data-ref', 'tactics/audio/sfx/step.wav');
        const stepPosition = parseWorldTriple(await sfx.getAttribute('data-position'));
        expect(stepPosition).toHaveLength(3);
        expect(stepPosition.every(Number.isFinite)).toBe(true);
        expect(stepPosition[1]).toBe(0);

        await hostGame.attackAdjacentEnemy();

        await expect(sfx).toHaveAttribute('data-ref', 'tactics/audio/sfx/sword-hit.wav');
        const hitPosition = parseWorldTriple(await sfx.getAttribute('data-position'));
        expect(hitPosition).toHaveLength(3);
        expect(hitPosition.every(Number.isFinite)).toBe(true);
        expect(hitPosition[1]).toBe(0);
    });
});
