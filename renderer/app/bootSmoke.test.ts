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
            toggleI18nTokenMode: () => Promise.resolve(),
        },
    };
}

describe('logPlatformOnBoot', () => {
    // The logger port carries a severity so the page adapter can route success
    // to the unforwarded `console.log` (§4.27) and both failure paths to the
    // forwarded `console.warn` — the messages wanted in the log file when a
    // packaged build boots to a blank window.
    it('logs the resolved platform info at info level when the bridge is live', async () => {
        const logger = vi.fn();
        const bridge = makeBridge(() => Promise.resolve({ os: 'macos', version: '14.0' }));

        await logPlatformOnBoot(bridge, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith('info', '[chimera] preload bridge live', {
            os: 'macos',
            version: '14.0',
        });
    });

    it('logs an unavailable-bridge message at warn level when the bridge is missing', async () => {
        const logger = vi.fn();

        await logPlatformOnBoot(undefined, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith('warn', '[chimera] preload bridge unavailable');
    });

    it('logs the error at warn level when platform() rejects', async () => {
        const logger = vi.fn();
        const failure = new Error('ipc-broken');
        const bridge = makeBridge(() => Promise.reject(failure));

        await logPlatformOnBoot(bridge, logger);

        expect(logger).toHaveBeenCalledTimes(1);
        expect(logger).toHaveBeenCalledWith(
            'warn',
            '[chimera] preload bridge platform() failed',
            failure,
        );
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
        expect(logger).toHaveBeenCalledWith('info', '[chimera] preload bridge live', {
            os: 'linux',
            version: '6.0',
        });
    });
});
