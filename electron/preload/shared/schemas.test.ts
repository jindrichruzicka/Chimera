// electron/preload/schemas.test.ts
//
// Unit tests for the preload invoke-response validator and its schemas.
// Covers both the helper's contract (throws PreloadIpcValidationError with
// the offending channel name on malformed input, passes conforming values
// through untouched) and a representative malformed payload per schema so
// drift between main and the preload contract is caught immediately at the
// boundary.

import { describe, expect, it } from 'vitest';
import {
    ActionRejectionSchema,
    DeviceInfoSchema,
    LobbyInfoSchema,
    PlatformInfoSchema,
    PreloadIpcValidationError,
    ResolvedSettingsSchema,
    SaveSlotListSchema,
    SaveSlotMetaSchema,
    parseInvokeResponse,
} from './schemas.js';

describe('parseInvokeResponse', () => {
    it('returns the parsed value when the payload conforms', () => {
        const value = { os: 'macos', version: '14.0' };
        const result = parseInvokeResponse(PlatformInfoSchema, 'chimera:system:platform', value);
        expect(result).toEqual(value);
    });

    it('throws PreloadIpcValidationError naming the channel on malformed payload', () => {
        expect.assertions(3);
        try {
            parseInvokeResponse(PlatformInfoSchema, 'chimera:system:platform', {
                os: 'plan9',
                version: '1.0',
            });
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
            const validationError = error as PreloadIpcValidationError;
            expect(validationError.channel).toBe('chimera:system:platform');
            expect(validationError.message).toContain('chimera:system:platform');
        }
    });

    it('exposes structured issues on the thrown error', () => {
        try {
            parseInvokeResponse(LobbyInfoSchema, 'chimera:lobby:host', { sessionId: 42 });
            throw new Error('Expected PreloadIpcValidationError to be thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
            const validationError = error as PreloadIpcValidationError;
            expect(validationError.issues.length).toBeGreaterThan(0);
            // At least one issue must name a known field path so callers can
            // include it in error reports without guessing where to dig.
            const paths = validationError.issues.flatMap((issue) => issue.path);
            expect(paths).toContain('sessionId');
        }
    });
});

describe('PlatformInfoSchema', () => {
    it('accepts the three supported OS values', () => {
        for (const os of ['macos', 'windows', 'linux'] as const) {
            expect(PlatformInfoSchema.parse({ os, version: '1.0' })).toEqual({
                os,
                version: '1.0',
            });
        }
    });

    it('rejects unknown OS values', () => {
        expect(() => PlatformInfoSchema.parse({ os: 'freebsd', version: '1.0' })).toThrow();
    });

    it('rejects missing version', () => {
        expect(() => PlatformInfoSchema.parse({ os: 'macos' })).toThrow();
    });
});

describe('LobbyInfoSchema', () => {
    it('accepts a well-formed lobby info', () => {
        const info = { sessionId: 'S1', hostId: 'P1', gameId: 'tactics' };
        expect(LobbyInfoSchema.parse(info)).toEqual(info);
    });

    it('rejects a non-string sessionId', () => {
        expect(() =>
            LobbyInfoSchema.parse({ sessionId: 1, hostId: 'P1', gameId: 'tactics' }),
        ).toThrow();
    });
});

describe('SaveSlotMetaSchema', () => {
    it('accepts a meta without an optional label', () => {
        const meta = { slotId: 'slot-1', gameId: 'tactics', tick: 0, savedAt: 0 };
        expect(SaveSlotMetaSchema.parse(meta)).toEqual(meta);
    });

    it('accepts a meta with an optional label', () => {
        const meta = {
            slotId: 'slot-1',
            gameId: 'tactics',
            tick: 10,
            savedAt: 1_700_000_000,
            label: 'mid-battle',
        };
        expect(SaveSlotMetaSchema.parse(meta)).toEqual(meta);
    });

    it('rejects a meta missing a required field', () => {
        expect(() =>
            SaveSlotMetaSchema.parse({ slotId: 'slot-1', gameId: 'tactics', tick: 0 }),
        ).toThrow();
    });
});

describe('SaveSlotListSchema', () => {
    it('accepts an empty array', () => {
        expect(SaveSlotListSchema.parse([])).toEqual([]);
    });

    it('rejects a non-array value', () => {
        expect(() => SaveSlotListSchema.parse({})).toThrow();
    });

    it('rejects an array containing a malformed meta', () => {
        expect(() =>
            SaveSlotListSchema.parse([
                { slotId: 'slot-1', gameId: 'tactics', tick: 0, savedAt: 0 },
                { slotId: 'slot-2' },
            ]),
        ).toThrow();
    });
});

describe('ResolvedSettingsSchema', () => {
    it('accepts an empty record', () => {
        expect(ResolvedSettingsSchema.parse({})).toEqual({});
    });

    it('accepts a record with arbitrary unknown values', () => {
        const settings = { audio: { master: 0.8 }, controls: { invertY: true } };
        expect(ResolvedSettingsSchema.parse(settings)).toEqual(settings);
    });

    it('rejects a null value', () => {
        expect(() => ResolvedSettingsSchema.parse(null)).toThrow();
    });

    it('rejects an array', () => {
        expect(() => ResolvedSettingsSchema.parse([])).toThrow();
    });

    it('rejects a primitive', () => {
        expect(() => ResolvedSettingsSchema.parse('settings')).toThrow();
    });
});

describe('ActionRejectionSchema', () => {
    it('accepts a well-formed rejection with actionType', () => {
        const rejection = {
            reason: 'ipc-validation:chimera:game:send-action',
            tick: 7,
            actionType: 'noop',
        };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('accepts a rejection without the optional actionType', () => {
        const rejection = { reason: 'pipeline:rejected', tick: 0 };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('accepts tick: -1 (unknown-tick sentinel, §4.3 REJECT parity)', () => {
        const rejection = { reason: 'ipc-validation:x', tick: -1 };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('rejects an empty reason', () => {
        expect(() => ActionRejectionSchema.parse({ reason: '', tick: 0 })).toThrow();
    });

    it('rejects a non-integer tick', () => {
        expect(() => ActionRejectionSchema.parse({ reason: 'x', tick: 1.5 })).toThrow();
    });

    it('rejects a non-string actionType', () => {
        expect(() =>
            ActionRejectionSchema.parse({ reason: 'x', tick: 0, actionType: 42 }),
        ).toThrow();
    });

    it('rejects a null payload', () => {
        expect(() => ActionRejectionSchema.parse(null)).toThrow();
    });
});

describe('DeviceInfoSchema', () => {
    const validInfo = {
        os: 'macos' as const,
        osVersion: '14.5.0',
        arch: 'arm64' as const,
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        formFactor: 'unknown' as const,
        screens: [
            { id: 1, width: 1920, height: 1080, pixelRatio: 2, refreshHz: 60, primary: true },
        ],
        windowSizeClass: 'large' as const,
        inputs: ['mouse', 'keyboard'] as const,
        primaryInput: 'mouse' as const,
        battery: null,
    };

    it('accepts a fully conforming DeviceInfo', () => {
        expect(DeviceInfoSchema.parse(validInfo)).toMatchObject({
            os: 'macos',
            arch: 'arm64',
            windowSizeClass: 'large',
        });
    });

    it('accepts all valid os values', () => {
        for (const os of ['macos', 'windows', 'linux'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, os })).not.toThrow();
        }
    });

    it('rejects unknown os value', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, os: 'plan9' })).toThrow();
    });

    it('accepts all valid arch values', () => {
        for (const arch of ['x64', 'arm64'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, arch })).not.toThrow();
        }
    });

    it('rejects unknown arch value', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, arch: 'ia32' })).toThrow();
    });

    it('accepts all valid windowSizeClass values', () => {
        for (const windowSizeClass of ['compact', 'regular', 'large', 'ultrawide'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, windowSizeClass })).not.toThrow();
        }
    });

    it('accepts battery: null', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, battery: null })).not.toThrow();
    });

    it('accepts a battery object', () => {
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: 0.75 } }),
        ).not.toThrow();
    });

    it('rejects battery levels outside the Battery API range', () => {
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: -0.01 } }),
        ).toThrow();
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: 1.01 } }),
        ).toThrow();
    });

    it('accepts multiple screens', () => {
        const twoScreens = [
            { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
            { id: 2, width: 2560, height: 1440, pixelRatio: 2, refreshHz: 144, primary: false },
        ];
        expect(() => DeviceInfoSchema.parse({ ...validInfo, screens: twoScreens })).not.toThrow();
    });

    it('rejects when a required field is missing', () => {
        const { os: _os, ...withoutOs } = validInfo;
        expect(() => DeviceInfoSchema.parse(withoutOs)).toThrow();
    });

    it('rejects when screens is empty array', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, screens: [] })).toThrow();
    });

    it('rejects a non-object payload', () => {
        expect(() => DeviceInfoSchema.parse(null)).toThrow();
        expect(() => DeviceInfoSchema.parse('device')).toThrow();
    });
});
