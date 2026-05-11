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

import { createContext, Script } from 'node:vm';
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

import {
    captureRelaunchConfig,
    relaunchElectronApplication,
    type RelaunchConfig,
} from './relaunch';

// ---------------------------------------------------------------------------
// Shared fake ElectronApplication
// ---------------------------------------------------------------------------

function makeFakeApp(): ElectronApplication {
    return { close: vi.fn() } as unknown as ElectronApplication;
}

interface SerializedProcessState {
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string | undefined>>;
}

function makeSerializedEvaluateApp(processState: SerializedProcessState): ElectronApplication {
    return {
        evaluate: vi.fn(async (callback: () => Promise<RelaunchConfig> | RelaunchConfig) => {
            // Playwright serializes evaluate callbacks into the Electron main process.
            // Running the callback from source text catches accidental closure captures.
            const sandbox = createContext({
                process: {
                    argv: [...processState.argv],
                    env: { ...processState.env },
                },
            });
            const result = new Script(`(${callback.toString()})()`).runInContext(sandbox);
            return (await result) as RelaunchConfig;
        }),
    } as unknown as ElectronApplication;
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// relaunchElectronApplication
// ---------------------------------------------------------------------------

describe('relaunchElectronApplication', () => {
    it('captures only relaunch-safe environment keys, including X11 DISPLAY', async () => {
        const fakeApp = makeSerializedEvaluateApp({
            argv: ['/Applications/Electron.app/Contents/MacOS/Electron', '/path/to/main.js'],
            env: {
                NODE_ENV: 'test',
                PATH: '/usr/bin',
                DISPLAY: ':99',
                CHIMERA_E2E: '1',
                CHIMERA_PORT: '7785',
                CHIMERA_E2E_FOO: 'bar',
                HOME: '/Users/should-not-forward',
                SECRET_TOKEN: 'do-not-forward',
            },
        });

        const config = await captureRelaunchConfig(fakeApp);

        expect(config.args).toEqual(['/path/to/main.js']);
        expect(config.env).toMatchObject({
            NODE_ENV: 'test',
            PATH: '/usr/bin',
            DISPLAY: ':99',
            CHIMERA_E2E: '1',
            CHIMERA_PORT: '7785',
            CHIMERA_E2E_FOO: 'bar',
        });
        expect(config.env).not.toHaveProperty('HOME');
        expect(config.env).not.toHaveProperty('SECRET_TOKEN');
        expect(
            Object.keys(config.env).every(
                (key) =>
                    key === 'CHIMERA_E2E' ||
                    key === 'CHIMERA_PORT' ||
                    key === 'DISPLAY' ||
                    key === 'NODE_ENV' ||
                    key === 'PATH' ||
                    key.startsWith('CHIMERA_E2E_'),
            ),
        ).toBe(true);
    });

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
