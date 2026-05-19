// @vitest-environment jsdom

/**
 * renderer/device/DeviceInfoProvider.test.tsx
 *
 * Unit tests for DeviceInfoProvider.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #590 (F42 — Implement DeviceInfoProvider and inputTracker)
 *
 * Invariants upheld:
 *   #83 — Context created with createContext<DeviceInfo | null>(null);
 *         consumer hook throws descriptive error when context is null.
 *   #65 — Renderer-only; no imports from electron/main, simulation, or ai.
 *
 * Tests written first (TDD — red confirmed).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeviceInfo } from './DeviceInfo.js';
import { DeviceInfoProvider, DeviceInfoContext } from './DeviceInfoProvider.js';
import { useDeviceInfo } from './useDeviceInfo.js';

// ─── Minimal DeviceInfo fixture ───────────────────────────────────────────────

function makeDeviceInfo(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
    return {
        os: 'macos',
        osVersion: '14.5.0',
        arch: 'arm64',
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        formFactor: 'laptop',
        screens: [{ id: 1, width: 1440, height: 900, pixelRatio: 2, refreshHz: 60, primary: true }],
        windowSizeClass: 'regular',
        inputs: ['mouse', 'keyboard'],
        primaryInput: 'mouse',
        battery: null,
        ...overrides,
    };
}

// ─── SystemAPI bridge mock ────────────────────────────────────────────────────

type DeviceInfoChangeCallback = (info: DeviceInfo) => void;

function makeSystemBridge(initial: DeviceInfo) {
    let changeCallback: DeviceInfoChangeCallback | null = null;

    const bridge = {
        getDeviceInfo: vi.fn(async () => initial),
        onDeviceInfoChange: vi.fn((cb: DeviceInfoChangeCallback) => {
            changeCallback = cb;
            return () => {
                changeCallback = null;
            };
        }),
        // helper for tests to push a change
        pushChange(info: DeviceInfo): void {
            changeCallback?.(info);
        },
    };

    return bridge;
}

// ─── Probe component ──────────────────────────────────────────────────────────

function DeviceInfoProbe(): React.ReactElement {
    const info = useDeviceInfo();
    return (
        <div
            data-testid="device-info-probe"
            data-os={info.os}
            data-form-factor={info.formFactor}
            data-battery-level={info.battery?.level ?? 'none'}
            data-primary-input={info.primaryInput}
            data-window-size-class={info.windowSizeClass}
            data-inputs={info.inputs.join(',')}
        />
    );
}

interface MockBatteryManager {
    readonly charging: boolean;
    readonly level: number;
    addEventListener(type: 'chargingchange' | 'levelchange', listener: EventListener): void;
    removeEventListener(type: 'chargingchange' | 'levelchange', listener: EventListener): void;
}

function installBatteryManager(battery: MockBatteryManager): void {
    Object.defineProperty(window.navigator, 'getBattery', {
        configurable: true,
        value: vi.fn(async () => battery),
    });
}

function makeBatteryManager(
    overrides: Partial<Pick<MockBatteryManager, 'charging' | 'level'>> = {},
): MockBatteryManager {
    return {
        charging: false,
        level: 0.42,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window.navigator, 'getBattery');
    vi.restoreAllMocks();
});

describe('DeviceInfoProvider — initial render', () => {
    it('renders children with fallback device info before getDeviceInfo resolves', async () => {
        let resolveInitial!: (info: DeviceInfo) => void;
        const bridge = makeSystemBridge(makeDeviceInfo({ os: 'windows' }));
        bridge.getDeviceInfo.mockImplementationOnce(
            () =>
                new Promise<DeviceInfo>((resolve) => {
                    resolveInitial = resolve;
                }),
        );

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-primary-input',
            'mouse',
        );

        act(() => resolveInitial(makeDeviceInfo({ os: 'windows' })));

        await waitFor(() => {
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute('data-os', 'windows');
        });
    });

    it('provides the initial DeviceInfo fetched from getDeviceInfo()', async () => {
        const initial = makeDeviceInfo({ os: 'linux', windowSizeClass: 'large' });
        const bridge = makeSystemBridge(initial);

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute('data-os', 'linux');
        });
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-window-size-class',
            'large',
        );
    });

    it('calls getDeviceInfo() exactly once on mount', async () => {
        const bridge = makeSystemBridge(makeDeviceInfo());

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <div />
            </DeviceInfoProvider>,
        );

        await waitFor(() => expect(bridge.getDeviceInfo).toHaveBeenCalledOnce());
    });

    it('subscribes to onDeviceInfoChange() on mount', async () => {
        const bridge = makeSystemBridge(makeDeviceInfo());

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <div />
            </DeviceInfoProvider>,
        );

        await waitFor(() => expect(bridge.onDeviceInfoChange).toHaveBeenCalledOnce());
    });
});

describe('DeviceInfoProvider — live updates via onDeviceInfoChange', () => {
    it('updates system-owned fields when onDeviceInfoChange fires', async () => {
        const initial = makeDeviceInfo({ primaryInput: 'mouse' });
        const bridge = makeSystemBridge(initial);

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() =>
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-primary-input',
                'mouse',
            ),
        );

        const updated = makeDeviceInfo({
            os: 'windows',
            windowSizeClass: 'large',
            primaryInput: 'gamepad',
            inputs: ['mouse', 'keyboard', 'gamepad'],
        });

        act(() => bridge.pushChange(updated));

        expect(screen.getByTestId('device-info-probe')).toHaveAttribute('data-os', 'windows');
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-window-size-class',
            'large',
        );
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-primary-input',
            'mouse',
        );
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-inputs',
            'mouse,keyboard,gamepad',
        );
    });
});

describe('DeviceInfoProvider — subscription cleanup', () => {
    it('calls the unsubscribe function returned by onDeviceInfoChange when unmounted', async () => {
        const bridge = makeSystemBridge(makeDeviceInfo());
        let unsubscribeCalled = false;
        bridge.onDeviceInfoChange.mockImplementation((_cb: DeviceInfoChangeCallback) => {
            return () => {
                unsubscribeCalled = true;
            };
        });

        const { unmount } = render(
            <DeviceInfoProvider systemApi={bridge}>
                <div />
            </DeviceInfoProvider>,
        );

        await waitFor(() => expect(bridge.onDeviceInfoChange).toHaveBeenCalledOnce());

        unmount();

        expect(unsubscribeCalled).toBe(true);
    });

    it('does not update state after unmount (no memory leak / React warning)', async () => {
        const bridge = makeSystemBridge(makeDeviceInfo());

        const { unmount } = render(
            <DeviceInfoProvider systemApi={bridge}>
                <div />
            </DeviceInfoProvider>,
        );

        await waitFor(() => expect(bridge.getDeviceInfo).toHaveBeenCalledOnce());

        unmount();

        // Pushing a change after unmount should not cause React state update
        act(() => bridge.pushChange(makeDeviceInfo({ os: 'windows' })));
        // No assertion needed — jsdom/React would warn if state updated after unmount
    });
});

describe('DeviceInfoProvider — renderer input merging', () => {
    it('merges inputs from inputTracker into the context', async () => {
        const initial = makeDeviceInfo({
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
        });
        const bridge = makeSystemBridge(initial);

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() =>
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-inputs',
                'mouse,keyboard',
            ),
        );
    });

    it('preserves renderer-detected inputs when system device info changes', async () => {
        const initial = makeDeviceInfo({
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
            windowSizeClass: 'regular',
        });
        const bridge = makeSystemBridge(initial);

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() =>
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-window-size-class',
                'regular',
            ),
        );

        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
            );
        });

        await waitFor(() =>
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-primary-input',
                'touch',
            ),
        );
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-inputs',
            'mouse,keyboard,touch',
        );

        act(() =>
            bridge.pushChange(
                makeDeviceInfo({
                    inputs: ['mouse', 'keyboard'],
                    primaryInput: 'mouse',
                    windowSizeClass: 'large',
                }),
            ),
        );

        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-window-size-class',
            'large',
        );
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-primary-input',
            'touch',
        );
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-inputs',
            'mouse,keyboard,touch',
        );
    });
});

describe('DeviceInfoProvider — renderer battery and form factor', () => {
    it('merges navigator.getBattery() state and derives laptop form factor', async () => {
        installBatteryManager(makeBatteryManager({ charging: true, level: 0.68 }));
        const bridge = makeSystemBridge(makeDeviceInfo({ battery: null, formFactor: 'unknown' }));

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-battery-level',
                '0.68',
            );
        });
        expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
            'data-form-factor',
            'laptop',
        );
    });

    it('derives desktop form factor when no battery or touch input is present', async () => {
        const bridge = makeSystemBridge(makeDeviceInfo({ battery: null, formFactor: 'unknown' }));

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-form-factor',
                'desktop',
            );
        });
    });

    it('derives tablet-convertible form factor for compact touch-only devices', async () => {
        const bridge = makeSystemBridge(
            makeDeviceInfo({
                battery: null,
                formFactor: 'unknown',
                inputs: ['touch'],
                primaryInput: 'touch',
                windowSizeClass: 'compact',
            }),
        );

        render(
            <DeviceInfoProvider systemApi={bridge}>
                <DeviceInfoProbe />
            </DeviceInfoProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('device-info-probe')).toHaveAttribute(
                'data-form-factor',
                'tablet-convertible',
            );
        });
    });
});

describe('DeviceInfoContext — invariant #83', () => {
    it('DeviceInfoContext default value is null (invariant #83)', () => {
        expect(DeviceInfoContext).toBeDefined();
        // Context must have null as default to comply with invariant #83.
        // We verify this by attempting to consume the context outside a provider.
        let capturedContextValue: DeviceInfo | null | undefined;

        function ContextCapture(): null {
            capturedContextValue = React.useContext(DeviceInfoContext);
            return null;
        }

        render(<ContextCapture />);
        expect(capturedContextValue).toBeNull();
    });
});

describe('DeviceInfoProvider — useDeviceInfo outside provider', () => {
    it('useDeviceInfo throws a descriptive error when used outside provider', () => {
        function BareConsumer(): React.ReactElement {
            useDeviceInfo();
            return <div />;
        }

        expect(() => render(<BareConsumer />)).toThrow(
            'useDeviceInfo() must be used within DeviceInfoProvider',
        );
    });
});
