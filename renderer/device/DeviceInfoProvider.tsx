'use client';

/**
 * renderer/device/DeviceInfoProvider.tsx
 *
 * Merges main-process device facts (via SystemAPI) with renderer-detected DOM
 * signals (via inputTracker) into a React context that the rest of the app
 * consumes via useDeviceInfo() (§4.17).
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #590 (F42 — Implement DeviceInfoProvider and inputTracker)
 *
 * Invariants upheld:
 *   #83 — createContext<DeviceInfo | null>(null); consumer hook throws
 *          descriptive error when null.
 *   #65 — Renderer-only. Must NOT import from electron/main,
 *          simulation/, or ai/.
 *
 * Design notes:
 *  - `systemApi` is injected as a prop so tests can supply a plain stub
 *    without touching window.__chimera or global state.
 *  - The provider calls getDeviceInfo() once on mount and subscribes to
 *    onDeviceInfoChange() for subsequent pushes from the main process.
 *  - inputTracker is started on mount and stopped on unmount; its
 *    updates are merged into the context value.
 *  - No state update is applied after unmount (stale-closure guard via
 *    `mounted` flag).
 */

import React, { createContext, useEffect, useRef, useState } from 'react';
import type { DeviceFormFactor, DeviceInfo, InputModality } from './DeviceInfo.js';
import { createInputTracker } from './inputTracker.js';

type BatteryInfo = NonNullable<DeviceInfo['battery']>;

interface BatteryManagerLike {
    readonly charging: boolean;
    readonly level: number;
    addEventListener?(type: 'chargingchange' | 'levelchange', listener: EventListener): void;
    removeEventListener?(type: 'chargingchange' | 'levelchange', listener: EventListener): void;
}

interface NavigatorWithBattery extends Navigator {
    getBattery?: () => Promise<BatteryManagerLike>;
}

// ─── Narrow SystemAPI slice ───────────────────────────────────────────────────

/**
 * Minimal slice of `window.__chimera.system` consumed by `DeviceInfoProvider`.
 * Expressed as a separate interface so tests can inject a stub without
 * importing the full preload `SystemAPI` type.
 */
