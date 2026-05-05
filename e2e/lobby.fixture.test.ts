/**
 * Structural shape-check for the lobby fixture module.
 *
 * WHY THIS IS A VITEST FILE INSIDE e2e/:
 * This is an intentional hybrid — a Vitest unit test that validates the module-level
 * exports of the Playwright fixture without launching Electron.  It checks that
 * `lobby.fixture.ts` exports a composable `test.extend` and a `expect` callable, so
 * mis-exports are caught in the fast Vitest run rather than discovered only during a
 * full Playwright E2E run.
 *
 * Per §12.3 this pattern (Vitest shape-check co-located with the module under test) is
 * used here deliberately; it does NOT conflict with the E2E spec convention
 * (e2e/tests/*.spec.ts) because no Electron process is launched.
 */
import { describe, expect as vitestExpect, it } from 'vitest';
import { expect as playwrightExpect, test as lobbyTest } from './fixtures/lobby.fixture';

describe('lobby.fixture', () => {
    it('exports a Playwright test fixture and expect', () => {
        vitestExpect(typeof lobbyTest.extend).toBe('function');
        vitestExpect(typeof playwrightExpect).toBe('function');
    });
});
