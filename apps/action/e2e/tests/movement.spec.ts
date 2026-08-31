/**
 * movement.spec.ts
 * §13 E2E Testing (Playwright)
 *
 * The engine's first REALTIME consumer, moving: a held key becomes a velocity,
 * the host's wall-clock heartbeat turns that velocity into arena cells, and
 * releasing the key stops the primitive.
 *
 * Releasing it is TWO paths, and both are covered here. The player letting go is
 * one; the window losing focus is the other, and only the second is a stop the
 * player cannot make for themselves — no key-up is coming for a key let go in
 * another window, so a velocity nothing cleared would run the primitive into the
 * arena wall while the app sat in the background.
 *
 * Position is read off the PROJECTED SNAPSHOT, never off pixels. A primitive's
 * place in the arena is a WebGL transform the DOM cannot see, and a pixel probe
 * of a small shaded mesh answers "something changed colour here" rather than
 * "it is at cell (2, 0)". The snapshot is the record the playfield renders from,
 * so what is asserted is what is on screen.
 *
 * Keys are HELD rather than tapped, because that is the mechanism: the playfield
 * dispatches `action:set-velocity` only when a seat's derived velocity CHANGES,
 * so a tap that went down and up inside one 100 ms beat can legitimately move
 * nothing at all.
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    cellOf,
    readSeatPrimitive,
    readViewerId,
    type ActionCell,
} from '../helpers/action-snapshot';
import { enterActionMatch, MATCH_ENTRY_TIMEOUT_MS } from '../helpers/enter-match';

test.use({ actionPort: '7812' });

/** Long enough for several 100 ms beats even on a runner an order slower. */
const HOLD_MS = 900;
/** Budget for the projection, or the HUD clock, to catch up after a key event. */
const SETTLE_TIMEOUT_MS = 15_000;
/** Beats to let pass while asserting a released key moves nothing. */
const IDLE_BEATS = 5;

test.describe('Action movement', () => {
    test('a held arrow key drives the seat’s primitive, and releasing it stops', async ({
        mainWindow,
    }) => {
        test.slow();

        const match = await enterActionMatch(mainWindow);

        const viewerId = await readViewerId(mainWindow);
        expect(viewerId, 'the match projected no viewer id').not.toBeNull();

        const readOwnCell = async (): Promise<ActionCell | null> =>
            cellOf(await readSeatPrimitive(mainWindow, viewerId ?? ''));

        // The seat is driving a primitive at all — the `/select` page's default
        // pick rode the quick start into `snapshot.setup` and seated it.
        await expect.poll(readOwnCell, { timeout: MATCH_ENTRY_TIMEOUT_MS }).not.toBeNull();
        const start = await readOwnCell();
        expect(start).not.toBeNull();

        // ── Right: arena +x, and nothing on the other axis ───────────────────
        await match.holdKey('ArrowRight', HOLD_MS);
        await expect
            .poll(async () => (await readOwnCell())?.x ?? null, { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(start?.x ?? 0);
        const afterRight = await readOwnCell();
        // The two axes are independent, and the arena's extents differ on each,
        // so an x/y mix-up in the clamp or the mapping is visible rather than
        // symmetric.
        expect(afterRight?.y).toBe(start?.y);

        // ── Release means STOP ───────────────────────────────────────────────
        // The key is already up, but the heartbeat is still running: a velocity
        // the release failed to clear would keep moving the primitive, so what
        // proves the stop is BEATS PASSING with the cell unchanged. The clock is
        // the HUD's, because a beat that changes nothing sends no new snapshot.
        const beatAtRelease = await match.hudTick();
        await expect
            .poll(() => match.hudTick(), { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(beatAtRelease + IDLE_BEATS);
        expect(await readOwnCell()).toEqual(afterRight);

        // ── Up: SCREEN up is arena −y ────────────────────────────────────────
        await match.holdKey('ArrowUp', HOLD_MS);
        await expect
            .poll(async () => (await readOwnCell())?.y ?? null, { timeout: SETTLE_TIMEOUT_MS })
            .toBeLessThan(afterRight?.y ?? 0);
        expect((await readOwnCell())?.x).toBe(afterRight?.x);
    });

    test('a window blur releases a held arrow key, and the primitive stops', async ({
        mainWindow,
    }) => {
        test.slow();

        const match = await enterActionMatch(mainWindow);

        const viewerId = await readViewerId(mainWindow);
        expect(viewerId, 'the match projected no viewer id').not.toBeNull();

        const readOwnPrimitive = async () => readSeatPrimitive(mainWindow, viewerId ?? '');
        const readOwnCell = async (): Promise<ActionCell | null> =>
            cellOf(await readOwnPrimitive());

        await expect.poll(readOwnCell, { timeout: MATCH_ENTRY_TIMEOUT_MS }).not.toBeNull();
        const start = await readOwnCell();
        expect(start).not.toBeNull();

        // The key stays DOWN for the whole of this block. That is the case: a
        // player who alt-tabs away and lets go in another window sends this app
        // no key-up at all, ever — so a spec that released the key would be
        // testing the path that already worked.
        await match.whileHoldingKey('ArrowRight', async () => {
            // Moving FIRST. Without this the stop below would read the same on a
            // primitive that never started, and on a match that never seated one.
            await expect
                .poll(async () => (await readOwnCell())?.x ?? null, { timeout: SETTLE_TIMEOUT_MS })
                .toBeGreaterThan(start?.x ?? 0);

            await match.blurWindow();

            // The MECHANISM, read off the projection: the synthesised release
            // reached the playfield, which dispatched one `action:set-velocity`
            // of zero. `dx` is the standing order itself, not its consequence.
            await expect
                .poll(async () => (await readOwnPrimitive())?.dx ?? null, {
                    timeout: SETTLE_TIMEOUT_MS,
                })
                .toBe(0);

            // And the CONSEQUENCE: beats pass with the cell unchanged. The
            // clock is the HUD's, because a beat that moves nothing broadcasts
            // no new snapshot.
            const afterBlur = await readOwnCell();
            // Both-null would satisfy the `toEqual` below on its own.
            expect(afterBlur).not.toBeNull();
            const beatAtBlur = await match.hudTick();
            await expect
                .poll(() => match.hudTick(), { timeout: SETTLE_TIMEOUT_MS })
                .toBeGreaterThan(beatAtBlur + IDLE_BEATS);
            expect(await readOwnCell()).toEqual(afterBlur);
        });
    });

    test('the HUD tick advances on the host’s heartbeat with nobody touching a key', async ({
        mainWindow,
    }) => {
        test.slow();

        const match = await enterActionMatch(mainWindow);

        // The one visible proof that the realtime lifecycle is running: in a
        // turn-based game this number only moves when somebody acts. Read off
        // the HUD rather than the host, because the HUD is what a player sees —
        // a screen wired to a stale prop would hold it still while the host
        // ticked on.
        await expect(match.tick).toBeVisible();
        const first = await match.hudTick();
        await expect
            .poll(() => match.hudTick(), { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(first + IDLE_BEATS);
    });
});
