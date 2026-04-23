/**
 * simulation/settings/SettingsSchema.test.ts
 *
 * Tests for the exported Zod shape (engineSettingsZodShape) from SettingsSchema.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { engineSettingsZodShape } from './SettingsSchema.js';

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
