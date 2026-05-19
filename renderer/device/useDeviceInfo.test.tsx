// @vitest-environment jsdom

/**
 * renderer/device/useDeviceInfo.test.tsx
 *
 * Unit tests for useDeviceInfo, usePrimaryInput, and useWindowSizeClass hooks.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #590 (F42 — Implement DeviceInfoProvider and inputTracker)
 *
 * Invariants upheld:
 *   #83 — Consumer hooks throw descriptive errors when context is null.
 *   #65 — Renderer-only; no imports from electron/main, simulation, or ai.
 *
 * Tests written first (TDD — red confirmed).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DeviceInfo, InputModality, SizeClass } from './DeviceInfo.js';
import { DeviceInfoContext } from './DeviceInfoProvider.js';
import { useDeviceInfo, usePrimaryInput, useWindowSizeClass } from './useDeviceInfo.js';

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

function withDeviceInfo(info: DeviceInfo, children: React.ReactNode): React.ReactElement {
    return <DeviceInfoContext.Provider value={info}>{children}</DeviceInfoContext.Provider>;
}

afterEach(() => {
    cleanup();
});

// ─── useDeviceInfo ────────────────────────────────────────────────────────────

describe('useDeviceInfo', () => {
    it('returns the DeviceInfo from context', () => {
        const info = makeDeviceInfo({ os: 'linux' });

        function Probe(): React.ReactElement {
            const device = useDeviceInfo();
            return <div data-testid="probe" data-os={device.os} />;
        }

        render(withDeviceInfo(info, <Probe />));

        expect(screen.getByTestId('probe')).toHaveAttribute('data-os', 'linux');
    });

    it('throws a descriptive error when used outside DeviceInfoProvider', () => {
        function BareConsumer(): React.ReactElement {
            useDeviceInfo();
            return <div />;
        }

        expect(() => render(<BareConsumer />)).toThrow(
            'useDeviceInfo() must be used within DeviceInfoProvider',
        );
    });
});

// ─── usePrimaryInput ──────────────────────────────────────────────────────────

describe('usePrimaryInput', () => {
    it('returns the primaryInput from DeviceInfo', () => {
        const info = makeDeviceInfo({ primaryInput: 'keyboard' });

        function Probe(): React.ReactElement {
            const modality: InputModality = usePrimaryInput();
            return <div data-testid="probe" data-modality={modality} />;
        }

        render(withDeviceInfo(info, <Probe />));

        expect(screen.getByTestId('probe')).toHaveAttribute('data-modality', 'keyboard');
    });

    it('returns "gamepad" when primary input is gamepad', () => {
        const info = makeDeviceInfo({ primaryInput: 'gamepad' });

        function Probe(): React.ReactElement {
            const modality = usePrimaryInput();
            return <div data-testid="probe" data-modality={modality} />;
        }

        render(withDeviceInfo(info, <Probe />));

        expect(screen.getByTestId('probe')).toHaveAttribute('data-modality', 'gamepad');
    });

    it('throws a descriptive error when used outside DeviceInfoProvider', () => {
        function BareConsumer(): React.ReactElement {
            usePrimaryInput();
            return <div />;
        }

        expect(() => render(<BareConsumer />)).toThrow(
            'useDeviceInfo() must be used within DeviceInfoProvider',
        );
    });
});

// ─── useWindowSizeClass ───────────────────────────────────────────────────────

describe('useWindowSizeClass', () => {
    it('returns the windowSizeClass from DeviceInfo', () => {
        const info = makeDeviceInfo({ windowSizeClass: 'ultrawide' });

        function Probe(): React.ReactElement {
            const sizeClass: SizeClass = useWindowSizeClass();
            return <div data-testid="probe" data-size-class={sizeClass} />;
        }

        render(withDeviceInfo(info, <Probe />));

        expect(screen.getByTestId('probe')).toHaveAttribute('data-size-class', 'ultrawide');
    });

    it('returns "compact" for compact windows', () => {
        const info = makeDeviceInfo({ windowSizeClass: 'compact' });

        function Probe(): React.ReactElement {
            const sizeClass = useWindowSizeClass();
            return <div data-testid="probe" data-size-class={sizeClass} />;
        }

        render(withDeviceInfo(info, <Probe />));

        expect(screen.getByTestId('probe')).toHaveAttribute('data-size-class', 'compact');
    });

    it('throws a descriptive error when used outside DeviceInfoProvider', () => {
        function BareConsumer(): React.ReactElement {
            useWindowSizeClass();
            return <div />;
        }

        expect(() => render(<BareConsumer />)).toThrow(
            'useDeviceInfo() must be used within DeviceInfoProvider',
        );
    });
});
