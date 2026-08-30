/**
 * autosave-continue.spec.ts
 * §4.37 Renderer Shell Pages UI Contract · §13 E2E Testing (Playwright)
 *
 * The round trip a returning player makes: play, leave, come back.
 *
 * Escape → Leave match is the app's ONLY exit, and for a quick-started session
 * the engine's role-aware leave takes the `closeSession({ autosave: true })`
 * fork — capture and teardown in one call, because a renderer-side "save, then
 * leave" pair would race: a leave that landed first would leave the capture with
 * no session to read. What this spec asserts is the far end of that: the save
 * really happened, Continue really became available on the strength of it, and
 * what came back is the ARENA THE PLAYER LEFT rather than a fresh one.
 *
 * The restored fact is a POSITION, deliberately, and one the player produced by
 * moving. A restore that silently re-seeded would put the primitive back on its
 * starting cell — so the spec first checks the cell it captured is not that one,
 * and only then that the restore returns it.
 *
 * The tick is NOT compared. A realtime host keeps beating through the menu and
 * on past the restore, so the number is different by the time anything could
 * read it; the position is the fact that holds still, because a released key
 * leaves the velocity at zero.
 */

import { expect, test } from '../fixtures/electron.fixture';
import {
    cellOf,
    readSeatPrimitive,
    readViewerId,
    type ActionCell,
} from '../helpers/action-snapshot';
import {
    enterActionMatch,
    leaveActionMatch,
    MATCH_ENTRY_TIMEOUT_MS,
    NAV_TIMEOUT_MS,
} from '../helpers/enter-match';
import { ActionMatchPage } from '../pages/ActionMatchPage';

test.use({ actionPort: '7813' });

const HOLD_MS = 900;
const SETTLE_TIMEOUT_MS = 15_000;

test.describe('Action autosave and Continue', () => {
    test('leaving autosaves, and Continue restores the arena as it was left', async ({
        mainWindow,
    }) => {
        test.slow();

        await enterActionMatch(mainWindow);

        const viewerId = await readViewerId(mainWindow);
        expect(viewerId, 'the match projected no viewer id').not.toBeNull();
        const readOwnCell = async (): Promise<ActionCell | null> =>
            cellOf(await readSeatPrimitive(mainWindow, viewerId ?? ''));

        await expect.poll(readOwnCell, { timeout: MATCH_ENTRY_TIMEOUT_MS }).not.toBeNull();
        const seeded = await readOwnCell();

        // ── 1. Produce a board fact of the player's own ──────────────────────
        const match = new ActionMatchPage(mainWindow);
        await match.holdKey('ArrowRight', HOLD_MS);
        await expect
            .poll(async () => (await readOwnCell())?.x ?? null, { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(seeded?.x ?? 0);
        const beforeLeave = await readOwnCell();
        // Non-vacuity for step 4: a restore that re-seeded instead of restoring
        // would land on `seeded`, and without this the two would be
        // indistinguishable.
        expect(beforeLeave).not.toEqual(seeded);

        // ── 2. Leave: the session ends, and the autosave is written on the way
        const menu = await leaveActionMatch(mainWindow);

        // ── 3. Continue is live, and the engine's own gate is what enabled it
        // The save slot list is pushed by the close's autosave — no reload, and
        // nothing on the game's side probed for it.
        await expect(menu.continueButton).toBeEnabled({ timeout: NAV_TIMEOUT_MS });

        // ── 4. Resume: the arena comes back as it was left ───────────────────
        await menu.continueButton.click();
        await match.waitForRevealed(MATCH_ENTRY_TIMEOUT_MS);

        // Route arrival is not restoration. The seat is re-seated on the same
        // primitive, standing on the cell the player walked it to.
        await expect.poll(readOwnCell, { timeout: MATCH_ENTRY_TIMEOUT_MS }).toEqual(beforeLeave);
    });
});
