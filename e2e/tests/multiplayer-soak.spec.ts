/**
 * F33 — multiplayer-soak.spec.ts
 * §13.8 Core E2E Test Specifications
 *
 * Verifies deterministic host/client convergence after a 1000-tick soak run.
 * Tick dispatch goes through the CHIMERA_E2E hook wired to the ActionPipeline;
 * this spec never injects simulation state directly.
 */
import { test, expect } from '../fixtures/game.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { assertChecksumMatch } from '../helpers/snapshot-assert';
import { tick } from '../helpers/tick-driver';

test.describe('Multiplayer soak', () => {
    test('checksums converge after 1000 ticks', async ({ hostApp, clientApp }) => {
        await tick(hostApp, 1000);

        const simTick = await getSimulationTick(hostApp);
        expect(simTick).toBeGreaterThanOrEqual(1000);
        await expect.poll(() => getSimulationTick(clientApp)).toBeGreaterThanOrEqual(simTick);
        await assertChecksumMatch(hostApp, clientApp);
    });
});
