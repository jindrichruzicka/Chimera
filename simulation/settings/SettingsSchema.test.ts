/**
 * simulation/settings/SettingsSchema.test.ts
 *
 * Tests for the exported Zod shape (engineSettingsZodShape) from SettingsSchema,
 * DeepPartial<EngineSettings>, and SettingsNamespaceCollisionError.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type {
    DeepPartial,
    EngineSettings,
    GameSettingsSchema,
    UserSettings,
} from './SettingsSchema.js';
import { SettingsMerger } from './SettingsMerger.js';
import {
    ENGINE_DEFAULTS,
    SettingsNamespaceCollisionError,
    engineSettingsZodShape,
} from './SettingsSchema.js';

describe('engineSettingsZodShape (WARN-1)', () => {
    it('is exported from the module', () => {
        expect(engineSettingsZodShape).toBeDefined();
        expect(typeof engineSettingsZodShape).toBe('object');
    });

    it('contains the four top-level engine namespace keys', () => {
        expect(engineSettingsZodShape).toHaveProperty('audio');
        expect(engineSettingsZodShape).toHaveProperty('display');
        expect(engineSettingsZodShape).toHaveProperty('gameplay');
        expect(engineSettingsZodShape).toHaveProperty('controls');
    });

    it('can be spread into a game-specific ZodObject to extend engine fields', () => {
        const gameSchema = z.object({
            ...engineSettingsZodShape,
            showGrid: z.boolean(),
        });
        // Valid full settings should parse
        const result = gameSchema.safeParse({
            audio: {
                masterVolume: 0.8,
                sfxVolume: 0.5,
                musicVolume: 0.6,
                muted: false,
            },
            display: {
                targetFps: 60,
                shadowQuality: 'off',
                renderScale: 1,
            },
            gameplay: {
                language: 'en-US',
                autoSave: true,
                autoSaveIntervalTurns: 5,
                showHints: true,
                showPerfHud: false,
            },
            controls: {
                bindings: { 'engine:toggle-menu': { primary: 'Escape' } },
            },
            showGrid: true,
        });
        expect(result.success).toBe(true);
    });

    it('rejects values that violate engine field types', () => {
        const gameSchema = z.object({
            ...engineSettingsZodShape,
            showGrid: z.boolean(),
        });
        const result = gameSchema.safeParse({
            audio: { masterVolume: 'loud', sfxVolume: 0.5, musicVolume: 0.6, muted: false },
            display: { targetFps: 60 },
            gameplay: {
                language: 'en-US',
                autoSave: true,
                autoSaveIntervalTurns: 5,
                showHints: true,
                showPerfHud: false,
            },
            controls: { bindings: {} },
            showGrid: true,
        });
        expect(result.success).toBe(false);
    });
});

describe('DeepPartial<EngineSettings>', () => {
    it('accepts an empty object as a valid DeepPartial', () => {
        const empty: DeepPartial<EngineSettings> = {};
        expect(empty).toEqual({});
    });

    it('accepts partial audio overrides', () => {
        const partial: DeepPartial<EngineSettings> = { audio: { muted: true } };
        expect(partial.audio?.muted).toBe(true);
    });

    it('accepts deeply nested partial overrides without requiring sibling keys', () => {
        const partial: DeepPartial<EngineSettings> = {
            display: { targetFps: 30 },
            gameplay: { language: 'fr-FR' },
        };
        expect(partial.display?.targetFps).toBe(30);
        expect(partial.gameplay?.language).toBe('fr-FR');
        // Sibling gameplay keys stay optional in a DeepPartial.
        expect(partial.gameplay?.autoSave).toBeUndefined();
    });
});

describe('GameSettingsSchema<T>.schema field', () => {
    it('accepts an object with a schema property (not zodSchema)', () => {
        const mockSchema = z.object({ ...engineSettingsZodShape });
        type MockSettings = EngineSettings;
        const gameSettingsSchema: GameSettingsSchema<MockSettings> = {
            gameId: 'test-game',
            defaults: {
                audio: { masterVolume: 1, sfxVolume: 1, musicVolume: 0.8, muted: false },
                display: { targetFps: 60, shadowQuality: 'off', renderScale: 1 },
                gameplay: {
                    language: 'en-US',
                    autoSave: true,
                    autoSaveIntervalTurns: 5,
                    showHints: true,
                    showPerfHud: false,
                },
                controls: { bindings: {} },
            },
            schema: mockSchema,
        };
        expect(gameSettingsSchema.schema).toBeDefined();
        expect(gameSettingsSchema.gameId).toBe('test-game');
    });
});

describe('ENGINE_DEFAULTS controls bindings', () => {
    it('includes the F9 debug inspector binding (Invariant #66)', () => {
        expect(ENGINE_DEFAULTS.controls.bindings['engine:toggle-debug-inspector']).toEqual({
            primary: 'F9',
        });
    });

    it('parses against the engine Zod shape', () => {
        const result = z.object(engineSettingsZodShape).safeParse(ENGINE_DEFAULTS);
        expect(result.success).toBe(true);
    });
});

describe('SettingsNamespaceCollisionError', () => {
    it('is exported from the module', () => {
        expect(SettingsNamespaceCollisionError).toBeDefined();
    });

    it('can be instantiated with a message', () => {
        const err = new SettingsNamespaceCollisionError('audio');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(SettingsNamespaceCollisionError);
        expect(err.message).toContain('audio');
    });

    it('has name SettingsNamespaceCollisionError', () => {
        const err = new SettingsNamespaceCollisionError('display');
        expect(err.name).toBe('SettingsNamespaceCollisionError');
    });
});

/**
 * The three halves of a `display` field — the `EngineSettings` interface, the
 * Zod shape and `ENGINE_DEFAULTS` — have to agree, and only ONE of them is
 * self-checking. `engineSettingsZodShape` carries no type annotation, so a
 * field added to the interface and the defaults but forgotten in the Zod shape
 * compiles: `SettingsMerger.validatePatch` strips any key not in the shape, so
 * the player's stored override is discarded on every load. A setting that
 * appears to work and forgets itself.
 *
 * Tests written first (TDD — red confirmed: the round trip dropped
 * `display.shadowQuality` and `display.renderScale` before the Zod half
 * existed, and `ENGINE_DEFAULTS` did not carry them).
 */
