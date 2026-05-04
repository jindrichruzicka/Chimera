// electron/main/startup.test.ts
//
// Unit tests for the production startup guard (Invariant #27).
//
// The guard is a pure function defined in startup-guard.ts so it
// can be exercised here without loading the heavy Electron module or any of
// the real filesystem / IPC infrastructure.
//
// Invariant #27: `CHIMERA_DEBUG` must never appear in production packaging;
//   production build asserts `IS_DEBUG_MODE === false` at startup.

import { describe, it, expect } from 'vitest';
import { assertProductionDebugGuard } from './startup-guard.js';

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
        expect(() => assertProductionDebugGuard({ NODE_ENV: 'production' })).not.toThrow();
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
