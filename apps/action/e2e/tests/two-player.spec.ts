/**
 * two-player.spec.ts
 * §4.37.18 Shell State and the Game Page Services · Invariant #101 —
 * the pass-and-play seat, end to end
 *
 * `QuickStartConfig.localSeats` gives one machine two players, and the picker
 * is where the second one is opened. Everything after that has to agree: the
 * seat's pick has to ride the quick start into `snapshot.setup`, the simulation
 * has to seat it on the primitive it named, the playfield has to mount a SECOND
 * held-key cluster for it, and WASD has to move that seat and only that seat.
 *
 * A seat nobody can move is not a seat, so the last step is the point of the
 * spec: the two clusters are separate `useInputAction` subscriptions with
 * separate held sets, and one shared set would sum both players' keys into a
 * single velocity and move both primitives as one. What catches that is
 * asserting the OTHER primitive did not move — which is why the host's cell is
 * captured before the second seat is driven.
 */

import { expect, test } from '../fixtures/electron.fixture';
import { readActionPrimitives, readActionSetup, readViewerId } from '../helpers/action-snapshot';
import { MATCH_ENTRY_TIMEOUT_MS, openSelectPage } from '../helpers/enter-match';
import { ActionMatchPage } from '../pages/ActionMatchPage';

test.use({ actionPort: '7818' });

const HOLD_MS = 900;
const SETTLE_TIMEOUT_MS = 15_000;

test.describe('Action pass-and-play', () => {
    test('the second seat picks, plays, and moves on its own keys', async ({ mainWindow }) => {
        test.slow();

        // ── 1. Give BOTH seats a pick, and neither the one seat order would ──
        // The seeds are laid out cube · sphere · cone, and a match that ignored
        // the picks would seat the two players on the first two in that order.
        // So the host is moved OFF the cube and the second seat past the sphere:
        // the pair below is reachable only by honouring what each seat chose.
        const select = await openSelectPage(mainWindow);
        await expect(select.hostPick).toHaveText(/cube$/, { timeout: MATCH_ENTRY_TIMEOUT_MS });
        await select.stepHostPick('right');
        await expect(select.hostPick).toHaveText(/sphere$/, { timeout: MATCH_ENTRY_TIMEOUT_MS });

        await select.enableSecondPlayer();
        // Opening lands it on the first shape the host is NOT holding —
        // exclusivity is the rule with teeth, because two seats naming one
        // primitive is a state the simulation resolves by silently ignoring one
        // player's pick.
        await expect(select.secondPick).toHaveText(/cube$/, { timeout: MATCH_ENTRY_TIMEOUT_MS });

        // Its own cluster moves its own ring, on the same keys it will play with —
        // and it steps PAST the shape the host is holding rather than onto it.
        await select.stepSecondPick('right');
        await expect(select.secondPick).toHaveText(/cone$/, { timeout: MATCH_ENTRY_TIMEOUT_MS });
        await expect(select.hostPick).toHaveText(/sphere$/);

        // ── 2. Start, and both seats are in the match ────────────────────────
        await select.start();
        await expect(select.startFailed).toHaveCount(0);
        // The reveal wait only. `enterActionMatch` opens the picker and presses
        // Start in one call, and this spec has picker steps to make in between —
        // so it drives the two halves itself and borrows the wait.
        const match = new ActionMatchPage(mainWindow);
        await match.waitForRevealed(MATCH_ENTRY_TIMEOUT_MS);

        const hostId = await readViewerId(mainWindow);
        expect(hostId, 'the match projected no viewer id').not.toBeNull();

        await expect
            .poll(
                async () =>
                    (await readActionPrimitives(mainWindow)).filter((p) => p.ownerId !== null)
                        .length,
                {
                    timeout: MATCH_ENTRY_TIMEOUT_MS,
                },
            )
            .toBe(2);

        // The UPSTREAM half, asserted separately from the seating below because
        // the two can fail apart: the picker writing the draft and the quick
        // start carrying it into `snapshot.setup` is one link, and the host
        // handing that setup to the game's entity builder is the next. With only
        // the shapes asserted, a break in the second link reads exactly like a
        // break in the first.
        const setup = await readActionSetup(mainWindow);
        expect(setup, 'the match projected no setup').not.toBeNull();
        const seatIds = Object.keys(setup?.playerAttributes ?? {});
        expect(seatIds).toHaveLength(2);
        expect(
            seatIds.map((seat) => setup?.playerAttributes[seat]?.['primitive']).sort(),
            `setup: ${JSON.stringify(setup)}`,
        ).toEqual(['cone', 'sphere']);

        const seated = await readActionPrimitives(mainWindow);
        const hostPrimitive = seated.find((primitive) => primitive.ownerId === hostId);
        const secondPrimitive = seated.find(
            (primitive) => primitive.ownerId !== null && primitive.ownerId !== hostId,
        );
        expect(hostPrimitive, `no host primitive in ${JSON.stringify(seated)}`).toBeDefined();
        expect(secondPrimitive, `no second seat in ${JSON.stringify(seated)}`).toBeDefined();
        // Each seat is on the shape ITS picker caption named — the picks rode the
        // draft into `snapshot.setup`, the host handed that setup to the game's
        // entity builder, and the builder seated them there. Seat order alone
        // would have produced cube · sphere, so this pair is what says the whole
        // chain ran rather than a fallback that happens to look plausible.
        expect(hostPrimitive?.shape).toBe('sphere');
        expect(secondPrimitive?.shape).toBe('cone');

        // ── 3. WASD moves the second seat, and only the second seat ──────────
        const hostCellBefore = { x: hostPrimitive?.x, y: hostPrimitive?.y };
        const secondXBefore = secondPrimitive?.x ?? 0;

        await match.holdKey('KeyD', HOLD_MS);

        const readSecondX = async (): Promise<number | null> =>
            (await readActionPrimitives(mainWindow)).find(
                (primitive) => primitive.id === secondPrimitive?.id,
            )?.x ?? null;
        await expect
            .poll(readSecondX, { timeout: SETTLE_TIMEOUT_MS })
            .toBeGreaterThan(secondXBefore);

        const after = await readActionPrimitives(mainWindow);
        const hostAfter = after.find((primitive) => primitive.id === hostPrimitive?.id);
        // One shared held set would have summed both players' keys into one
        // velocity and dragged this one along.
        expect({ x: hostAfter?.x, y: hostAfter?.y }).toEqual(hostCellBefore);
    });
});
