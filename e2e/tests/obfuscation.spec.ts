/**
 * F33 — obfuscation.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies host-renderer state projection safety:
 *   - The host snapshot contains no opponent owner-only fields
 *   - Fog-hidden entities are absent from PlayerSnapshot.entities
 *
 * Invariant #3: GameSnapshot never crosses a process boundary; this spec reads
 * only the host renderer's last projected PlayerSnapshot via CHIMERA_E2E hooks.
 *
 * Invariant #8: StateProjector.project() is the mandatory outbound gate; the
 * spec verifies the projected host snapshot has already stripped hidden data.
 */
import { test, expect } from '../fixtures/game.fixture';
import { getHostSnapshot } from '../helpers/ipc-spy';
import { assertNoLeakedFields } from '../helpers/snapshot-assert';
import { GamePage } from '../pages/GamePage';

type FogHiddenMarker = Readonly<{ readonly __fogHidden?: boolean }>;
const OPPONENT_UNIT_ID = 'unit-2';

type HostSnapshot = NonNullable<Awaited<ReturnType<typeof getHostSnapshot>>>;

function readProjectedEntity(snapshot: HostSnapshot, entityId: string): unknown {
    return (snapshot.entities as Readonly<Record<string, unknown>>)[entityId];
}

test.describe('State obfuscation', () => {
    test('host snapshot contains no opponent owner-only fields', async ({ hostApp }) => {
        const snapshot = await getHostSnapshot(hostApp);
        expect(snapshot).not.toBeNull();
        if (snapshot === null) throw new Error('Host snapshot was not delivered');

        assertNoLeakedFields(snapshot, snapshot.viewerId, 'p2');
    });

    test('unit-2 is absent until the host moves into reveal proximity through the canvas', async ({
        hostApp,
        hostWindow,
    }) => {
        const snapshot = await getHostSnapshot(hostApp);
        expect(snapshot).not.toBeNull();
        if (snapshot === null) throw new Error('Host snapshot was not delivered');

        const fogHiddenEntities = Object.values(snapshot.entities).filter(
            (entity) => (entity as FogHiddenMarker).__fogHidden === true,
        );
        expect(fogHiddenEntities).toHaveLength(0);
        expect(readProjectedEntity(snapshot, OPPONENT_UNIT_ID)).toBeUndefined();

        const match = new GamePage(hostWindow);
        await match.assertOldTacticsButtonsAbsent();
        await match.moveOwnedUnit();

        await expect
            .poll(async () => {
                const current = await getHostSnapshot(hostApp);
                return current !== null &&
                    readProjectedEntity(current, OPPONENT_UNIT_ID) !== undefined
                    ? 'visible'
                    : 'hidden';
            })
            .toBe('visible');

        const afterReveal = await getHostSnapshot(hostApp);
        const revealed =
            afterReveal === null
                ? undefined
                : (readProjectedEntity(afterReveal, OPPONENT_UNIT_ID) as
                      | Record<string, unknown>
                      | undefined);
        expect(revealed).toBeDefined();
        if (revealed === undefined) throw new Error('Opponent unit was not revealed');
        expect(revealed).not.toHaveProperty('visibleTo');
    });
});
