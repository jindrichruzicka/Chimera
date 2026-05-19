/**
 * renderer/device/DeviceInfo.test.ts
 *
 * Type-level and runtime unit tests for the DeviceInfo interface and types.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #588 (F42 — Define DeviceInfo interface and types)
 *
 * Invariants upheld:
 *   #65 — DeviceInfo types are renderer-only; never imported by simulation/ or ai/.
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect } from 'vitest';
import type { DeviceInfo, DeviceFormFactor, InputModality, SizeClass } from './DeviceInfo.js';
import {
    SIZE_CLASS_COMPACT_MAX_EXCLUSIVE,
    SIZE_CLASS_REGULAR_MIN_INCLUSIVE,
    SIZE_CLASS_REGULAR_MAX_INCLUSIVE,
    SIZE_CLASS_LARGE_MIN_INCLUSIVE,
    SIZE_CLASS_LARGE_MAX_INCLUSIVE,
    SIZE_CLASS_ULTRAWIDE_MIN_EXCLUSIVE,
} from './DeviceInfo.js';

// ─── SizeClass breakpoint constants ──────────────────────────────────────────

describe('SizeClass breakpoint constants', () => {
    it('compact upper bound is 960', () => {
        expect(SIZE_CLASS_COMPACT_MAX_EXCLUSIVE).toBe(960);
    });

    it('regular lower bound matches compact upper bound', () => {
        expect(SIZE_CLASS_REGULAR_MIN_INCLUSIVE).toBe(960);
    });

    it('regular upper bound is 1440', () => {
        expect(SIZE_CLASS_REGULAR_MAX_INCLUSIVE).toBe(1440);
    });

    it('large lower bound is 1441', () => {
        expect(SIZE_CLASS_LARGE_MIN_INCLUSIVE).toBe(1441);
    });

    it('large upper bound is 2560', () => {
        expect(SIZE_CLASS_LARGE_MAX_INCLUSIVE).toBe(2560);
    });

    it('ultrawide lower bound matches large upper bound', () => {
        expect(SIZE_CLASS_ULTRAWIDE_MIN_EXCLUSIVE).toBe(2560);
    });

    it('breakpoints are internally consistent (no gap between regular and large)', () => {
        expect(SIZE_CLASS_LARGE_MIN_INCLUSIVE).toBe(SIZE_CLASS_REGULAR_MAX_INCLUSIVE + 1);
    });

    it('breakpoints are internally consistent (compact < regular boundary)', () => {
        expect(SIZE_CLASS_COMPACT_MAX_EXCLUSIVE).toBe(SIZE_CLASS_REGULAR_MIN_INCLUSIVE);
    });

    it('breakpoints are internally consistent (regular < ultrawide boundary)', () => {
        expect(SIZE_CLASS_LARGE_MAX_INCLUSIVE).toBe(SIZE_CLASS_ULTRAWIDE_MIN_EXCLUSIVE);
    });
});

// ─── DeviceFormFactor ─────────────────────────────────────────────────────────

describe('DeviceFormFactor', () => {
    it('accepts "desktop"', () => {
        const ff: DeviceFormFactor = 'desktop';
        expect(ff).toBe('desktop');
    });

    it('accepts "laptop"', () => {
        const ff: DeviceFormFactor = 'laptop';
        expect(ff).toBe('laptop');
    });

    it('accepts "tablet-convertible"', () => {
        const ff: DeviceFormFactor = 'tablet-convertible';
        expect(ff).toBe('tablet-convertible');
    });

    it('accepts "unknown"', () => {
        const ff: DeviceFormFactor = 'unknown';
        expect(ff).toBe('unknown');
    });

    it('rejects an out-of-spec string at compile time', () => {
        // @ts-expect-error: 'mobile' is not a DeviceFormFactor
        const _: DeviceFormFactor = 'mobile';
        expect(_).toBeDefined();
    });
});

// ─── InputModality ────────────────────────────────────────────────────────────

describe('InputModality', () => {
    it('accepts "mouse"', () => {
        const m: InputModality = 'mouse';
        expect(m).toBe('mouse');
    });

    it('accepts "keyboard"', () => {
        const m: InputModality = 'keyboard';
        expect(m).toBe('keyboard');
    });

    it('accepts "touch"', () => {
        const m: InputModality = 'touch';
        expect(m).toBe('touch');
    });

    it('accepts "pen"', () => {
        const m: InputModality = 'pen';
        expect(m).toBe('pen');
    });

    it('accepts "gamepad"', () => {
        const m: InputModality = 'gamepad';
        expect(m).toBe('gamepad');
    });

    it('rejects an out-of-spec string at compile time', () => {
        // @ts-expect-error: 'joystick' is not an InputModality
        const _: InputModality = 'joystick';
        expect(_).toBeDefined();
    });
});

// ─── SizeClass ────────────────────────────────────────────────────────────────

describe('SizeClass', () => {
    it('accepts "compact"', () => {
        const sc: SizeClass = 'compact';
        expect(sc).toBe('compact');
    });

    it('accepts "regular"', () => {
        const sc: SizeClass = 'regular';
        expect(sc).toBe('regular');
    });

    it('accepts "large"', () => {
        const sc: SizeClass = 'large';
        expect(sc).toBe('large');
    });

    it('accepts "ultrawide"', () => {
        const sc: SizeClass = 'ultrawide';
        expect(sc).toBe('ultrawide');
    });

    it('rejects an out-of-spec string at compile time', () => {
        // @ts-expect-error: 'small' is not a SizeClass
        const _: SizeClass = 'small';
        expect(_).toBeDefined();
    });
});

// ─── DeviceInfo interface ─────────────────────────────────────────────────────

describe('DeviceInfo', () => {
    it('conforming object satisfies the interface', () => {
        const info: DeviceInfo = {
            os: 'macos',
            osVersion: '14.5.0',
            arch: 'arm64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'laptop',
            screens: [
                {
                    id: 1,
                    width: 2560,
                    height: 1600,
                    pixelRatio: 2,
                    refreshHz: 60,
                    primary: true,
                },
            ],
            windowSizeClass: 'large',
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
            battery: { charging: false, level: 0.73 },
        };

        expect(info.os).toBe('macos');
        expect(info.arch).toBe('arm64');
        expect(info.formFactor).toBe('laptop');
        expect(info.screens).toHaveLength(1);
        expect(info.screens[0]?.primary).toBe(true);
        expect(info.windowSizeClass).toBe('large');
        expect(info.primaryInput).toBe('mouse');
        expect(info.battery).not.toBeNull();
        expect(info.battery?.level).toBe(0.73);
    });

    it('accepts null battery (desktop without battery)', () => {
        const info: DeviceInfo = {
            os: 'windows',
            osVersion: '10.0.22631',
            arch: 'x64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'de-DE',
            formFactor: 'desktop',
            screens: [
                {
                    id: 1,
                    width: 3840,
                    height: 2160,
                    pixelRatio: 1.5,
                    refreshHz: 144,
                    primary: true,
                },
            ],
            windowSizeClass: 'ultrawide',
            inputs: ['mouse', 'keyboard', 'gamepad'],
            primaryInput: 'gamepad',
            battery: null,
        };

        expect(info.os).toBe('windows');
        expect(info.battery).toBeNull();
        expect(info.inputs).toContain('gamepad');
    });

    it('rejects battery inner-field mutation at compile time', () => {
        const info: DeviceInfo = {
            os: 'macos',
            osVersion: '14.5.0',
            arch: 'arm64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'laptop',
            screens: [
                {
                    id: 1,
                    width: 2560,
                    height: 1600,
                    pixelRatio: 2,
                    refreshHz: 60,
                    primary: true,
                },
            ],
            windowSizeClass: 'large',
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
            battery: { charging: false, level: 0.73 },
        };

        type Battery = NonNullable<DeviceInfo['battery']>;
        const attemptMutation = (battery: Battery): void => {
            // @ts-expect-error: battery inner fields are readonly
            battery.charging = true;
            // @ts-expect-error: battery inner fields are readonly
            battery.level = 0.5;
        };

        expect(typeof attemptMutation).toBe('function');
        expect(info.battery).not.toBeNull();
    });

    it('accepts multiple screens', () => {
        const info: DeviceInfo = {
            os: 'linux',
            osVersion: '6.8.0',
            arch: 'x64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-GB',
            formFactor: 'desktop',
            screens: [
                { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
                { id: 2, width: 2560, height: 1440, pixelRatio: 1, refreshHz: 144, primary: false },
            ],
            windowSizeClass: 'large',
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'keyboard',
            battery: null,
        };

        expect(info.screens).toHaveLength(2);
        expect(info.screens[1]?.primary).toBe(false);
    });

    it('accepts all valid os values', () => {
        const oses: DeviceInfo['os'][] = ['macos', 'windows', 'linux'];
        expect(oses).toHaveLength(3);
    });

    it('accepts all valid arch values', () => {
        const arches: DeviceInfo['arch'][] = ['x64', 'arm64'];
        expect(arches).toHaveLength(2);
    });

    it('rejects an invalid os value at compile time', () => {
        // @ts-expect-error: 'android' is not a valid os value
        const _: DeviceInfo['os'] = 'android';
        expect(_).toBeDefined();
    });

    it('rejects a missing required field at compile time', () => {
        // @ts-expect-error: DeviceInfo requires all fields including 'battery'
        const _: DeviceInfo = {
            os: 'macos',
            osVersion: '14.5.0',
            arch: 'arm64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'laptop',
            screens: [],
            windowSizeClass: 'compact',
            inputs: [],
            primaryInput: 'mouse',
            // battery intentionally omitted
        };
        expect(_).toBeDefined();
    });
});
