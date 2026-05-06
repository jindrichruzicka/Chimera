/**
 * e2e/helpers/snapshot-assert.ts
 *
 * Typed assertion helpers used across E2E specs to verify that PlayerSnapshots
 * are correctly obfuscated and that simulation state converges between processes.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #473
 *
 * Invariants upheld:
 *   #3 — Operates on PlayerSnapshot only; never on GameSnapshot.
 *   #8 — assertNoLeakedFields is the post-projection gate: verifies that
 *         StateProjector.project() correctly masked owner-only fields before
 *         the snapshot was delivered to a non-owning viewer.
 *
 * Module boundary: must NOT import from electron/main/, simulation/, or networking/.
 * ElectronApplication is the only Playwright import.
 */

import { expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { getLastBroadcastChecksum, getSimulationTick } from './ipc-spy';

/**
 * PlayerSnapshot type derived from the globally-declared __e2eHooks shape
 * (electron/main/runtime/e2e-hooks.ts). Using typeof avoids a cross-module
 * import from electron/main/ or simulation/.
 */
type PlayerSnapshot = NonNullable<NonNullable<typeof globalThis.__e2eHooks>['lastHostSnapshot']>;

/**
 * Assert that a PlayerSnapshot contains no fields classified owner-only for
 * another player. Fields tagged with `__visibility: 'owner-only'` must be
 * null in any non-owner snapshot.
 *
 * When `viewerId === ownerId` the snapshot was projected for the viewer, so
 * all their own fields are permitted regardless of visibility tag — returns
 * immediately without checking.
 *
 * @param snapshot - The PlayerSnapshot to inspect.
 * @param viewerId - The player receiving this snapshot.
 * @param ownerId  - The player who owns the sensitive data being tested.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: string,
    ownerId: string,
): void {
    if (viewerId === ownerId) return;

    for (const [playerId, playerState] of Object.entries(snapshot.players)) {
        if (playerId !== viewerId) {
            const leaked = Object.entries(playerState as Record<string, unknown>).filter(
                ([, v]) => (v as { __visibility?: string })?.__visibility === 'owner-only',
            );
            expect(
                leaked,
                `Snapshot for viewer=${viewerId} leaked owner-only field from player=${playerId}`,
            ).toHaveLength(0);
        }
    }
}

/**
 * Assert that the last broadcast checksum matches between the host process and
 * a client process. Uses `expect(hostChecksum).toBe(clientChecksum)` — no
 * manual throw.
 *
 * @param hostApp   - ElectronApplication instance for the host.
 * @param clientApp - ElectronApplication instance for the client.
 */
export async function assertChecksumMatch(
    hostApp: ElectronApplication,
    clientApp: ElectronApplication,
): Promise<void> {
    const hostChecksum = await getLastBroadcastChecksum(hostApp);
    const clientChecksum = await getLastBroadcastChecksum(clientApp);
    expect(hostChecksum).toBe(clientChecksum);
}

/**
 * Assert that the simulation tick in the given process has advanced past the
 * provided baseline value, confirming the simulation progressed.
 *
 * Fails (via expect) when tick has not advanced beyond baseline.
 *
 * @param app      - ElectronApplication instance to inspect.
 * @param baseline - The tick value that must have been exceeded.
 */
export async function assertTickAdvanced(
    app: ElectronApplication,
    baseline: number,
): Promise<void> {
    const tick = await getSimulationTick(app);
    expect(tick).toBeGreaterThan(baseline);
}
