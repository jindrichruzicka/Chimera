/**
 * apps/tactics/e2e/global-setup-reap.test.ts
 *
 * Guards the throwaway-profile reap, which is the one part of `globalSetup` that
 * has to be observed RUNNING rather than computed — so this file mocks the
 * bundling away and calls the default export.
 *
 * It is separate from `global-setup.test.ts` on purpose: that file's job is the
 * `VERIFY_PACK_NODE_MODULES_ENV` drift guard, which re-exports the literal from
 * `../electron/build-main`. Mocking that module in the same file would make the
 * drift guard assert against the mock and pass no matter what the real literal
 * says.
 */
import { describe, expect, it, vi } from 'vitest';
import { E2E_USER_DATA_ROOT } from './fixtures/user-data-root';

const { rmSyncMock } = vi.hoisted(() => ({ rmSyncMock: vi.fn<() => void>() }));

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('esbuild', () => ({ buildSync: vi.fn() }));
vi.mock('../electron/build-main', () => ({
    buildAppBundles: vi.fn(),
    VERIFY_PACK_NODE_MODULES_ENV: 'CHIMERA_VERIFY_PACK_NODE_MODULES',
}));
vi.mock('node:fs', () => ({
    cpSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    rmSync: rmSyncMock,
}));

const globalSetup = (await import('./global-setup')).default;

describe('globalSetup — throwaway Electron profiles', () => {
    it('removes the user-data root every run, so profiles cannot accumulate across runs', () => {
        globalSetup();

        expect(rmSyncMock).toHaveBeenCalledWith(E2E_USER_DATA_ROOT, {
            recursive: true,
            force: true,
        });
    });
});
