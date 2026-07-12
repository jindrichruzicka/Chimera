// renderer/app/bootSmoke.test.ts
//
// Unit tests for the M1 preload-bridge boot-smoke helper.

import { describe, expect, it, vi } from 'vitest';
import { logPlatformOnBoot, type BootSmokeBridge } from './bootSmoke.js';

function makeBridge(
    platform: () => Promise<{ os: 'macos' | 'windows' | 'linux'; version: string }>,
): BootSmokeBridge {
    return {
        system: {
            platform,
            onConnectionStatus: () => () => undefined,
            quit: () => undefined,
            relaunch: () => undefined,
            getDeviceInfo: () => Promise.reject(new Error('not implemented')),
            onDeviceInfoChange: () => () => undefined,
            onI18nTokenMode: () => () => undefined,
            toggleDebugInspector: () => Promise.resolve(),
        },
    };
}

describe('logPlatformOnBoot', () => {
    it('logs the resolved platform info when the bridge is live', async () => {
        const logger = vi.fn();
        const bridge = makeBridge(() => Promise.resolve({ os: 'macos', version: '14.0' }));

        await logPlatformOnBoot(bridge, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith('[chimera] preload bridge live', {
            os: 'macos',
            version: '14.0',
        });
    });

    it('logs an unavailable-bridge message when the bridge is missing', async () => {
        const logger = vi.fn();

        await logPlatformOnBoot(undefined, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith('[chimera] preload bridge unavailable');
    });

    it('logs the error when platform() rejects', async () => {
        const logger = vi.fn();
        const failure = new Error('ipc-broken');
        const bridge = makeBridge(() => Promise.reject(failure));

        await logPlatformOnBoot(bridge, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith('[chimera] preload bridge platform() failed', failure);
    });

    it('awaits the platform() promise before returning', async () => {
        const logger = vi.fn();
        let resolve: ((value: { os: 'linux'; version: string }) => void) | undefined;
        const pending = new Promise<{ os: 'linux'; version: string }>((r) => {
            resolve = r;
        });
        const bridge = makeBridge(() => pending);

        const done = logPlatformOnBoot(bridge, logger);
        expect(logger).not.toHaveBeenCalled();
        resolve?.({ os: 'linux', version: '6.0' });
        await done;
        expect(logger).toHaveBeenCalledWith('[chimera] preload bridge live', {
            os: 'linux',
            version: '6.0',
        });
    });
});
