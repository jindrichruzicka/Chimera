// electron/main/device-probe.test.ts
//
// Unit tests for buildDeviceInfo() and createDeviceProbeWatcher().
// Tests cover:
//   - OS/arch/platform field mapping
//   - SizeClass derivation at all breakpoint boundaries
//   - Display snapshot mapping (multi-display, primary flag)
//   - Watcher: re-fires callback on screen/resize events; Unsubscribe works
//   - Conservative defaults for renderer-only fields (battery, inputs)
//
// Follows TDD red-first; no Electron import — uses injected narrow ports.

import { describe, expect, it, vi } from 'vitest';
import {
    buildDeviceInfo,
    createDeviceProbeWatcher,
    deriveWindowSizeClass,
    SIZE_CLASS_COMPACT_MAX_EXCLUSIVE,
    SIZE_CLASS_REGULAR_MAX_INCLUSIVE,
    SIZE_CLASS_LARGE_MAX_INCLUSIVE,
    type DeviceProbeOptions,
    type ScreenPort,
} from './device-probe.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDisplay(
    opts: Partial<{
        id: number;
        width: number;
        height: number;
        scaleFactor: number;
        displayFrequency: number;
    }> = {},
) {
    return {
        id: opts.id ?? 1,
        bounds: { width: opts.width ?? 1920, height: opts.height ?? 1080 },
        scaleFactor: opts.scaleFactor ?? 1,
        displayFrequency: opts.displayFrequency ?? 60,
    };
}

function makeScreenPort(
    displays: ReturnType<typeof makeDisplay>[] = [makeDisplay()],
    primaryId = displays[0]?.id ?? 1,
): ScreenPort {
    const listeners = new Set<() => void>();
    return {
        getAllDisplays: () => displays,
        getPrimaryDisplayId: () => primaryId,
        on: (_event: 'display-metrics-changed', listener: () => void) => {
            listeners.add(listener);
        },
        off: (_event: 'display-metrics-changed', listener: () => void) => {
            listeners.delete(listener);
        },
        /** Test helper — not part of the port type. */
        _emit: () => {
            for (const l of listeners) l();
        },
    } as unknown as ScreenPort;
}

function makeBaseOptions(overrides: Partial<DeviceProbeOptions> = {}): DeviceProbeOptions {
    return {
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '23.6.0',
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        screen: makeScreenPort(),
        getWindowContentSize: () => [1440, 900],
        ...overrides,
    };
}

// ─── deriveWindowSizeClass ────────────────────────────────────────────────────

describe('deriveWindowSizeClass', () => {
    it('returns compact for widths below 960', () => {
        expect(deriveWindowSizeClass(0)).toBe('compact');
        expect(deriveWindowSizeClass(959)).toBe('compact');
    });

    it('returns regular at the 960 lower boundary and up to 1440 inclusive', () => {
        expect(deriveWindowSizeClass(960)).toBe('regular');
        expect(deriveWindowSizeClass(1440)).toBe('regular');
    });

    it('returns large from 1441 up to 2560 inclusive', () => {
        expect(deriveWindowSizeClass(1441)).toBe('large');
        expect(deriveWindowSizeClass(2560)).toBe('large');
    });

    it('returns ultrawide above 2560', () => {
        expect(deriveWindowSizeClass(2561)).toBe('ultrawide');
        expect(deriveWindowSizeClass(5120)).toBe('ultrawide');
    });
});

// ─── SizeClass constant contract (sync with renderer/device/DeviceInfo.ts) ───
//
// These tests pin the exported constant values so that any divergence between
// device-probe.ts and renderer/device/DeviceInfo.ts is caught at test time.
// If a breakpoint changes here, the mirror tests in renderer/device/DeviceInfo.test.ts
// will fail, and vice-versa.

describe('SizeClass breakpoint constant contract', () => {
    it('SIZE_CLASS_COMPACT_MAX_EXCLUSIVE is 960 (mirrors renderer/device/DeviceInfo.ts)', () => {
        expect(SIZE_CLASS_COMPACT_MAX_EXCLUSIVE).toBe(960);
    });

    it('SIZE_CLASS_REGULAR_MAX_INCLUSIVE is 1440 (mirrors renderer/device/DeviceInfo.ts)', () => {
        expect(SIZE_CLASS_REGULAR_MAX_INCLUSIVE).toBe(1440);
    });

    it('SIZE_CLASS_LARGE_MAX_INCLUSIVE is 2560 (mirrors renderer/device/DeviceInfo.ts)', () => {
        expect(SIZE_CLASS_LARGE_MAX_INCLUSIVE).toBe(2560);
    });
});

