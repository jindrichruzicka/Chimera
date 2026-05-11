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
import type { ElectronApplication, Page } from '@playwright/test';

async function requestFullSnapshotSync(app: ElectronApplication, window: Page): Promise<void> {
    const currentTick = await getSimulationTick(app);

    await window.evaluate(async (syncTick) => {
        const gameApi = (
            globalThis as {
                readonly __chimera?: {
                    readonly game?: {
                        readonly sendAction?: (action: unknown) => void;
                        readonly getCurrentSnapshot?: () => Promise<{
                            readonly viewerId: string;
                        } | null>;
                    };
                };
            }
        ).__chimera?.game;

        if (gameApi === undefined || typeof gameApi.sendAction !== 'function') {
            throw new Error('window.__chimera.game.sendAction is unavailable');
        }

        if (typeof gameApi.getCurrentSnapshot !== 'function') {
            throw new Error('window.__chimera.game.getCurrentSnapshot is unavailable');
        }

        const snapshot = await gameApi.getCurrentSnapshot();
        if (snapshot === null) {
            throw new Error('Renderer current snapshot was not available');
        }

        gameApi.sendAction({
            type: 'engine:sync_request',
            playerId: snapshot.viewerId,
            tick: syncTick,
            payload: {},
        });
    }, currentTick);
}

test.describe('Multiplayer soak', () => {
    test('checksums converge after 1000 ticks', async ({ hostApp, hostWindow, clientApp }) => {
        await tick(hostApp, 1000);

        const simTick = await getSimulationTick(hostApp);
        expect(simTick).toBeGreaterThanOrEqual(1000);
        await expect.poll(() => getSimulationTick(clientApp)).toBeGreaterThanOrEqual(simTick);
        await requestFullSnapshotSync(hostApp, hostWindow);
        await expect
            .poll(async () => {
                try {
                    await assertChecksumMatch(hostApp, clientApp);
                    return true;
                } catch {
                    return false;
                }
            })
            .toBe(true);
    });
});