describe('display quality settings survive a save/load round trip', () => {
    const engineSchema = z.object(engineSettingsZodShape) as unknown as z.ZodType<EngineSettings>;

    it.each([
        { field: 'shadowQuality', stored: 'high' },
        { field: 'renderScale', stored: 0.75 },
    ])('keeps a stored display.$field override through validatePatch', ({ field, stored }) => {
        const patch = { display: { [field]: stored } };

        const validated = SettingsMerger.validatePatch(engineSchema, patch);

        expect(validated).toEqual(patch);
    });

    it('merges a stored override over the engine default rather than beside it', () => {
        const merged = SettingsMerger.mergeAll(ENGINE_DEFAULTS, {
            display: { shadowQuality: 'medium', renderScale: 0.5 },
        }) as EngineSettings;

        expect(merged.display).toEqual({
            targetFps: ENGINE_DEFAULTS.display.targetFps,
            shadowQuality: 'medium',
            renderScale: 0.5,
        });
    });

    // TypeScript already refuses both literals, which is why they are cast
    // here. The Zod half is the SECOND gate, and the one that matters: a
    // settings file is on disk and hand-editable, so a value that never went
    // through the typed page still has to be refused at load.
    it('rejects a value outside the declared set rather than storing it', () => {
        const outOfSet = (display: Record<string, unknown>): Partial<UserSettings> => ({
            display,
        });

        expect(() =>
            SettingsMerger.validatePatch(engineSchema, outOfSet({ shadowQuality: 'ultra' })),
        ).toThrow();
        expect(() =>
            SettingsMerger.validatePatch(engineSchema, outOfSet({ renderScale: 4 })),
        ).toThrow();
    });

    // The defaults reproduce today's rendering: shadow mapping was off before
    // this setting existed, and 1 is the display's own pixel ratio.
    it('defaults to shadows off at the display native scale', () => {
        expect(ENGINE_DEFAULTS.display).toEqual({
            targetFps: 60,
            shadowQuality: 'off',
            renderScale: 1,
        });
    });
});