// ─── buildDeviceInfo ─────────────────────────────────────────────────────────

describe('buildDeviceInfo', () => {
    describe('platform / OS mapping', () => {
        it('maps darwin to macos', () => {
            const info = buildDeviceInfo(makeBaseOptions({ platform: 'darwin' }));
            expect(info.os).toBe('macos');
        });

        it('maps win32 to windows', () => {
            const info = buildDeviceInfo(makeBaseOptions({ platform: 'win32' }));
            expect(info.os).toBe('windows');
        });

        it('maps linux to linux', () => {
            const info = buildDeviceInfo(makeBaseOptions({ platform: 'linux' }));
            expect(info.os).toBe('linux');
        });

        it('maps unknown platforms to linux (conservative fallback)', () => {
            const info = buildDeviceInfo(
                makeBaseOptions({ platform: 'freebsd' as NodeJS.Platform }),
            );
            expect(info.os).toBe('linux');
        });
    });

    describe('arch mapping', () => {
        it('maps arm64 to arm64', () => {
            const info = buildDeviceInfo(makeBaseOptions({ arch: 'arm64' }));
            expect(info.arch).toBe('arm64');
        });

        it('maps x64 to x64', () => {
            const info = buildDeviceInfo(makeBaseOptions({ arch: 'x64' }));
            expect(info.arch).toBe('x64');
        });

        it('maps unknown arch to x64 (conservative fallback)', () => {
            const info = buildDeviceInfo(makeBaseOptions({ arch: 'ia32' }));
            expect(info.arch).toBe('x64');
        });
    });

    describe('version / locale fields', () => {
        it('copies osVersion, electronVer, chromiumVer, locale verbatim', () => {
            const info = buildDeviceInfo(
                makeBaseOptions({
                    osRelease: '14.5.0',
                    electronVer: '33.2.0',
                    chromiumVer: '130.0.0.0',
                    locale: 'de-DE',
                }),
            );
            expect(info.osVersion).toBe('14.5.0');
            expect(info.electronVer).toBe('33.2.0');
            expect(info.chromiumVer).toBe('130.0.0.0');
            expect(info.locale).toBe('de-DE');
        });
    });

    describe('display snapshot', () => {
        it('maps a single display correctly', () => {
            const display = makeDisplay({
                id: 42,
                width: 2560,
                height: 1440,
                scaleFactor: 2,
                displayFrequency: 144,
            });
            const screen = makeScreenPort([display], 42);
            const info = buildDeviceInfo(makeBaseOptions({ screen }));

            expect(info.screens).toHaveLength(1);
            const s = info.screens[0];
            expect(s?.id).toBe(42);
            expect(s?.width).toBe(2560);
            expect(s?.height).toBe(1440);
            expect(s?.pixelRatio).toBe(2);
            expect(s?.refreshHz).toBe(144);
            expect(s?.primary).toBe(true);
        });

        it('marks the correct display as primary in a multi-display setup', () => {
            const a = makeDisplay({ id: 1, width: 1920, height: 1080 });
            const b = makeDisplay({ id: 2, width: 2560, height: 1440 });
            const screen = makeScreenPort([a, b], 2);
            const info = buildDeviceInfo(makeBaseOptions({ screen }));

            expect(info.screens).toHaveLength(2);
            expect(info.screens[0]?.primary).toBe(false);
            expect(info.screens[1]?.primary).toBe(true);
        });
    });

    describe('windowSizeClass', () => {
        it('derives windowSizeClass from getWindowContentSize()', () => {
            const info = buildDeviceInfo(
                makeBaseOptions({ getWindowContentSize: () => [800, 600] }),
            );
            expect(info.windowSizeClass).toBe('compact');
        });

        it('re-derives on every call to buildDeviceInfo', () => {
            const infoA = buildDeviceInfo(
                makeBaseOptions({ getWindowContentSize: () => [1920, 1080] }),
            );
            const infoB = buildDeviceInfo(
                makeBaseOptions({ getWindowContentSize: () => [600, 400] }),
            );
            expect(infoA.windowSizeClass).toBe('large');
            expect(infoB.windowSizeClass).toBe('compact');
        });
    });

    describe('conservative renderer-side defaults', () => {
        it('sets formFactor to unknown', () => {
            const info = buildDeviceInfo(makeBaseOptions());
            expect(info.formFactor).toBe('unknown');
        });

        it('sets battery to null', () => {
            const info = buildDeviceInfo(makeBaseOptions());
            expect(info.battery).toBeNull();
        });

        it('sets inputs to [mouse, keyboard]', () => {
            const info = buildDeviceInfo(makeBaseOptions());
            expect(info.inputs).toEqual(['mouse', 'keyboard']);
        });

        it('sets primaryInput to mouse', () => {
            const info = buildDeviceInfo(makeBaseOptions());
            expect(info.primaryInput).toBe('mouse');
        });
    });
});

