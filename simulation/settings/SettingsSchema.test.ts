/**
 * simulation/settings/SettingsSchema.test.ts
 *
 * Tests for the exported Zod shape (engineSettingsZodShape) from SettingsSchema,
 * DeepPartial<EngineSettings>, and SettingsNamespaceCollisionError.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DeepPartial, EngineSettings, GameSettingsSchema } from './SettingsSchema.js';
import { SettingsNamespaceCollisionError, engineSettingsZodShape } from './SettingsSchema.js';

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
                fullscreen: false,
                vsync: true,
                targetFps: 60,
                uiScale: 1.0,
            },
            gameplay: {
                language: 'en-US',
                autoSave: true,
                autoSaveIntervalTurns: 5,
                showHints: true,
                showPerfHud: false,
            },
            controls: {
                keyBindings: { endTurn: 'Enter' },
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
            display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1.0 },
            gameplay: {
                language: 'en-US',
                autoSave: true,
                autoSaveIntervalTurns: 5,
                showHints: true,
                showPerfHud: false,
            },
            controls: { keyBindings: {} },
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
            display: { fullscreen: true },
            gameplay: { language: 'fr-FR' },
        };
        expect(partial.display?.fullscreen).toBe(true);
        expect(partial.gameplay?.language).toBe('fr-FR');
        expect(partial.display?.vsync).toBeUndefined();
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
                display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1.0 },
                gameplay: {
                    language: 'en-US',
                    autoSave: true,
                    autoSaveIntervalTurns: 5,
                    showHints: true,
                    showPerfHud: false,
                },
                controls: { keyBindings: {} },
            },
            schema: mockSchema,
        };
        expect(gameSettingsSchema.schema).toBeDefined();
        expect(gameSettingsSchema.gameId).toBe('test-game');
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
