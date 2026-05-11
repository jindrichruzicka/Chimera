/**
 * electron/main/runtime/SimulationHost.e2e-hooks.test.ts
 *
 * Unit tests for the CHIMERA_E2E-gated __e2eHooks main-process contract.
 *
 * Architecture reference: §13.9, §13.10 — E2E hooks and CHIMERA_E2E flag.
 * Issue: #458
 *
 * Tests written FIRST (red confirmed before implementation).
 *
 * Invariants verified:
 *   #3  — lastHostSnapshot stores PlayerSnapshot only, never GameSnapshot.
 *   #8  — hook snapshots are intended to be supplied after StateProjector.project().
 *   #27 — CHIMERA_E2E is a test-only flag and absent/0 means no hook is set.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import { registerE2eHooks, type E2eHooks } from './e2e-hooks.js';

function clearGlobalHooks(): void {
    Reflect.deleteProperty(globalThis, '__e2eHooks');
}

function requireHooks(value: E2eHooks | undefined): E2eHooks {
    if (value === undefined) {
        throw new Error('Expected __e2eHooks to be registered');
    }
    return value;
}

function assertPlayerSnapshot(_snapshot: PlayerSnapshot | null): void {
    return;
}

describe('registerE2eHooks', () => {
    afterEach(() => {
        clearGlobalHooks();
    });

    it('defines __e2eHooks with the expected shape when CHIMERA_E2E=1', () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));

        expect(globalThis.__e2eHooks).toBe(hooks);
        expect(hooks.lastHostSnapshot).toBeNull();
        expect(hooks.lastChecksum).toBe(0);
        expect(hooks.broadcastChecksums).toEqual({});
        expect(hooks.currentTick).toBe(0);
        expect(typeof hooks.onTick).toBe('function');
        expect(typeof hooks.onBroadcastChecksum).toBe('function');
        expect(typeof hooks.dispatchTick).toBe('function');
    });

    it('dispatchTick throws before the session runtime wires it — fails loudly in CI', () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));

        expect(() => hooks.dispatchTick()).toThrow(/dispatchTick.*not.*wired|session runtime/i);
    });

    it('dispatchTick can be replaced by the session runtime', () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));
        const stub = vi.fn();

        hooks.dispatchTick = stub;
        hooks.dispatchTick();

        expect(stub).toHaveBeenCalledOnce();
    });

    it('does not define __e2eHooks when CHIMERA_E2E is absent', () => {
        const hooks = registerE2eHooks({});

        expect(hooks).toBeUndefined();
        expect(globalThis.__e2eHooks).toBeUndefined();
    });

    it('does not define __e2eHooks when CHIMERA_E2E=0', () => {
        const hooks = registerE2eHooks({ CHIMERA_E2E: '0' });

        expect(hooks).toBeUndefined();
        expect(globalThis.__e2eHooks).toBeUndefined();
    });

    it('updates currentTick, lastChecksum, and lastHostSnapshot from onTick()', () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));
        const snapshot = makeStubPlayerSnapshot(17);

        hooks.onTick(17, 12_345, snapshot);

        assertPlayerSnapshot(hooks.lastHostSnapshot);
        expect(hooks.currentTick).toBe(17);
        expect(hooks.lastChecksum).toBe(12_345);
        expect(hooks.broadcastChecksums[snapshot.viewerId]).toBe(12_345);
        expect(hooks.lastHostSnapshot).toBe(snapshot);

        const storedSnapshot = hooks.lastHostSnapshot;
        if (storedSnapshot === null) {
            throw new Error('Expected onTick to store a PlayerSnapshot');
        }
        expect('seed' in storedSnapshot).toBe(false);
    });

    it('updates currentTick, lastChecksum, and per-viewer checksum from onBroadcastChecksum without replacing lastHostSnapshot', () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));
        const snapshot = makeStubPlayerSnapshot(17);
        hooks.onTick(17, 12_345, snapshot);

        hooks.onBroadcastChecksum(18, 'remote-player', 67_890);

        expect(hooks.currentTick).toBe(18);
        expect(hooks.lastChecksum).toBe(67_890);
        expect(hooks.broadcastChecksums).toEqual({
            [snapshot.viewerId]: 12_345,
            'remote-player': 67_890,
        });
        expect(hooks.lastHostSnapshot).toBe(snapshot);
    });
});