// ─── createDeviceProbeWatcher ─────────────────────────────────────────────────

describe('createDeviceProbeWatcher', () => {
    it('getCurrentInfo() returns current DeviceInfo immediately', () => {
        const watcher = createDeviceProbeWatcher(makeBaseOptions());
        const info = watcher.getCurrentInfo();

        expect(info.os).toBe('macos');
        expect(info.arch).toBe('arm64');
        watcher.dispose();
    });

    it('calls onChange callbacks when the screen fires display-metrics-changed', () => {
        const screenPort = makeScreenPort([makeDisplay({ id: 1, width: 1920 })]);
        const options = makeBaseOptions({ screen: screenPort });
        const watcher = createDeviceProbeWatcher(options);
        const callback = vi.fn();

        watcher.onChange(callback);

        // Simulate screen change
        (screenPort as unknown as { _emit: () => void })._emit();

        expect(callback).toHaveBeenCalledOnce();
        watcher.dispose();
    });

    it('passes updated DeviceInfo to onChange when window size changes', () => {
        let width = 1440;
        const options = makeBaseOptions({
            getWindowContentSize: () => [width, 900],
        });
        const watcher = createDeviceProbeWatcher(options);
        const screenPort = options.screen as unknown as { _emit: () => void };
        const seen: string[] = [];

        watcher.onChange((info) => {
            seen.push(info.windowSizeClass);
        });

        // Change width and emit
        width = 800;
        screenPort._emit();

        expect(seen).toEqual(['compact']);
        watcher.dispose();
    });

    it('Unsubscribe returned by onChange stops the callback from firing', () => {
        const screenPort = makeScreenPort();
        const options = makeBaseOptions({ screen: screenPort });
        const watcher = createDeviceProbeWatcher(options);
        const callback = vi.fn();

        const unsubscribe = watcher.onChange(callback);
        unsubscribe();

        (screenPort as unknown as { _emit: () => void })._emit();

        expect(callback).not.toHaveBeenCalled();
        watcher.dispose();
    });

    it('dispose() removes screen listener and stops firing callbacks', () => {
        const screenPort = makeScreenPort();
        const options = makeBaseOptions({ screen: screenPort });
        const watcher = createDeviceProbeWatcher(options);
        const callback = vi.fn();

        watcher.onChange(callback);
        watcher.dispose();

        (screenPort as unknown as { _emit: () => void })._emit();

        expect(callback).not.toHaveBeenCalled();
    });

    it('recompute() triggers onChange callbacks with fresh DeviceInfo', () => {
        let contentWidth = 1440;
        const options = makeBaseOptions({
            getWindowContentSize: () => [contentWidth, 900],
        });
        const watcher = createDeviceProbeWatcher(options);
        const seen: string[] = [];

        watcher.onChange((info) => seen.push(info.windowSizeClass));

        contentWidth = 800;
        watcher.recompute();

        expect(seen).toEqual(['compact']);
        watcher.dispose();
    });

    it('recompute() is a no-op after dispose()', () => {
        const options = makeBaseOptions();
        const watcher = createDeviceProbeWatcher(options);
        const callback = vi.fn();

        watcher.onChange(callback);
        watcher.dispose();
        watcher.recompute();

        expect(callback).not.toHaveBeenCalled();
    });
});
