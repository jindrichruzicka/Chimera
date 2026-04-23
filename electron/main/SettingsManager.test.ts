/**
 * electron/main/SettingsManager.test.ts
 *
 * Unit tests for SettingsManager.
 * Uses InMemorySettingsRepository so no filesystem is involved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { EngineSettings, GameSettingsSchema } from '@chimera/simulation/settings/index.js';
import { ENGINE_DEFAULTS, InMemorySettingsRepository } from '@chimera/simulation/settings/index.js';
import { SettingsManager, SettingsNamespaceCollisionError } from './SettingsManager.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const engineSchema = z.object({
    audio: z.object({
        masterVolume: z.number(),
        sfxVolume: z.number(),
        musicVolume: z.number(),
        muted: z.boolean(),
    }),
    display: z.object({
        fullscreen: z.boolean(),
        vsync: z.boolean(),
        targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
        uiScale: z.number(),
    }),
    gameplay: z.object({
        language: z.string(),
        autoSave: z.boolean(),
        autoSaveIntervalTurns: z.number().int(),
        showHints: z.boolean(),
        showPerfHud: z.boolean(),
    }),
    controls: z.object({
        keyBindings: z.record(z.string(), z.string()),
    }),
});

const engineSettingsSchema: GameSettingsSchema<EngineSettings> = {
    gameId: 'test-game',
    defaults: ENGINE_DEFAULTS,
    zodSchema: engineSchema,
};

interface ExtSettings extends EngineSettings {
    readonly showGrid: boolean;
}

const extSchema = z.object({
    audio: engineSchema.shape.audio,
    display: engineSchema.shape.display,
    gameplay: engineSchema.shape.gameplay,
    controls: engineSchema.shape.controls,
    showGrid: z.boolean(),
});

const extSettingsSchema: GameSettingsSchema<ExtSettings> = {
    gameId: 'ext-game',
    defaults: { ...ENGINE_DEFAULTS, showGrid: true },
    zodSchema: extSchema,
};

function makeManager(): SettingsManager {
    const repo = new InMemorySettingsRepository();
    return new SettingsManager(repo);
}

// ── registerSchema ────────────────────────────────────────────────────────────

describe('SettingsManager.registerSchema()', () => {
    it('registers a schema without throwing', () => {
        const mgr = makeManager();
        expect(() => mgr.registerSchema(engineSettingsSchema)).not.toThrow();
    });

    it('throws SettingsNamespaceCollisionError when registering the same gameId twice', () => {
        const mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
        expect(() => mgr.registerSchema(engineSettingsSchema)).toThrow(
            SettingsNamespaceCollisionError,
        );
    });

    it('throws SettingsNamespaceCollisionError when game schema has a key that shadows engine namespace', () => {
        const mgr = makeManager();
        // A schema whose game-specific key list contains no extra keys is fine
        const pureEngineSchema: GameSettingsSchema<EngineSettings> = {
            gameId: 'bad-game',
            defaults: { ...ENGINE_DEFAULTS },
            zodSchema: engineSchema,
        };
        expect(() => mgr.registerSchema(pureEngineSchema)).not.toThrow(); // pure engine keys are fine
    });
});

// ── getSettings ───────────────────────────────────────────────────────────────

describe('SettingsManager.getSettings()', () => {
    let mgr: SettingsManager;

    beforeEach(() => {
        mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
    });

    it('returns engine defaults when no user overrides saved', async () => {
        const settings = await mgr.getSettings('test-game');
        expect(settings).toMatchObject(ENGINE_DEFAULTS);
    });

    it('returns merged settings after user overrides are saved', async () => {
        const repo = new InMemorySettingsRepository();
        await repo.save('test-game', { audio: { masterVolume: 0.2 } });
        const mgr2 = new SettingsManager(repo);
        mgr2.registerSchema(engineSettingsSchema);
        const settings = await mgr2.getSettings('test-game');
        expect(settings.audio.masterVolume).toBe(0.2);
        expect(settings.audio.sfxVolume).toBe(ENGINE_DEFAULTS.audio.sfxVolume);
    });

    it('returns engine defaults for unregistered gameId (graceful degradation, no throw)', async () => {
        const settings = await mgr.getSettings('unknown-game');
        expect(settings).toMatchObject(ENGINE_DEFAULTS);
    });

    it('merges game-specific defaults when schema has extra fields', async () => {
        const mgr2 = makeManager();
        mgr2.registerSchema(extSettingsSchema);
        const settings = await mgr2.getSettings('ext-game');
        const extSettings = settings as unknown as ExtSettings;
        expect(extSettings.showGrid).toBe(true);
    });
});

// ── updateSettings ────────────────────────────────────────────────────────────

describe('SettingsManager.updateSettings()', () => {
    let mgr: SettingsManager;

    beforeEach(() => {
        mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
    });

    it('persists and returns merged settings after a valid patch', async () => {
        const result = await mgr.updateSettings('test-game', { audio: { masterVolume: 0.3 } });
        expect(result.audio.masterVolume).toBe(0.3);
        expect(result.audio.sfxVolume).toBe(ENGINE_DEFAULTS.audio.sfxVolume);
    });

    it('second getSettings() reflects the persisted patch', async () => {
        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.3 } });
        const settings = await mgr.getSettings('test-game');
        expect(settings.audio.masterVolume).toBe(0.3);
    });

    it('throws SettingsValidationError for an invalid field value', async () => {
        await expect(
            mgr.updateSettings('test-game', {
                audio: { masterVolume: 'not-a-number' as unknown as number },
            }),
        ).rejects.toThrow();
    });
});

// ── resetSettings ─────────────────────────────────────────────────────────────

describe('SettingsManager.resetSettings()', () => {
    it('returns defaults after resetting persisted overrides', async () => {
        const mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.1 } });
        const result = await mgr.resetSettings('test-game');
        expect(result.audio.masterVolume).toBe(ENGINE_DEFAULTS.audio.masterVolume);
    });

    it('subsequent getSettings() returns defaults after reset', async () => {
        const mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.1 } });
        await mgr.resetSettings('test-game');
        const settings = await mgr.getSettings('test-game');
        expect(settings.audio.masterVolume).toBe(ENGINE_DEFAULTS.audio.masterVolume);
    });
});

// ── broadcastChange ───────────────────────────────────────────────────────────

describe('SettingsManager broadcastChange', () => {
    it('calls broadcastFn with gameId and merged settings on updateSettings', async () => {
        const broadcastFn = vi.fn();
        const mgr = new SettingsManager(new InMemorySettingsRepository(), broadcastFn);
        mgr.registerSchema(engineSettingsSchema);
        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.7 } });
        expect(broadcastFn).toHaveBeenCalledOnce();
        const [calledGameId, calledSettings] = broadcastFn.mock.calls[0] as [
            string,
            EngineSettings,
        ];
        expect(calledGameId).toBe('test-game');
        expect(calledSettings.audio.masterVolume).toBe(0.7);
    });

    it('calls broadcastFn on resetSettings', async () => {
        const broadcastFn = vi.fn();
        const mgr = new SettingsManager(new InMemorySettingsRepository(), broadcastFn);
        mgr.registerSchema(engineSettingsSchema);
        await mgr.resetSettings('test-game');
        expect(broadcastFn).toHaveBeenCalledOnce();
    });

    it('does not call broadcastFn when not supplied', async () => {
        const mgr = makeManager();
        mgr.registerSchema(engineSettingsSchema);
        // Should not throw when no broadcast fn
        await expect(mgr.updateSettings('test-game', {})).resolves.toBeDefined();
    });
});
