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
 * absent (or null) in any non-owner snapshot.
 *
 * The scan is a full recursive descent through nested objects and arrays so
 * that deeply-nested visibility markers (e.g. `player.hand.cards[0].__visibility`)
 * are not missed. A WeakSet guards against circular references.
 *
 * NOTE: **all** non-viewer players are scanned, not only `snapshotOwner`.
 * `snapshotOwner` is used solely for the early-exit guard when
 * `viewerId === snapshotOwner`.
 *
 * When `viewerId === snapshotOwner` the snapshot was projected for the viewer,
 * so all their own fields are permitted regardless of visibility tag — returns
 * immediately without checking.
 *
 * @param snapshot      - The PlayerSnapshot to inspect.
 * @param viewerId      - The player receiving this snapshot.
 * @param snapshotOwner - The player who owns the sensitive data being tested.
 *                        Used only for the early-exit guard; all non-viewer
 *                        players are always scanned.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: string,
    snapshotOwner: string,
): void {
    if (viewerId === snapshotOwner) return;

    const visited = new WeakSet<object>();
    const leaked: string[] = [];

    function scan(value: unknown, playerId: string, path: string): void {
        if (value === null || typeof value !== 'object') return;
        const obj = value as Record<string, unknown>;
        if (visited.has(obj)) return;
        visited.add(obj);

        if ((obj as { __visibility?: string }).__visibility === 'owner-only') {
            leaked.push(`player=${playerId} path=${path}`);
            // Do not descend further into an already-flagged subtree.
            return;
        }

        for (const [key, child] of Object.entries(obj)) {
            scan(child, playerId, `${path}.${key}`);
        }
    }

    for (const [playerId, playerState] of Object.entries(snapshot.players)) {
        if (playerId !== viewerId) {
            scan(playerState, playerId, `players.${playerId}`);
        }
    }

    expect(
        leaked,
        `Snapshot for viewer=${viewerId} leaked owner-only fields: ${leaked.join(', ')}`,
    ).toHaveLength(0);
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
