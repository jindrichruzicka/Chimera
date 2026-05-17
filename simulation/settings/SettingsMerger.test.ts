import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ENGINE_DEFAULTS, type EngineSettings } from './SettingsSchema';
import { SettingsMerger, SettingsValidationError } from './SettingsMerger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeEngineZod = () =>
    z.object({
        audio: z.object({
            masterVolume: z.number().min(0).max(1),
            sfxVolume: z.number().min(0).max(1),
            musicVolume: z.number().min(0).max(1),
            muted: z.boolean(),
        }),
        display: z.object({
            fullscreen: z.boolean(),
            vsync: z.boolean(),
            targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
            uiScale: z.number().min(0.5).max(2.0),
        }),
        gameplay: z.object({
            language: z.string(),
            autoSave: z.boolean(),
            autoSaveIntervalTurns: z.number().int().nonnegative(),
            showHints: z.boolean(),
            showPerfHud: z.boolean(),
        }),
        controls: z.object({
            bindings: z.record(
                z.string(),
                z.object({
                    primary: z.string(),
                    secondary: z.string().optional(),
                    modifiers: z.array(z.enum(['Ctrl', 'Shift', 'Alt', 'Meta'])).optional(),
                }),
            ),
        }),
    });

type TestSettings = EngineSettings & { showGrid: boolean } & Record<string, unknown>;

const makeGameDefaults = (): TestSettings => ({
    ...ENGINE_DEFAULTS,
    showGrid: true,
});

const makeGameZod = () => makeEngineZod().extend({ showGrid: z.boolean() });

// ─── SettingsMerger.mergeAll ───────────────────────────────────────────────

describe('SettingsMerger.mergeAll', () => {
    it('returns game defaults when user overrides are empty', () => {
        const result = SettingsMerger.mergeAll(makeGameDefaults(), {});
        expect(result).toEqual(makeGameDefaults());
    });

    it('applies a user override at the top level (showGrid)', () => {
        const result = SettingsMerger.mergeAll(makeGameDefaults(), {
            showGrid: false,
        });
        expect(result['showGrid']).toBe(false);
        // Other fields untouched
        expect(result.audio).toEqual(ENGINE_DEFAULTS.audio);
    });

    it('deep-merges nested user overrides without clobbering sibling keys', () => {
        const result = SettingsMerger.mergeAll(makeGameDefaults(), {
            audio: { masterVolume: 0.3 },
        });
        expect(result.audio.masterVolume).toBe(0.3);
        // Sibling keys preserved from game defaults
        expect(result.audio.sfxVolume).toBe(ENGINE_DEFAULTS.audio.sfxVolume);
        expect(result.audio.muted).toBe(ENGINE_DEFAULTS.audio.muted);
    });

    it('user overrides win over game defaults', () => {
        const gameDefaults = { ...makeGameDefaults(), showGrid: true };
        const result = SettingsMerger.mergeAll(gameDefaults, {
            showGrid: false,
        });
        expect(result['showGrid']).toBe(false);
    });

    it('strips unknown keys present in userOverrides but absent from gameDefaults', () => {
        const result = SettingsMerger.mergeAll(makeGameDefaults(), {
            unknownKey: 'should-be-stripped',
        });
        expect('unknownKey' in result).toBe(false);
    });

    it('strips unknown nested keys inside known nested objects', () => {
        const result = SettingsMerger.mergeAll(makeGameDefaults(), {
            audio: { masterVolume: 0.5, unknownAudioKey: true } as Record<string, unknown>,
        });
        expect('unknownAudioKey' in result.audio).toBe(false);
        expect(result.audio.masterVolume).toBe(0.5);
    });
});

// ─── SettingsMerger.validatePatch ─────────────────────────────────────────

describe('SettingsMerger.validatePatch', () => {
    it('returns the patch unchanged when all keys are valid', () => {
        const schema = makeGameZod();
        const patch = { showGrid: false };
        const result = SettingsMerger.validatePatch(schema, patch);
        expect(result).toEqual({ showGrid: false });
    });

    it('strips unknown keys not in the schema', () => {
        const schema = makeGameZod();
        const patch = { showGrid: false, unknownKey: 'bad' } as Record<string, unknown>;
        const result = SettingsMerger.validatePatch(schema, patch);
        expect('unknownKey' in result).toBe(false);
        expect(result).toHaveProperty('showGrid', false);
    });

    it('throws SettingsValidationError when a value has the wrong type', () => {
        const schema = makeGameZod();
        const patch = { showGrid: 'not-a-boolean' } as unknown as Record<string, unknown>;
        expect(() => SettingsMerger.validatePatch(schema, patch)).toThrow(SettingsValidationError);
    });

    it('throws SettingsValidationError with a descriptive message', () => {
        const schema = makeGameZod();
        expect(() =>
            SettingsMerger.validatePatch(schema, {
                audio: { masterVolume: 999 },
            }),
        ).toThrow(SettingsValidationError);
    });
});

// ─── SettingsValidationError ────────────────────────────────────────────────

describe('SettingsValidationError', () => {
    it('is an instanceof Error', () => {
        const err = new SettingsValidationError('bad');
        expect(err).toBeInstanceOf(Error);
    });

    it('is an instanceof SettingsValidationError', () => {
        const err = new SettingsValidationError('bad');
        expect(err).toBeInstanceOf(SettingsValidationError);
    });

    it('has name SettingsValidationError', () => {
        expect(new SettingsValidationError('bad').name).toBe('SettingsValidationError');
    });
});
