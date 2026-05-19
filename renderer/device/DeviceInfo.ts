/**
 * renderer/device/DeviceInfo.ts
 *
 * DeviceInfo interface and related types for the Device Info system (§4.17).
 * Also exports the SizeClass breakpoint constants used to derive
 * `windowSizeClass` from a BrowserWindow content width.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #588 (F42 — Define DeviceInfo interface and types)
 *
 * Invariant #65: These types are renderer-only. This module must never be
 * imported by simulation/ or ai/.
 * Must NOT import from: electron/main/, simulation/, ai/
 */

// ─── Form factor ──────────────────────────────────────────────────────────────

/**
 * Conservative form-factor heuristic for Electron desktop targets.
 *
 * Detection notes (§4.17):
 *  - `'tablet-convertible'` — touch-only + small screen heuristic
 *  - `'laptop'`             — battery present heuristic
 *  - `'desktop'`            — no battery, no touch
 *  - `'unknown'`            — heuristic inconclusive
 */
export type DeviceFormFactor = 'desktop' | 'laptop' | 'tablet-convertible' | 'unknown';

// ─── Input modality ───────────────────────────────────────────────────────────

/**
 * An input device class that the application has detected as active.
 *
 * `inputs` on `DeviceInfo` is a set of all modalities currently available.
 * `primaryInput` is the most-recently-used one (last `pointerdown`, `keydown`,
 * or `gamepadconnected` event).
 */
export type InputModality = 'mouse' | 'keyboard' | 'touch' | 'pen' | 'gamepad';

// ─── Window size class ────────────────────────────────────────────────────────

/**
 * Window content-width bucket used for layout decisions.
 *
 * Derived from `BrowserWindow` content size; re-derived on every resize.
 * See `SIZE_CLASS_*` constants below for the exact pixel boundaries.
 */
export type SizeClass = 'compact' | 'regular' | 'large' | 'ultrawide';

// ─── SizeClass breakpoint constants ──────────────────────────────────────────
//
// Breakpoint table (§4.17):
//
//  compact   — width < 960              (< SIZE_CLASS_COMPACT_MAX_EXCLUSIVE)
//  regular   — 960 ≤ width ≤ 1440      (SIZE_CLASS_REGULAR_MIN_INCLUSIVE … MAX_INCLUSIVE)
//  large     — 1441 ≤ width ≤ 2560     (SIZE_CLASS_LARGE_MIN_INCLUSIVE … MAX_INCLUSIVE)
//  ultrawide — width > 2560             (> SIZE_CLASS_ULTRAWIDE_MIN_EXCLUSIVE)

/** Upper bound (exclusive) of the `compact` size class. Width < 960 → compact. */
export const SIZE_CLASS_COMPACT_MAX_EXCLUSIVE = 960 as const;

/** Lower bound (inclusive) of the `regular` size class. Equals `SIZE_CLASS_COMPACT_MAX_EXCLUSIVE`. */
export const SIZE_CLASS_REGULAR_MIN_INCLUSIVE = 960 as const;

/** Upper bound (inclusive) of the `regular` size class. */
export const SIZE_CLASS_REGULAR_MAX_INCLUSIVE = 1440 as const;

/** Lower bound (inclusive) of the `large` size class. */
export const SIZE_CLASS_LARGE_MIN_INCLUSIVE = 1441 as const;

/** Upper bound (inclusive) of the `large` size class. */
export const SIZE_CLASS_LARGE_MAX_INCLUSIVE = 2560 as const;

/** Lower bound (exclusive) of the `ultrawide` size class. Width > 2560 → ultrawide. */
export const SIZE_CLASS_ULTRAWIDE_MIN_EXCLUSIVE = 2560 as const;

// ─── DeviceInfo interface ─────────────────────────────────────────────────────

/**
 * Snapshot of device facts available to game screens and `GameShell` for
 * layout and affordance decisions (§4.17).
 *
 * All fields are `readonly`. The object is produced by `DeviceInfoProvider`
 * (which merges main-process facts from `device-probe.ts` with live DOM
 * signals) and consumed via `useDeviceInfo()`.
 *
 * This interface must not cross the IPC boundary directly — the renderer
 * receives it via `SystemAPI.getDeviceInfo()` and `SystemAPI.onDeviceInfoChange()`.
 */
export interface DeviceInfo {
    // ── Platform (from Electron main process via device-probe.ts) ────────────

    /** Operating system identifier. */
    readonly os: 'macos' | 'windows' | 'linux';
    /** OS version string, e.g. `'14.5.0'` (macOS) or `'10.0.22631'` (Windows). */
    readonly osVersion: string;
    /** CPU architecture. */
    readonly arch: 'x64' | 'arm64';
    /** Electron version string, e.g. `'33.2.0'`. */
    readonly electronVer: string;
    /** Chromium version string embedded in Electron, e.g. `'130.0.0.0'`. */
    readonly chromiumVer: string;
    /** BCP 47 locale tag, e.g. `'en-US'` or `'de-DE'`. */
    readonly locale: string;

    // ── Form factor ───────────────────────────────────────────────────────────

    /** Conservative form-factor heuristic — see `DeviceFormFactor`. */
    readonly formFactor: DeviceFormFactor;

    // ── Display (from Electron main process via screen.getAllDisplays()) ──────

    /** All connected screens. At least one entry is always present. */
    readonly screens: readonly {
        /** Electron display id. */
        readonly id: number;
        /** Logical width in CSS pixels. */
        readonly width: number;
        /** Logical height in CSS pixels. */
        readonly height: number;
        /** Device pixel ratio (e.g. 2 for Retina). */
        readonly pixelRatio: number;
        /** Refresh rate in Hz. */
        readonly refreshHz: number;
        /** True for the primary display. */
        readonly primary: boolean;
    }[];

    /**
     * Size class of the current `BrowserWindow` content area.
     * Re-derived on every resize event. See `SizeClass` and `SIZE_CLASS_*` constants.
     */
    readonly windowSizeClass: SizeClass;

    // ── Input (detected in renderer) ──────────────────────────────────────────

    /** All input modalities currently detected as available. */
    readonly inputs: readonly InputModality[];

    /**
     * Most recently active input modality.
     * Updated on `pointerdown`, `keydown`, and `gamepadconnected` events.
     */
    readonly primaryInput: InputModality;

    // ── Battery ───────────────────────────────────────────────────────────────

    /**
     * Battery state from `navigator.getBattery()` where supported.
     * `null` on desktop systems without a battery sensor.
     */
    readonly battery: { readonly charging: boolean; readonly level: number } | null;
}
