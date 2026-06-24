// shared/constants.test.ts
//
// Unit tests for the IS_DEBUG_MODE constant against the §4.12 environment
// matrix (docs/core-components/runtime-debug-layer.md).
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.
//
// The constant is evaluated once at module load, so each case stubs the
// environment, resets the module registry, and re-imports a fresh copy.

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Loads `IS_DEBUG_MODE` from a fresh copy of `./constants` under a stubbed
 * environment. `vi.stubEnv('CHIMERA_DEBUG', undefined)` deletes the variable,
 * so an ambient `CHIMERA_DEBUG=1` exported by the runner's shell cannot flip
 * the "absent" rows of the matrix.
 */
async function loadIsDebugMode(
    nodeEnv: 'development' | 'production' | 'test',
    chimeraDebug: string | undefined,
): Promise<boolean> {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('CHIMERA_DEBUG', chimeraDebug);
    const constants = await import('./constants.js');
    return constants.IS_DEBUG_MODE;
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('IS_DEBUG_MODE (§4.12 environment matrix, Invariant #27)', () => {
    it('is false in a production package (CHIMERA_DEBUG absent, NODE_ENV=production)', async () => {
        const value = await loadIsDebugMode('production', undefined);

        expect(typeof value).toBe('boolean');
        expect(value).toBe(false);
    });

    it('is true on a dev server (CHIMERA_DEBUG=1, NODE_ENV=development)', async () => {
        const value = await loadIsDebugMode('development', '1');

        expect(typeof value).toBe('boolean');
        expect(value).toBe(true);
    });

    it('is false in CI unit/integration runs (CHIMERA_DEBUG absent, NODE_ENV=test)', async () => {
        const value = await loadIsDebugMode('test', undefined);

        expect(typeof value).toBe('boolean');
        expect(value).toBe(false);
    });

    it('is false in E2E runs (CHIMERA_DEBUG absent — inherit-env strips it)', async () => {
        // E2E launches inherit the parent env minus CHIMERA_DEBUG
        // (apps/tactics/e2e/fixtures/inherit-env.ts), so the constant must read absent → false.
        const value = await loadIsDebugMode('test', undefined);

        expect(typeof value).toBe('boolean');
        expect(value).toBe(false);
    });

    it('is false for the illegal combination (CHIMERA_DEBUG=1, NODE_ENV=production)', async () => {
        const value = await loadIsDebugMode('production', '1');

        expect(typeof value).toBe('boolean');
        expect(value).toBe(false);
    });

    it('requires the literal value "1" — any other CHIMERA_DEBUG value stays false', async () => {
        const value = await loadIsDebugMode('development', 'true');

        expect(typeof value).toBe('boolean');
        expect(value).toBe(false);
    });
});
