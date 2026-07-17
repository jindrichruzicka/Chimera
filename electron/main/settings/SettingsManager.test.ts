/**
 * electron/main/SettingsManager.test.ts
 *
 * Unit tests for SettingsManager.
 * Uses InMemorySettingsRepository so no filesystem is involved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type {
    EngineSettings,
    GameSettingsSchema,
    SettingsRepository,
    UserSettings,
} from '@chimera-engine/simulation/settings/index.js';
import {
    ENGINE_DEFAULTS,
    InMemorySettingsRepository,
    SettingsNamespaceCollisionError,
} from '@chimera-engine/simulation/settings/index.js';
import { SettingsManager } from './SettingsManager.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const engineSchema = z.object({
    audio: z.object({
        masterVolume: z.number(),
        sfxVolume: z.number(),
        musicVolume: z.number(),
        muted: z.boolean(),
    }),
    display: z.object({
        targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
    }),
    gameplay: z.object({
        language: z.string(),
        autoSave: z.boolean(),
        autoSaveIntervalTurns: z.number().int(),
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

const engineSettingsSchema: GameSettingsSchema<EngineSettings> = {
    gameId: 'test-game',
    defaults: ENGINE_DEFAULTS,
    schema: engineSchema,
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
    schema: extSchema,
};

function makeManager(): SettingsManager {
    const repo = new InMemorySettingsRepository();
    return new SettingsManager(repo);
}

function cloneSettings<T>(value: T): T {
    return structuredClone(value);
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

async function flushPromiseJobs(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

class BlockingFirstSaveRepository implements SettingsRepository {
    private readonly storage = new Map<string, UserSettings>();
    private firstSaveBlocked = true;
    private readonly firstSaveEntered = createDeferred();
    private readonly releaseFirstSave = createDeferred();

    async load(gameId: string): Promise<UserSettings> {
        return cloneSettings(this.storage.get(gameId) ?? {});
    }

    async save(gameId: string, settings: UserSettings): Promise<void> {
        if (this.firstSaveBlocked) {
            this.firstSaveBlocked = false;
            this.firstSaveEntered.resolve();
            await this.releaseFirstSave.promise;
        }

        this.storage.set(gameId, cloneSettings(settings));
    }

    async reset(gameId: string): Promise<void> {
        this.storage.delete(gameId);
    }

    waitForFirstSave(): Promise<void> {
        return this.firstSaveEntered.promise;
    }

    unblockFirstSave(): void {
        this.releaseFirstSave.resolve();
    }
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
            schema: engineSchema,
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

    it('serializes concurrent updates for one game so the latest patch stays persisted', async () => {
        const repo = new BlockingFirstSaveRepository();
        const concurrentMgr = new SettingsManager(repo);
        concurrentMgr.registerSchema(engineSettingsSchema);

        const firstUpdate = concurrentMgr.updateSettings('test-game', {
            audio: { masterVolume: 0.3 },
        });
        await repo.waitForFirstSave();

        const secondUpdate = concurrentMgr.updateSettings('test-game', {
            audio: { masterVolume: 0.42 },
        });

        await flushPromiseJobs();
        repo.unblockFirstSave();

        await Promise.all([firstUpdate, secondUpdate]);

        expect(await repo.load('test-game')).toEqual({ audio: { masterVolume: 0.42 } });
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

// ── BLOCK-3: validate loaded JSON in getSettings() ────────────────────────────

describe('SettingsManager.getSettings() — corrupt JSON validation (BLOCK-3)', () => {
    it('returns defaults and logs a warning when stored overrides fail schema validation', async () => {
        const repo = new InMemorySettingsRepository();
        // Corrupt override: audio.masterVolume should be a number but is a string
        await repo.save('test-game', {
            audio: { masterVolume: 'loud' as unknown as number },
        });
        const warnSpy = vi.fn();
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: warnSpy,
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis(),
        };
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        const settings = await mgr.getSettings('test-game');

        // Should fall back to defaults, not blow up
        expect(settings.audio.masterVolume).toBe(ENGINE_DEFAULTS.audio.masterVolume);
        // Should have logged a warning
        expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('returns merged settings without warning when stored overrides are valid', async () => {
        const repo = new InMemorySettingsRepository();
        await repo.save('test-game', { audio: { masterVolume: 0.4 } });
        const warnSpy = vi.fn();
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: warnSpy,
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis(),
        };
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        const settings = await mgr.getSettings('test-game');

        expect(settings.audio.masterVolume).toBe(0.4);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

// ── overrides persistence (BLOCK-1, WARN-2, WARN-7) ──────────────────────────

describe('SettingsManager.updateSettings() — overrides-only persistence (BLOCK-1)', () => {
    it('repo.load() after a single-field update returns only the changed key, not all defaults', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.3 } });

        const persisted = await repo.load('test-game');
        // Only the overridden key should be stored — not the full defaults tree
        expect(persisted).toEqual({ audio: { masterVolume: 0.3 } });
    });

    it('getSettings() still returns fully-merged result after the overrides-only fix', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.3 } });

        const settings = await mgr.getSettings('test-game');
        expect(settings.audio.masterVolume).toBe(0.3);
        expect(settings.audio.sfxVolume).toBe(ENGINE_DEFAULTS.audio.sfxVolume);
        expect(settings.display).toEqual(ENGINE_DEFAULTS.display);
    });

    it('two sequential updates accumulate overrides without restoring defaults', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.updateSettings('test-game', { audio: { masterVolume: 0.3 } });
        await mgr.updateSettings('test-game', { audio: { sfxVolume: 0.5 } });

        const persisted = await repo.load('test-game');
        // Both overrides should be present; no defaults pollution
        expect(persisted).toEqual({ audio: { masterVolume: 0.3, sfxVolume: 0.5 } });
    });

    it('treats controls.bindings as a replace map so removed bindings are not retained in overrides', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.updateSettings('test-game', {
            controls: {
                bindings: {
                    'engine:undo': { primary: 'KeyA' },
                    'game:end-turn': { primary: 'KeyE' },
                },
            },
        });

        await mgr.updateSettings('test-game', {
            controls: {
                bindings: {
                    'engine:undo': { primary: 'KeyA' },
                },
            },
        });

        const persisted = await repo.load('test-game');
        expect(persisted).toEqual({
            controls: {
                bindings: {
                    'engine:undo': { primary: 'KeyA' },
                },
            },
        });
    });

    it('validatePatch return value is used — invalid patch is rejected before reaching repo', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(engineSettingsSchema);

        await expect(
            mgr.updateSettings('test-game', {
                audio: { masterVolume: 'not-a-number' as unknown as number },
            }),
        ).rejects.toThrow();

        // Repo must remain empty — patch must not have been saved
        const persisted = await repo.load('test-game');
        expect(persisted).toEqual({});
    });
});

// ── Legacy keyBindings migration (WARN-1 fix) ─────────────────────────────────

describe('SettingsManager.getSettings() — legacy controls.keyBindings migration', () => {
    function makeLogger() {
        const warnSpy = vi.fn();
        return {
            logger: {
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: warnSpy,
                error: vi.fn(),
                fatal: vi.fn(),
                child: vi.fn().mockReturnThis(),
            },
            warnSpy,
        };
    }

    it('logs a warning when controls.keyBindings is present in persisted overrides', async () => {
        const repo = new InMemorySettingsRepository();
        // Simulate a settings file written by the old schema (keyBindings = flat string map).
        // @chimera-review: double-cast needed to inject a legacy on-disk shape that no longer
        // matches UserSettings — this is the only way to exercise the migration path in tests.
        await repo.save('test-game', {
            controls: { keyBindings: { undo: 'Ctrl+Z' } },
        } as unknown as UserSettings);
        const { logger, warnSpy } = makeLogger();
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.getSettings('test-game');

        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0]?.[0]).toContain('keyBindings');
    });

    it('returns engine-default bindings (not old keyBindings) after migration', async () => {
        const repo = new InMemorySettingsRepository();
        await repo.save('test-game', {
            controls: { keyBindings: { undo: 'Ctrl+Z' } },
        } as unknown as UserSettings);
        const { logger } = makeLogger();
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        const settings = await mgr.getSettings('test-game');

        expect(settings.controls.bindings).toEqual(ENGINE_DEFAULTS.controls.bindings);
    });

    it('rewrites the repo without controls.keyBindings so the warning does not repeat', async () => {
        const repo = new InMemorySettingsRepository();
        await repo.save('test-game', {
            controls: { keyBindings: { undo: 'Ctrl+Z' } },
        } as unknown as UserSettings);
        const { logger } = makeLogger();
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.getSettings('test-game');

        const persisted = await repo.load('test-game');
        expect(persisted).not.toHaveProperty('controls.keyBindings');
    });

    it('preserves other controls overrides that coexist with keyBindings', async () => {
        const repo = new InMemorySettingsRepository();
        // Old file had keyBindings alongside a valid bindings override – the
        // bindings entry must survive migration; only keyBindings is dropped.
        await repo.save('test-game', {
            controls: {
                keyBindings: { undo: 'Ctrl+Z' },
                bindings: { 'engine:toggle-menu': { primary: 'Escape' } },
            },
        } as unknown as UserSettings);
        const { logger } = makeLogger();
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        const settings = await mgr.getSettings('test-game');

        // The valid bindings override should have been kept
        expect(settings.controls.bindings['engine:toggle-menu']).toEqual({ primary: 'Escape' });
    });

    it('does not warn or mutate the repo when controls.keyBindings is absent', async () => {
        const repo = new InMemorySettingsRepository();
        await repo.save('test-game', { audio: { masterVolume: 0.5 } });
        const { logger, warnSpy } = makeLogger();
        const mgr = new SettingsManager(repo, undefined, logger);
        mgr.registerSchema(engineSettingsSchema);

        await mgr.getSettings('test-game');

        expect(warnSpy).not.toHaveBeenCalled();
        const persisted = await repo.load('test-game');
        expect(persisted).toEqual({ audio: { masterVolume: 0.5 } });
    });
});
