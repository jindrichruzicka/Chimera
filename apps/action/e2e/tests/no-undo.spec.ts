/**
 * no-undo.spec.ts
 * §13 E2E Testing (Playwright)
 *
 * The action app resolves to `matchHistory.undo: false`, and this is what the
 * shipped build does about it: no undo control on the match route, and the bound
 * undo key rewinds nothing.
 *
 * WHAT THIS SPEC DOES NOT MEASURE. Neither assertion below fails if the host's
 * undo withholding is reverted, and the reason differs per half. The control
 * count is a statement about this app's OWN HUD: `ActionGameHud` draws no undo
 * pair under any manifest, so the count reads zero on a build that arms undo too.
 * The key half is a conjunction of three withholdings — the host arms a refusing
 * policy, mints no start-of-match memento, and the renderer registers no key
 * subscription — so reverting any one of them leaves the other two refusing.
 *
 * The projected `undoMeta` is not the missing witness either: with the policy and
 * the memento arms BOTH reverted, this seat still reports `canUndo: false`
 * (measured; a `canUndo: true` forced at the projector does reach this spec, so
 * the reading is live and the build is current). Whatever keeps the seat
 * ineligible here is upstream of the declaration, so no reading available at this
 * seam separates an armed build from a withholding one.
 *
 * The per-arm kills therefore live entirely in the unit tests —
 * `HostSessionPipeline.test.ts` for the policy, `electron/main/index.test.ts` for
 * the memento, `renderer/app/game/page.test.tsx` for the key subscription. What
 * this spec adds is that the shipped route offers no undo and the real Ctrl+Z
 * binding rewinds nothing, which is the user-facing claim; it is not evidence for
 * the mechanism.
 *
 * Whether the manifest DECLARES that capability or inherits it from the
 * real-time default is not what this measures — the two resolve identically, as
 * `apps/action/manifest.test.ts` asserts.
 *
 * Position is read off the PROJECTED SNAPSHOT, never off pixels, for the reason
 * `movement.spec.ts` gives: a primitive's place in the arena is a WebGL
 * transform the DOM cannot see.
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    cellOf,
    readSeatPrimitive,
    readViewerId,
    type ActionCell,
} from '../helpers/action-snapshot';
import { enterActionMatch, MATCH_ENTRY_TIMEOUT_MS } from '../helpers/enter-match';

test.use({ actionPort: '7819' });

/** Long enough for several 100 ms beats even on a runner an order slower. */
const HOLD_MS = 900;
/** Budget for the projection to catch up after a key event. */
const SETTLE_TIMEOUT_MS = 15_000;
const IDLE_BEATS = 5;

test.describe('Action undo is withheld', () => {
    test('the match route renders no undo or redo control', async ({ mainWindow }) => {
        const match = await enterActionMatch(mainWindow);

        // `enterActionMatch` has already waited for the HUD, so a count of zero
        // here is about the undo pair rather than about a match that never
        // revealed. Probes the test ids `apps/tactics/e2e/pages/GamePage.ts`
        // locates its own undo pair by.
        await expect(match.hudSlot).toHaveCount(1);
        await expect(mainWindow.getByTestId('undo')).toHaveCount(0);
        await expect(mainWindow.getByTestId('redo')).toHaveCount(0);
    });

    test('the bound undo key rewinds nothing while the match keeps running', async ({
        mainWindow,
    }) => {
        test.slow();

        const match = await enterActionMatch(mainWindow);

        const viewerId = await readViewerId(mainWindow);
        expect(viewerId, 'the match projected no viewer id').not.toBeNull();

        const readOwnCell = async (): Promise<ActionCell | null> =>
            cellOf(await readSeatPrimitive(mainWindow, viewerId ?? ''));

        await expect.poll(readOwnCell, { timeout: MATCH_ENTRY_TIMEOUT_MS }).not.toBeNull();
        const start = await readOwnCell();
        expect(start).not.toBeNull();

        // Move, so there IS something an undo could take back — and so the key
        // path is proven live before the undo key is sent, rather than assumed.
        await match.holdKey('ArrowRight', HOLD_MS);
        await expect
            .poll(async () => (await readOwnCell())?.x ?? null, { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(start?.x ?? 0);
        const moved = await readOwnCell();
        expect(moved).not.toBeNull();

        const tickBefore = await match.hudTick();

        // The engine default for `engine:undo`, spread into this app's settings
        // schema — the binding a player would actually press.
        await mainWindow.keyboard.press('Control+z');

        // A beat has to pass before the arena can be read back: without one, an
        // undo that WAS accepted would not yet have broadcast its reconstructed
        // snapshot, and the cell would still read as it did before the keypress.
        await expect
            .poll(() => match.hudTick(), { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(tickBefore);

        // A working undo replays onto the start-of-match baseline and puts the
        // primitive back where it began — which is why the move above had to
        // change the cell for this to mean anything.
        expect(await readOwnCell()).toStrictEqual(moved);
        expect(moved).not.toStrictEqual(start);

        // Then keep reading while the clock runs on, sampling from INSIDE the
        // poll rather than after it: an accepted undo does not leave the
        // primitive parked at the baseline — it restores the velocity the seat
        // held mid-move, so the primitive climbs back and a later reading can
        // find it at the same cell again. The LOWEST x reached is what cannot
        // recover. Defence in depth behind the reading above, which is what
        // fails when an undo is accepted.
        let lowestX = moved?.x ?? 0;
        await expect
            .poll(
                async () => {
                    const sample = await readOwnCell();
                    if (sample !== null && sample.x < lowestX) {
                        lowestX = sample.x;
                    }
                    return match.hudTick();
                },
                { timeout: SETTLE_TIMEOUT_MS },
            )
            .toBeGreaterThan(tickBefore + IDLE_BEATS);
        expect(lowestX).toBe(moved?.x);
    });
});
