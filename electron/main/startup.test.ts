// electron/main/startup.test.ts
//
// Unit tests for the production startup guards (Invariants #27 and #77).
//
// The guards are pure functions defined in startup-guard.ts so they
// can be exercised here without loading the heavy Electron module or any of
// the real filesystem / IPC infrastructure.
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.
// Invariant #77: the process must refuse to start when `CHIMERA_DEV_HARNESS=1`
//   is combined with `NODE_ENV=production`.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { assertProductionDebugGuard, assertProductionDevHarnessGuard } from './startup-guard.js';

describe('assertProductionDebugGuard (Invariant #27)', () => {
    it('throws when CHIMERA_DEBUG is set and NODE_ENV=production', () => {
        expect(() =>
            assertProductionDebugGuard({ NODE_ENV: 'production', CHIMERA_DEBUG: '1' }),
        ).toThrow(/CHIMERA_DEBUG/i);
    });

    it('throws when CHIMERA_DEBUG is set to any non-empty value in production', () => {
        expect(() =>
            assertProductionDebugGuard({ NODE_ENV: 'production', CHIMERA_DEBUG: 'true' }),
        ).toThrow(/CHIMERA_DEBUG/i);
    });

    it('does not throw when NODE_ENV=production and CHIMERA_DEBUG is absent', () => {
        // Explicit `false` keeps the case hermetic: the default parameter reads
        // the real IS_DEBUG_MODE, which an ambient CHIMERA_DEBUG=1 in the
        // runner's shell would flip.
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'production' }, false)).not.toThrow();
    });

    it('does not throw when NODE_ENV=development and CHIMERA_DEBUG is set', () => {
        expect(() =>
            assertProductionDebugGuard({ NODE_ENV: 'development', CHIMERA_DEBUG: '1' }),
        ).not.toThrow();
    });

    it('does not throw when NODE_ENV=development and CHIMERA_DEBUG is absent', () => {
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'development' })).not.toThrow();
    });

    it('does not throw when NODE_ENV is undefined and CHIMERA_DEBUG is set (non-production default)', () => {
        // When NODE_ENV is not explicitly "production" the guard must not block.
        expect(() => assertProductionDebugGuard({ CHIMERA_DEBUG: '1' })).not.toThrow();
    });

    it('error message references "production" so the operator understands the context', () => {
        expect(() =>
            assertProductionDebugGuard({ NODE_ENV: 'production', CHIMERA_DEBUG: '1' }),
        ).toThrow(/production/i);
    });

    it('error message references Invariant #27 or the debug flag so the operator can diagnose it', () => {
        let thrown: unknown;
        try {
            assertProductionDebugGuard({ NODE_ENV: 'production', CHIMERA_DEBUG: '1' });
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        // Must mention at least one of: the flag name, the invariant number, or "IS_DEBUG_MODE"
        expect(message).toMatch(/CHIMERA_DEBUG|invariant.*27|IS_DEBUG_MODE/i);
    });
});

describe('assertProductionDebugGuard IS_DEBUG_MODE assertion (Invariant #27)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('throws when NODE_ENV=production and the baked IS_DEBUG_MODE is true, even without CHIMERA_DEBUG', () => {
        // Mis-built-binary case: build-time replacement baked IS_DEBUG_MODE=true
        // into a bundle that is later launched with NODE_ENV=production and a
        // clean environment.
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'production' }, true)).toThrow(
            /IS_DEBUG_MODE/,
        );
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'production' }, true)).toThrow(/27/);
    });

    it('does not throw when NODE_ENV=development and IS_DEBUG_MODE is true (normal debug session)', () => {
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'development' }, true)).not.toThrow();
    });

    it('does not throw when NODE_ENV=production and IS_DEBUG_MODE is false (correct production build)', () => {
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'production' }, false)).not.toThrow();
    });

    it('reads the real IS_DEBUG_MODE constant through the default parameter', async () => {
        // Simulate "built in a debug environment, run in production" with no
        // mocking: constants.ts evaluates its env at module load, so a fresh
        // import under CHIMERA_DEBUG=1 captures IS_DEBUG_MODE=true in the
        // guard's default parameter.
        vi.resetModules();
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('CHIMERA_DEBUG', '1');
        const guard = await import('./startup-guard.js');

        expect(() => guard.assertProductionDebugGuard({ NODE_ENV: 'production' })).toThrow(
            /IS_DEBUG_MODE/,
        );
    });
});

describe('assertProductionDevHarnessGuard (Invariant #77)', () => {
    it('throws when CHIMERA_DEV_HARNESS=1 and NODE_ENV=production', () => {
        expect(() =>
            assertProductionDevHarnessGuard({ NODE_ENV: 'production', CHIMERA_DEV_HARNESS: '1' }),
        ).toThrow(/CHIMERA_DEV_HARNESS is enabled in a production build/);
    });

    it('error message tells the operator the process refused to start', () => {
        expect(() =>
            assertProductionDevHarnessGuard({ NODE_ENV: 'production', CHIMERA_DEV_HARNESS: '1' }),
        ).toThrow(/Refusing to start/);
    });

    it('does not throw when NODE_ENV=production and CHIMERA_DEV_HARNESS is absent', () => {
        expect(() => assertProductionDevHarnessGuard({ NODE_ENV: 'production' })).not.toThrow();
    });

    it('does not throw when CHIMERA_DEV_HARNESS is set to a non-"1" value in production', () => {
        // The harness only activates on the exact value "1" (see
        // parseHarnessFlags); the guard mirrors that activation condition.
        expect(() =>
            assertProductionDevHarnessGuard({ NODE_ENV: 'production', CHIMERA_DEV_HARNESS: '0' }),
        ).not.toThrow();
    });

    it('does not throw when CHIMERA_DEV_HARNESS=1 and NODE_ENV=development', () => {
        expect(() =>
            assertProductionDevHarnessGuard({ NODE_ENV: 'development', CHIMERA_DEV_HARNESS: '1' }),
        ).not.toThrow();
    });

    it('does not throw when NODE_ENV is undefined and CHIMERA_DEV_HARNESS=1 (non-production default)', () => {
        expect(() => assertProductionDevHarnessGuard({ CHIMERA_DEV_HARNESS: '1' })).not.toThrow();
    });
});
