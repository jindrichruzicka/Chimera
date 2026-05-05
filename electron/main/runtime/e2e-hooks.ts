/**
 * electron/main/runtime/e2e-hooks.ts
 *
 * CHIMERA_E2E-gated __e2eHooks main-process contract.
 *
 * Registers a global `__e2eHooks` object when `CHIMERA_E2E=1` so E2E tests
 * can read live tick/checksum/snapshot state from the host process without
 * going through IPC.
 *
 * Architecture reference: §13.9, §13.10 — E2E hooks and CHIMERA_E2E flag.
 * Issue: #458
 *
 * Invariants upheld:
 *   #3  — lastHostSnapshot stores PlayerSnapshot only, never GameSnapshot.
 *   #8  — hook snapshots are intended to be supplied after StateProjector.project().
 *   #27 — CHIMERA_E2E is a test-only flag and absent/0 means no hook is set.
 */

import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';

export interface E2eHooks {
    readonly lastHostSnapshot: PlayerSnapshot | null;
    readonly lastChecksum: number;
    readonly currentTick: number;
    onTick(tick: number, checksum: number, snapshot: PlayerSnapshot): void;
}

declare global {
    var __e2eHooks: E2eHooks | undefined;
}

function createE2eHooks(): E2eHooks {
    const state = {
        lastHostSnapshot: null as PlayerSnapshot | null,
        lastChecksum: 0,
        currentTick: 0,
    };
    return {
        get lastHostSnapshot() {
            return state.lastHostSnapshot;
        },
        get lastChecksum() {
            return state.lastChecksum;
        },
        get currentTick() {
            return state.currentTick;
        },
        onTick(tick, checksum, snapshot): void {
            state.currentTick = tick;
            state.lastChecksum = checksum;
            state.lastHostSnapshot = snapshot;
        },
    };
}

export function registerE2eHooks(
    env: Readonly<Record<string, string | undefined>> = process.env,
): E2eHooks | undefined {
    if (env['CHIMERA_E2E'] !== '1') {
        Reflect.deleteProperty(globalThis, '__e2eHooks');
        return undefined;
    }

    const hooks = createE2eHooks();
    globalThis.__e2eHooks = hooks;
    return hooks;
}

export function getE2eHooks(): E2eHooks | undefined {
    return globalThis.__e2eHooks;
}
