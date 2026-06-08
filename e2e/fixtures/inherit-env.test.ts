/**
 * e2e/fixtures/inherit-env.test.ts
 *
 * Unit tests for the launch-env builder. Verifies that the env handed to
 * electron.launch:
 *   - strips ELECTRON_RUN_AS_NODE (a parent-env value forces Electron to boot
 *     as plain Node, which rejects Chromium flags like --remote-debugging-port=0
 *     and breaks every Playwright E2E launch)
 *   - drops undefined values (electron.launch's env type forbids them)
 *   - preserves all other variables
 *
 * Tests written FIRST (red confirmed before implementation).
 */

import { describe, it, expect } from 'vitest';
import { inheritEnv } from './inherit-env';

describe('inheritEnv', () => {
    it('strips ELECTRON_RUN_AS_NODE so the launched Electron is not forced into Node mode', () => {
        const result = inheritEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' });

        expect(result['ELECTRON_RUN_AS_NODE']).toBeUndefined();
        expect(result['PATH']).toBe('/usr/bin');
    });

    it('drops undefined values to satisfy the launch env type', () => {
        const result = inheritEnv({ DEFINED: 'x', MISSING: undefined });

        expect(result).toEqual({ DEFINED: 'x' });
    });

    it('preserves unrelated variables verbatim', () => {
        const result = inheritEnv({ FOO: 'bar', BAZ: 'qux' });

        expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('defaults to process.env when no source is provided', () => {
        process.env['CHIMERA_INHERIT_ENV_SENTINEL'] = 'present';
        try {
            const result = inheritEnv();
            expect(result['CHIMERA_INHERIT_ENV_SENTINEL']).toBe('present');
        } finally {
            delete process.env['CHIMERA_INHERIT_ENV_SENTINEL'];
        }
    });
});
