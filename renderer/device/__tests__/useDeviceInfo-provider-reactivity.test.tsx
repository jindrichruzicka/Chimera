// @vitest-environment jsdom

/**
 * renderer/device/__tests__/useDeviceInfo-provider-reactivity.test.tsx
 *
 * Integration tests: DeviceInfoProvider reactivity with consumer hooks.
 * Exercises the full coupling between DeviceInfoProvider (async getDeviceInfo +
 * onDeviceInfoChange subscription) and useWindowSizeClass.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #591 (F42 — Implement DeviceInfo hooks)
 *
 * Invariants upheld:
 *   #83 — Consumer hooks re-render when provider pushes new DeviceInfo.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';

import type { DeviceInfo } from '../DeviceInfo.js';
import { DeviceInfoProvider, type DeviceInfoSystemApi } from '../DeviceInfoProvider.js';
import { useWindowSizeClass } from '../useDeviceInfo.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────

function makeDeviceInfo(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
    return {
        os: 'macos',
        osVersion: '14.5.0',
        arch: 'arm64',
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        formFactor: 'desktop',
        screens: [
            { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
        ],
        windowSizeClass: 'regular',
        inputs: ['mouse', 'keyboard'],
        primaryInput: 'mouse',
        battery: null,
        ...overrides,
    };
}

interface TestDeviceInfoSystemApi extends DeviceInfoSystemApi {
    pushChange(info: DeviceInfo): void;
}

function makeSystemApi(initial: DeviceInfo): TestDeviceInfoSystemApi {
    let changeCallback: ((info: DeviceInfo) => void) | null = null;

    return {
        async getDeviceInfo(): Promise<DeviceInfo> {
            return initial;
        },
        onDeviceInfoChange(callback: (info: DeviceInfo) => void): () => void {
            changeCallback = callback;
            return () => {
                changeCallback = null;
            };
        },
        pushChange(info: DeviceInfo): void {
            changeCallback?.(info);
        },
    };
}

afterEach(() => {
    cleanup();
});

// ─── Provider reactivity ──────────────────────────────────────────────────────

describe('useWindowSizeClass + DeviceInfoProvider reactivity', () => {
    it('re-renders when DeviceInfoProvider publishes a new windowSizeClass', async () => {
        const systemApi = makeSystemApi(makeDeviceInfo({ windowSizeClass: 'large' }));

        function Probe(): React.ReactElement {
            const sizeClass = useWindowSizeClass();
            return <div data-testid="probe" data-size-class={sizeClass} />;
        }

        render(
            <DeviceInfoProvider systemApi={systemApi}>
                <Probe />
            </DeviceInfoProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('probe')).toHaveAttribute('data-size-class', 'large');
        });

        act(() => systemApi.pushChange(makeDeviceInfo({ windowSizeClass: 'compact' })));

        await waitFor(() => {
            expect(screen.getByTestId('probe')).toHaveAttribute('data-size-class', 'compact');
        });
    });
});
