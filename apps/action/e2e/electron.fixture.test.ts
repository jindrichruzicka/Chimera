/**
 * Shape-check for the action suite's base Electron fixture.
 *
 * A Vitest unit test, not a Playwright spec: it builds launch configs without
 * starting Electron, so a fixture regression reds in the fast loop rather than
 * as eight simultaneous launch timeouts.
 */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The real module's shape, so `vi.mock` can keep every named export and replace
// only the default — the factory must not drop the layout helpers the fixture
// imports from the same module.
import type * as ActionGlobalSetup from './global-setup';

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

vi.mock('./global-setup', async (importOriginal) => {
    const actual = await importOriginal<typeof ActionGlobalSetup>();
    return { ...actual, default: globalSetupMock };
});

const { ACTION_MENU_ROUTE, actionRoute, createE2eElectronLaunchConfig } =
    await import('./fixtures/electron.fixture');
import { E2E_USER_DATA_ROOT } from './fixtures/user-data-root';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('actionRoute', () => {
    it('stamps the game context onto a bare route', () => {
        // Production launches at `/main-menu/?gameId=action` and every shell hop
        // carries the id forward; a spec that dropped it would browse the
        // ENGINE-default menu and see none of this game's entries.
        expect(actionRoute('/select')).toBe('/select?gameId=action');
    });

    it('boots at the main menu by default', () => {
        expect(ACTION_MENU_ROUTE).toBe('/main-menu?gameId=action');
    });
});

describe('action electron.fixture launch config', () => {
    it('defaults the initial URL to this game’s main menu', () => {
        const config = createE2eElectronLaunchConfig({ port: '7810' });

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBe(
            'chimera://renderer/main-menu/?gameId=action',
        );
    });

    it('puts the static-export trailing slash BEFORE the query, not after it', () => {
        const config = createE2eElectronLaunchConfig({
            port: '7810',
            initialRoute: '/select?gameId=action',
        });

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBe(
            'chimera://renderer/select/?gameId=action',
        );
    });

    it('leaves an already-slashed route alone', () => {
        const config = createE2eElectronLaunchConfig({ port: '7810', initialRoute: '/settings/' });

        expect(config.env['CHIMERA_E2E_INITIAL_URL']).toBe('chimera://renderer/settings/');
    });

    it('launches the ACTION app’s own bundled main, under its own build root', () => {
        const config = createE2eElectronLaunchConfig({ port: '7810' });

        expect(config.args[0]).toBe(
            path.join(REPO_ROOT, '.e2e-build-action/electron/main/index.js'),
        );
        expect(config.env['CHIMERA_E2E_PRELOAD_PATH']).toBe(
            path.join(REPO_ROOT, '.e2e-build-action/electron/preload/api.js'),
        );
        expect(config.env['CHIMERA_E2E_RENDERER_ENTRY']).toBe(
            path.join(REPO_ROOT, 'apps/action/renderer/out/index.html'),
        );
    });

    it('points E2E game assets at the workspace apps directory', () => {
        const config = createE2eElectronLaunchConfig({ port: '7810' });

        expect(config.env['CHIMERA_E2E_GAME_ASSETS_ROOT']).toBe(path.join(REPO_ROOT, 'apps'));
    });

    it('sets the E2E flag and the test environment, and carries the requested port', () => {
        const config = createE2eElectronLaunchConfig({ port: '7813' });

        expect(config.env['CHIMERA_E2E']).toBe('1');
        expect(config.env['NODE_ENV']).toBe('test');
        expect(config.env['CHIMERA_PORT']).toBe('7813');
    });

    it('never inherits CHIMERA_DEBUG from the developer’s shell (Invariant #27)', () => {
        vi.stubEnv('CHIMERA_DEBUG', '1');
        try {
            expect(createE2eElectronLaunchConfig({ port: '7810' }).env['CHIMERA_DEBUG']).toBe(
                undefined,
            );
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('mints a FRESH profile per launch, under the reaped root', () => {
        const first = userDataDirOf(createE2eElectronLaunchConfig({ port: '7810' }).args);
        const second = userDataDirOf(createE2eElectronLaunchConfig({ port: '7810' }).args);

        // Same port, same process: only the per-launch counter separates them.
        // Without it a relaunch would re-open the previous app's profile and
        // "a fresh profile has no autosave" would become a fact about test order.
        expect(first).not.toBe(second);
        for (const dir of [first, second]) {
            expect(path.dirname(dir)).toBe(E2E_USER_DATA_ROOT);
            expect(path.basename(dir).startsWith(`${String(process.pid)}-`)).toBe(true);
        }
    });
});

function userDataDirOf(args: readonly string[]): string {
    const flag = args.find((arg) => arg.startsWith('--user-data-dir='));
    if (flag === undefined) {
        throw new Error(`no --user-data-dir in ${JSON.stringify(args)}`);
    }
    return flag.slice('--user-data-dir='.length);
}