export interface DeviceInfoSystemApi {
    getDeviceInfo(): Promise<DeviceInfo>;
    onDeviceInfoChange(cb: (info: DeviceInfo) => void): () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Context value is `DeviceInfo | null`.
 * Consumers must call `useDeviceInfo()` which throws a descriptive error
 * when the context is `null` (invariant #83).
 */
export const DeviceInfoContext = createContext<DeviceInfo | null>(null);

const FALLBACK_DEVICE_INFO: DeviceInfo = {
    os: 'linux',
    osVersion: 'unknown',
    arch: 'x64',
    electronVer: 'unknown',
    chromiumVer: 'unknown',
    locale: 'en-US',
    formFactor: 'unknown',
    screens: [
        {
            id: 0,
            width: 0,
            height: 0,
            pixelRatio: 1,
            refreshHz: 60,
            primary: true,
        },
    ],
    windowSizeClass: 'regular',
    inputs: ['mouse', 'keyboard'],
    primaryInput: 'mouse',
    battery: null,
};

function mergeSystemDeviceInfo(previous: DeviceInfo, systemInfo: DeviceInfo): DeviceInfo {
    const isFallback = previous === FALLBACK_DEVICE_INFO;
    const inputs = new Set<InputModality>(systemInfo.inputs);
    const previousInputs = isFallback ? [] : previous.inputs;
    for (const input of previousInputs) {
        inputs.add(input);
    }

    return withDerivedFormFactor({
        ...systemInfo,
        inputs: Array.from(inputs),
        primaryInput: isFallback ? systemInfo.primaryInput : previous.primaryInput,
    });
}

function deriveFormFactor(info: DeviceInfo): DeviceFormFactor {
    if (info.battery !== null) return 'laptop';

    const inputs = new Set<InputModality>(info.inputs);
    if (inputs.size === 1 && inputs.has('touch') && info.windowSizeClass === 'compact') {
        return 'tablet-convertible';
    }

    if (!inputs.has('touch')) return 'desktop';

    return info.formFactor;
}

function withDerivedFormFactor(info: DeviceInfo): DeviceInfo {
    return { ...info, formFactor: deriveFormFactor(info) };
}

function getNavigatorBattery(
    navigatorObject: Navigator,
): (() => Promise<BatteryManagerLike>) | null {
    const withBattery = navigatorObject as NavigatorWithBattery;
    if (typeof withBattery.getBattery !== 'function') return null;
    return withBattery.getBattery.bind(navigatorObject);
}

function readBatteryInfo(battery: BatteryManagerLike): BatteryInfo {
    return { charging: battery.charging, level: battery.level };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DeviceInfoProviderProps {
    /** The SystemAPI bridge. Production code passes `window.__chimera.system`. */
    readonly systemApi: DeviceInfoSystemApi | null;
    readonly children: React.ReactNode;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * `DeviceInfoProvider` — app-lifetime singleton that lives at the top of the
 * provider tree (mounted inside `<Providers>`).
 *
 * On mount:
 *  1. Calls `systemApi.getDeviceInfo()` to fetch the initial snapshot.
 *  2. Subscribes to `systemApi.onDeviceInfoChange()` for resize and hardware
 *     change updates pushed from the main process.
 *  3. Starts an `inputTracker` on `window` to detect pointer/keyboard/gamepad
 *     modality and merge live signals into the context value.
 *
 * On unmount all subscriptions are cleaned up. No state is updated after
 * unmount.
 */
export function DeviceInfoProvider({
    systemApi,
    children,
}: DeviceInfoProviderProps): React.ReactElement {
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(FALLBACK_DEVICE_INFO);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        const cleanupCallbacks: (() => void)[] = [];

        // ── 1. Fetch initial snapshot ──────────────────────────────────────
        if (systemApi !== null) {
            void systemApi.getDeviceInfo().then((info) => {
                if (!mountedRef.current) return;
                setDeviceInfo((prev) => mergeSystemDeviceInfo(prev, info));
            });

            // ── 2. Subscribe to main-process change pushes ─────────────────
            const unsubscribeChange = systemApi.onDeviceInfoChange((info) => {
                if (!mountedRef.current) return;
                setDeviceInfo((prev) => mergeSystemDeviceInfo(prev, info));
            });
            cleanupCallbacks.push(unsubscribeChange);
        }

        // ── 3. inputTracker — renderer DOM signals ─────────────────────────
        if (typeof window !== 'undefined') {
            const tracker = createInputTracker(window);
            tracker.start();

            const unsubscribeTracker = tracker.onChange(
                (inputs: readonly InputModality[], primary: InputModality) => {
                    if (!mountedRef.current) return;
                    setDeviceInfo((prev) => {
                        return withDerivedFormFactor({ ...prev, inputs, primaryInput: primary });
                    });
                },
            );
            cleanupCallbacks.push(() => {
                unsubscribeTracker();
                tracker.stop();
            });

            const getBattery = getNavigatorBattery(window.navigator);
            if (getBattery !== null) {
                void getBattery()
                    .then((battery) => {
                        if (!mountedRef.current) return;

                        const applyBattery = (): void => {
                            if (!mountedRef.current) return;
                            setDeviceInfo((prev) =>
                                withDerivedFormFactor({
                                    ...prev,
                                    battery: readBatteryInfo(battery),
                                }),
                            );
                        };

                        applyBattery();
                        battery.addEventListener?.('chargingchange', applyBattery);
                        battery.addEventListener?.('levelchange', applyBattery);
                        cleanupCallbacks.push(() => {
                            battery.removeEventListener?.('chargingchange', applyBattery);
                            battery.removeEventListener?.('levelchange', applyBattery);
                        });
                    })
                    .catch(() => undefined);
            }
        }

        return () => {
            mountedRef.current = false;
            for (const cleanupCallback of cleanupCallbacks) {
                cleanupCallback();
            }
        };
        // systemApi is stable; explicitly included to satisfy exhaustive-deps.
    }, [systemApi]);

    return <DeviceInfoContext.Provider value={deviceInfo}>{children}</DeviceInfoContext.Provider>;
}
