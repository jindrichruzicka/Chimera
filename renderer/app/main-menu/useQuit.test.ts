// renderer/app/main-menu/useQuit.test.ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSystemBridge, useQuit } from './useQuit';
import type { SystemAPI } from '@chimera/electron/preload/api-types.js';

// ── getSystemBridge ───────────────────────────────────────────────────────────

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
        } satisfies SystemAPI;

        expect(getSystemBridge({ __chimera: { system } })).toBe(system);
    });
});

// ── useQuit ───────────────────────────────────────────────────────────────────

describe('useQuit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('returns a stable function reference', () => {
        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: { system: { quit: vi.fn() } },
        });

        const { result, rerender } = renderHook(() => useQuit());
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });

    it('calls system.quit() when invoked', () => {
        const quit = vi.fn();
        Object.defineProperty(globalThis, '__chimera', {
            configurable: true,
            value: { system: { quit } },
        });

        const { result } = renderHook(() => useQuit());
        result.current();
        expect(quit).toHaveBeenCalledOnce();
    });

    it('throws when the system bridge is not available', () => {
        const { result } = renderHook(() => useQuit());
        expect(() => result.current()).toThrow('Chimera system API not available');
    });
});
