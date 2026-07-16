/**
 * Structural shape-check for the base Electron fixture module.
 *
 * This is a Vitest unit test, not a Playwright E2E spec. It validates launch
 * config construction without starting Electron, keeping fixture API regressions
 * in the fast unit-test loop.
 */
import { describe, expect, it, vi } from 'vitest';
import path from 'path';

const { existsSyncMock, mkdirSyncMock, rmSyncMock, globalSetupMock } = vi.hoisted(() => ({
    existsSyncMock: vi.fn<() => boolean>(() => true),
    mkdirSyncMock: vi.fn<() => void>(),
    rmSyncMock: vi.fn<() => void>(),
    globalSetupMock: vi.fn<() => void>(),
}));

vi.mock('node:fs', () => ({
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    rmSync: rmSyncMock,
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

    it('points E2E game assets at the workspace apps directory', () => {
        const config = createE2eElectronLaunchConfig({ port: '7778' });

        expect(config.env['CHIMERA_E2E_GAME_ASSETS_ROOT']).toBe(
            path.resolve(__dirname, '../../..', 'apps'),
        );
    });

    it('defaults direct-game launches to the game route when initialRoute is omitted', () => {
        const config = createE2eElectronLaunchConfig({
            port: '7785',
            directGameRole: 'host',
        });

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBe('chimera://renderer/game/');
    });

    it('omits first-player launch configuration by default', () => {
        const config = createE2eElectronLaunchConfig({ port: '7778' });

        expect(config.env['CHIMERA_E2E_FIRST_PLAYER']).toBeUndefined();
    });

    it('sets CHIMERA_DEBUG=1 when debugMode is enabled', () => {
        const config = createE2eElectronLaunchConfig({ port: '7779', debugMode: true });

        expect(config.env['CHIMERA_DEBUG']).toBe('1');
    });

    it('omits CHIMERA_DEBUG by default so launches stay non-debug', () => {
        const config = createE2eElectronLaunchConfig({ port: '7779' });

        expect(config.env['CHIMERA_DEBUG']).toBeUndefined();
    });

    it('sets CHIMERA_E2E_DISABLE_SPECTATORS=1 when disableSpectators is enabled', () => {
        const config = createE2eElectronLaunchConfig({ port: '7779', disableSpectators: true });

        expect(config.env['CHIMERA_E2E_DISABLE_SPECTATORS']).toBe('1');
    });

    it('omits CHIMERA_E2E_DISABLE_SPECTATORS by default so the manifest capability stands', () => {
        const config = createE2eElectronLaunchConfig({ port: '7779' });

        expect(config.env['CHIMERA_E2E_DISABLE_SPECTATORS']).toBeUndefined();
    });

    it('assigns a fresh isolated Electron userData directory to each launch', () => {
        const hostConfig = createE2eElectronLaunchConfig({ port: '7779', role: 'host' });
        const clientConfig = createE2eElectronLaunchConfig({ port: '7779', role: 'client' });

        const hostUserDataArg = hostConfig.args.find((arg) => arg.startsWith('--user-data-dir='));
        const clientUserDataArg = clientConfig.args.find((arg) =>
            arg.startsWith('--user-data-dir='),
        );

        expect(hostUserDataArg).toBeDefined();
        expect(clientUserDataArg).toBeDefined();
        expect(hostUserDataArg).not.toBe(clientUserDataArg);
        expect(hostUserDataArg).toContain('chimera-e2e-userdata');
        expect(clientUserDataArg).toContain('chimera-e2e-userdata');
    });
});
