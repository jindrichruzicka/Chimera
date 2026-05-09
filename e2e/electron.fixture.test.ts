/**
 * Structural shape-check for the base Electron fixture module.
 *
 * This is a Vitest unit test, not a Playwright E2E spec. It validates launch
 * config construction without starting Electron, keeping fixture API regressions
 * in the fast unit-test loop.
 */
import { describe, expect, it, vi } from 'vitest';

const { existsSyncMock, globalSetupMock } = vi.hoisted(() => ({
    existsSyncMock: vi.fn<() => boolean>(() => true),
    globalSetupMock: vi.fn<() => void>(),
}));

vi.mock('node:fs', () => ({
    existsSync: existsSyncMock,
}));

vi.mock('./global-setup', () => ({
    default: globalSetupMock,
}));

const { createE2eElectronLaunchConfig } = await import('./fixtures/electron.fixture');
import type { E2eElectronLaunchOptions } from './fixtures/electron.fixture';

describe('electron.fixture', () => {
    it('sets CHIMERA_E2E_INITIAL_URL when initialRoute is provided', () => {
        const options: E2eElectronLaunchOptions = {
            port: '7778',
            role: 'host',
            initialRoute: '/lobby',
        };

        const config = createE2eElectronLaunchConfig(options);

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBe('chimera://renderer/lobby/');
    });

    it('omits CHIMERA_E2E_INITIAL_URL when initialRoute is not provided', () => {
        const config = createE2eElectronLaunchConfig({ port: '7778' });

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBeUndefined();
    });

    it('omits first-player launch configuration by default', () => {
        const config = createE2eElectronLaunchConfig({ port: '7778' });

        expect(config.env['CHIMERA_E2E_FIRST_PLAYER']).toBeUndefined();
    });
});
