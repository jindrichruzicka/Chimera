/**
 * e2e/helpers/relaunch.test.ts
 *
 * Unit tests for the relaunch helper. Mocks _electron.launch to verify:
 *   - the helper delegates to _electron.launch with correct args + env
 *   - extraEnv overrides are merged on top of the base env
 *   - the resolved ElectronApplication is returned to the caller
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Related fix: BLOCK-3 — reconnect spec must not import _electron directly
 *
 * Tests written FIRST (red confirmed before implementation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ElectronApplication } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock @playwright/test._electron before importing the module under test
// vi.hoisted ensures the factory variable is available when vi.mock is hoisted
// ---------------------------------------------------------------------------

const { mockLaunch } = vi.hoisted(() => ({
    mockLaunch: vi.fn<() => Promise<ElectronApplication>>(),
}));

vi.mock('@playwright/test', () => ({
    _electron: { launch: mockLaunch },
}));

import { relaunchElectronApplication, type RelaunchConfig } from './relaunch';

// ---------------------------------------------------------------------------
// Shared fake ElectronApplication
// ---------------------------------------------------------------------------

function makeFakeApp(): ElectronApplication {
    return { close: vi.fn() } as unknown as ElectronApplication;
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// relaunchElectronApplication
// ---------------------------------------------------------------------------

describe('relaunchElectronApplication', () => {
    it('calls electron.launch with the provided args and env', async () => {
        const fakeApp = makeFakeApp();
        mockLaunch.mockResolvedValueOnce(fakeApp);

        const config: RelaunchConfig = {
            args: ['/path/to/main.js', '--user-data-dir=/tmp/test'],
            env: { NODE_ENV: 'test', CHIMERA_E2E: '1' },
        };

        await relaunchElectronApplication(config);

        expect(mockLaunch).toHaveBeenCalledOnce();
        expect(mockLaunch).toHaveBeenCalledWith({
            args: ['/path/to/main.js', '--user-data-dir=/tmp/test'],
            env: { NODE_ENV: 'test', CHIMERA_E2E: '1' },
        });
    });

    it('returns the ElectronApplication resolved by electron.launch', async () => {
        const fakeApp = makeFakeApp();
        mockLaunch.mockResolvedValueOnce(fakeApp);

        const config: RelaunchConfig = {
            args: ['/path/to/main.js'],
            env: {},
        };

        const result = await relaunchElectronApplication(config);

        expect(result).toBe(fakeApp);
    });

    it('merges extraEnv on top of the base env when provided', async () => {
        const fakeApp = makeFakeApp();
        mockLaunch.mockResolvedValueOnce(fakeApp);

        const config: RelaunchConfig = {
            args: ['/path/to/main.js'],
            env: { NODE_ENV: 'test', CHIMERA_ROLE: 'host' },
        };

        await relaunchElectronApplication(config, { CHIMERA_ROLE: 'client' });

        expect(mockLaunch).toHaveBeenCalledWith({
            args: ['/path/to/main.js'],
            env: { NODE_ENV: 'test', CHIMERA_ROLE: 'client' },
        });
    });

    it('does not mutate the base env object when extra env is provided', async () => {
        const fakeApp = makeFakeApp();
        mockLaunch.mockResolvedValueOnce(fakeApp);

        const baseEnv: Record<string, string> = { NODE_ENV: 'test', CHIMERA_ROLE: 'host' };
        const config: RelaunchConfig = { args: [], env: baseEnv };

        await relaunchElectronApplication(config, { CHIMERA_ROLE: 'client' });

        expect(baseEnv['CHIMERA_ROLE']).toBe('host');
    });
});
