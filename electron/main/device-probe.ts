// electron/main/device-probe.ts
//
// Reads OS/screen facts from the host environment and produces a `DeviceInfo`
// snapshot for the `chimera:system:device-info` IPC channel (§4.17).
//
// Design notes:
//  - No direct `import from 'electron'` — all Electron screen access is
//    injected via the narrow `ScreenPort` interface so the module is trivially
//    unit-testable without Electron.
//  - Fields that can only be detected in the renderer (`battery`, `inputs`,
//    `primaryInput`) carry conservative defaults; `DeviceInfoProvider` merges
//    live DOM signals into the snapshot on the renderer side.
//  - `formFactor` is `'unknown'` by default. A future heuristic can refine it
//    without breaking the contract.
//  - SizeClass breakpoint constants are duplicated here intentionally; they
//    must not be imported from `renderer/` (module boundary). Any change must
//    be mirrored in `renderer/device/DeviceInfo.ts`.

import type { DeviceInfo, SizeClass } from '../preload/api-types.js';

// ─── SizeClass breakpoints ────────────────────────────────────────────────────
// KEEP IN SYNC with renderer/device/DeviceInfo.ts
const SIZE_CLASS_COMPACT_MAX_EXCLUSIVE = 960;
const SIZE_CLASS_REGULAR_MAX_INCLUSIVE = 1440;
const SIZE_CLASS_LARGE_MAX_INCLUSIVE = 2560;

/**
 * Derives the content-width {@link SizeClass} bucket.
 * Exported so tests can drive the breakpoint logic in isolation.
 */
export function deriveWindowSizeClass(contentWidth: number): SizeClass {
    if (contentWidth < SIZE_CLASS_COMPACT_MAX_EXCLUSIVE) return 'compact';
    if (contentWidth <= SIZE_CLASS_REGULAR_MAX_INCLUSIVE) return 'regular';
    if (contentWidth <= SIZE_CLASS_LARGE_MAX_INCLUSIVE) return 'large';
    return 'ultrawide';
}

// ─── Narrow port types ────────────────────────────────────────────────────────

/**
 * Minimal display entry. Mirrors the fields of `Electron.Display` that the
 * probe actually uses, so that tests can inject a plain object stub without
 * importing Electron types.
 */
export interface ElectronDisplay {
    readonly id: number;
    readonly bounds: { readonly width: number; readonly height: number };
    readonly scaleFactor: number;
    readonly displayFrequency: number;
}

/**
 * Narrow port over `Electron.Screen`. Only the methods the probe needs are
 * declared, keeping the interface auditable and injection-friendly.
 */
export interface ScreenPort {
    getAllDisplays(): readonly ElectronDisplay[];
    /** Returns the numeric id of the primary display. */
    getPrimaryDisplayId(): number;
    on(event: 'display-metrics-changed', listener: () => void): void;
    off(event: 'display-metrics-changed', listener: () => void): void;
}

// ─── Options ─────────────────────────────────────────────────────────────────

/** Injected facts needed to build a `DeviceInfo` snapshot. */
export interface DeviceProbeOptions {
    /** `process.platform` */
    readonly platform: NodeJS.Platform;
    /** `process.arch` */
    readonly arch: string;
    /** `os.release()` */
    readonly osRelease: string;
    /** `process.versions.electron ?? ''` */
    readonly electronVer: string;
    /** `process.versions.chrome ?? ''` */
    readonly chromiumVer: string;
    /** System locale, e.g. from `app.getLocale()` */
    readonly locale: string;
    /** Narrow port over Electron `screen`. */
    readonly screen: ScreenPort;
    /** Returns `[width, height]` of the BrowserWindow content area. */
    readonly getWindowContentSize: () => [number, number];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapOs(platform: NodeJS.Platform): DeviceInfo['os'] {
    switch (platform) {
        case 'darwin':
            return 'macos';
        case 'win32':
            return 'windows';
        default:
            return 'linux';
    }
}

function mapArch(arch: string): DeviceInfo['arch'] {
    if (arch === 'arm64') return 'arm64';
    return 'x64';
}

// ─── buildDeviceInfo ──────────────────────────────────────────────────────────

/**
 * Pure builder — reads the injected options and returns a `DeviceInfo` snapshot.
 * No side effects; safe to call from any context.
 */
export function buildDeviceInfo(options: DeviceProbeOptions): DeviceInfo {
    const {
        platform,
        arch,
        osRelease,
        electronVer,
        chromiumVer,
        locale,
        screen,
        getWindowContentSize,
    } = options;

    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplayId();
    const [windowWidth] = getWindowContentSize();

    return {
        os: mapOs(platform),
        osVersion: osRelease,
        arch: mapArch(arch),
        electronVer,
        chromiumVer,
        locale,
        formFactor: 'unknown',
        screens: displays.map((d) => ({
            id: d.id,
            width: d.bounds.width,
            height: d.bounds.height,
            pixelRatio: d.scaleFactor,
            refreshHz: d.displayFrequency,
            primary: d.id === primaryId,
        })),
        windowSizeClass: deriveWindowSizeClass(windowWidth),
        // Conservative defaults for renderer-only fields.
        inputs: ['mouse', 'keyboard'],
        primaryInput: 'mouse',
        battery: null,
    };
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

/** Function returned by {@link DeviceProbeWatcher.onChange}. */
export type Unsubscribe = () => void;

/** Watcher returned by {@link createDeviceProbeWatcher}. */
export interface DeviceProbeWatcher {
    /** Returns the most recently computed `DeviceInfo`. */
    getCurrentInfo(): DeviceInfo;
    /** Registers a callback invoked whenever the device info changes. */
    onChange(cb: (info: DeviceInfo) => void): Unsubscribe;
    /** Triggers an immediate recompute and notifies all onChange listeners. */
    recompute(): void;
    /** Removes all listeners and screen subscriptions. */
    dispose(): void;
}

/**
 * Creates a watcher that listens for `display-metrics-changed` events and
 * calls registered callbacks whenever the computed `DeviceInfo` changes.
 *
 * The returned watcher must be `dispose()`d when the window closes.
 */
export function createDeviceProbeWatcher(options: DeviceProbeOptions): DeviceProbeWatcher {
    let current = buildDeviceInfo(options);
    const callbacks = new Set<(info: DeviceInfo) => void>();
    let disposed = false;

    function recompute(): void {
        if (disposed) return;
        current = buildDeviceInfo(options);
        for (const cb of callbacks) {
            cb(current);
        }
    }

    options.screen.on('display-metrics-changed', recompute);

    return {
        getCurrentInfo(): DeviceInfo {
            return current;
        },
        onChange(cb: (info: DeviceInfo) => void): Unsubscribe {
            callbacks.add(cb);
            return () => {
                callbacks.delete(cb);
            };
        },
        recompute,
        dispose(): void {
            disposed = true;
            options.screen.off('display-metrics-changed', recompute);
            callbacks.clear();
        },
    };
}
