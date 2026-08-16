/**
 * spatial-audio-observer.spec.ts
 * §4.25 Audio System → Spatial Audio
 *
 * The seat that acts is not the seat this spec watches.
 *
 * `spatial-audio.spec.ts` proves the acting client's marker in a single window.
 * That is exactly the proof F84 had, and it is why F84's regression survived a
 * per-task review: the board's positioned SFX played at the intent site, which
 * only the acting client ever reaches, so an opponent's move was silent on the
 * client and no single-window spec could see it.
 *
 * So this one drives the HOST and asserts the CLIENT's marker. The client
 * dispatches nothing for the whole test — every cue it shows was derived from a
 * projection it received, which is the mechanism under test.
 *
 * It takes two moves to get there:
 *
 *   1. Host (0, 0) → (1, 0), which is adjacent to the client's unit at (2, 0)
 *      and trips the proximity reveal. The host's unit ENTERS the client's
 *      projection here. The client stays silent — with no previous tile for that
 *      unit, the delta has no move to describe.
 *   2. Host (1, 0) → (1, 1). Now the host's unit is one the client already had,
 *      so the client hears the step, positioned on the tile it arrived at.
 *
 * The observed verb is the step; the hit an observer hears on its own unit is
 * left to the board's unit tests.
 */
import { expect, test } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';

const STEP_CLIP = 'tactics/audio/sfx/step.wav';

function parseWorldTriple(value: string | null): readonly number[] {
    return (value ?? '').split(',').map(Number);
}

test.describe('Spatial audio — the observing client', () => {
    // The fixture's default, stated anyway: which seat moves first is what makes
    // the host the actor and the client the observer, so it is not incidental here.
    test.use({ firstPlayer: 'host' });

    test("plays the host's move on the client, which dispatched nothing", async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        const clientSfx = clientWindow.getByTestId('tactics-audio-sfx');

        // Both boards are up and neither has been owed a cue yet.
        await expect(clientWindow.getByTestId('tactics-audio-listener')).toHaveAttribute(
            'data-position',
            '1,0,0',
        );
        await expect(clientSfx).toHaveCount(0);

        // Move 1 — the reveal. The host's unit enters the client's projection.
        await hostGame.moveOwnedUnitTo({ x: 1, y: 0 });
        // Gate the silence on a state that ENDED on the OBSERVING side. The move
        // helper polls the host's own projection, and `toHaveCount(0)` passes on
        // its first evaluation, so the absence needs a client-side arrival to be
        // an absence OF anything.
        await clientGame.waitForProjectedOpponentUnitAt({ x: 1, y: 0 });
        await expect(clientSfx).toHaveCount(0);

        // Move 2 — a unit the client already had, so this one is audible to it.
        await hostGame.moveOwnedUnitTo({ x: 1, y: 1 });

        await expect(clientSfx).toHaveAttribute('data-ref', STEP_CLIP);
        const position = parseWorldTriple(await clientSfx.getAttribute('data-position'));
        expect(position).toHaveLength(3);
        expect(position.every(Number.isFinite)).toBe(true);
        // The tile the host ARRIVED on, in world coordinates: grid.y maps to
        // world Z, and units act from the board plane rather than from anywhere.
        expect(position).toEqual([1, 0, 1]);
    });
});
