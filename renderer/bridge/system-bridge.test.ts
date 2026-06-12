// @vitest-environment jsdom
// renderer/bridge/system-bridge.test.ts

import { describe, expect, it, vi } from 'vitest';
import { getSystemBridge } from './system-bridge';
import type { SystemAPI } from '@chimera/electron/preload/api-types.js';

describe('getSystemBridge', () => {
    it('returns null when source has no __chimera property', () => {
        expect(getSystemBridge({})).toBeNull();
    });

    it('returns null when __chimera has no system property', () => {
        expect(getSystemBridge({ __chimera: {} })).toBeNull();
    });

    it('returns the system API when present', () => {
        const system = {
            onConnectionStatus: vi.fn(),
            platform: vi.fn(),
            quit: vi.fn(),
            relaunch: vi.fn(),
            getDeviceInfo: vi.fn(),
            onDeviceInfoChange: vi.fn(),
            toggleDebugInspector: vi.fn(),
        } satisfies SystemAPI;

        expect(getSystemBridge({ __chimera: { system } })).toBe(system);
    });
});
