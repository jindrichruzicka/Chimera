'use client';

/**
 * renderer/device/useDeviceInfo.ts
 *
 * Consumer hooks for the DeviceInfo context tree (§4.17).
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #591 (F42 — Implement DeviceInfo hooks)
 *
 * Invariants upheld:
 *   #83 — Each hook throws a descriptive error when context is null.
 *   #65 — Renderer-only. Must NOT import from electron/main,
 *          simulation/, or ai/.
 */

import { useContext } from 'react';
import type { DeviceInfo, InputModality, SizeClass } from './DeviceInfo.js';
import { DeviceInfoContext } from './DeviceInfoProvider.js';

// ─── Base hook ────────────────────────────────────────────────────────────────

/**
 * Returns the current `DeviceInfo` snapshot.
 *
 * @throws {Error} When used outside `<DeviceInfoProvider>`.
 */
function useDeviceInfoContext(hookName: string): DeviceInfo {
    const info = useContext(DeviceInfoContext);
    if (info === null) {
        throw new Error(`${hookName}() must be used within DeviceInfoProvider`);
    }
    return info;
}

export function useDeviceInfo(): DeviceInfo {
    return useDeviceInfoContext('useDeviceInfo');
}

// ─── Derived hooks ────────────────────────────────────────────────────────────

/**
 * Returns the most recently used `InputModality`.
 *
 * @throws {Error} When used outside `<DeviceInfoProvider>`.
 */
export function usePrimaryInput(): InputModality {
    return useDeviceInfoContext('usePrimaryInput').primaryInput;
}

/**
 * Returns the current window `SizeClass`.
 *
 * @throws {Error} When used outside `<DeviceInfoProvider>`.
 */
export function useWindowSizeClass(): SizeClass {
    return useDeviceInfoContext('useWindowSizeClass').windowSizeClass;
}
