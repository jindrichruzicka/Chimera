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
