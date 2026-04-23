/**
 * games/tactics/settings-schema.test.ts
 *
 * TDD tests for TacticsSettings and tacticsSettingsSchema.
 *
 * Architecture reference: §F07/T7 (issue #153), §4.13
 */

import { describe, it, expect } from 'vitest';
import { SettingsMerger, InMemorySettingsRepository } from '@chimera/simulation/settings/index.js';
import { SettingsManager } from '@chimera/electron/main/SettingsManager.js';
import { tacticsSettingsSchema, TACTICS_DEFAULTS } from './settings-schema.js';

// ── tacticsSettingsSchema declaration ─────────────────────────────────────────

describe('tacticsSettingsSchema', () => {
    it('has gameId "tactics"', () => {
        expect(tacticsSettingsSchema.gameId).toBe('tactics');
    });

    it('has complete engine defaults from ENGINE_DEFAULTS', () => {
        const d = tacticsSettingsSchema.defaults;
        expect(d.audio.masterVolume).toBe(1.0);
        expect(d.display.fullscreen).toBe(false);
        expect(d.gameplay.autoSave).toBe(true);
    });

    it('has tactics-specific defaults', () => {
        const d = tacticsSettingsSchema.defaults;
        expect(d.showGrid).toBe(true);
        expect(d.animationSpeed).toBe('normal');
        expect(d.showDamageNumbers).toBe(true);
        expect(d.aiThinkingDelayMs).toBe(500);
    });

    it('exports TACTICS_DEFAULTS matching tacticsSettingsSchema.defaults', () => {
        expect(TACTICS_DEFAULTS).toEqual(tacticsSettingsSchema.defaults);
    });
});

// ── Zod schema validation ─────────────────────────────────────────────────────

describe('tacticsSettingsSchema.zodSchema', () => {
    it('accepts valid animationSpeed values', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            animationSpeed: 'fast',
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid animationSpeed', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            animationSpeed: 'turbo',
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative aiThinkingDelayMs', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: -1,
        });
        expect(result.success).toBe(false);
    });

    it('rejects aiThinkingDelayMs above 5000', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: 5001,
        });
        expect(result.success).toBe(false);
    });

    it('accepts aiThinkingDelayMs of 0', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: 0,
        });
        expect(result.success).toBe(true);
    });

    it('accepts aiThinkingDelayMs of 5000', () => {
        const result = tacticsSettingsSchema.zodSchema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: 5000,
        });
        expect(result.success).toBe(true);
    });
});

// ── SettingsMerger smoke test ─────────────────────────────────────────────────

describe('tacticsSettingsSchema — SettingsMerger smoke test', () => {
    it('mergeAll returns tactics defaults when no overrides', () => {
        const merged = SettingsMerger.mergeAll(tacticsSettingsSchema.defaults, {});
        expect(merged['showGrid']).toBe(true);
        expect(merged['animationSpeed']).toBe('normal');
        expect(merged.audio.masterVolume).toBe(1.0);
    });

    it('mergeAll applies user overrides on top of tactics defaults', () => {
        const merged = SettingsMerger.mergeAll(tacticsSettingsSchema.defaults, {
            audio: { masterVolume: 0.5 },
            showGrid: false,
        });
        expect((merged as unknown as { showGrid: boolean }).showGrid).toBe(false);
        expect(merged.audio.masterVolume).toBe(0.5);
        expect(merged.audio.sfxVolume).toBe(1.0); // engine default preserved
    });
});

// ── SettingsManager round-trip ────────────────────────────────────────────────

describe('tacticsSettingsSchema — SettingsManager round-trip', () => {
    it('returns full tactics defaults after registerSchema + getSettings', async () => {
        const repo = new InMemorySettingsRepository();
        const mgr = new SettingsManager(repo);
        mgr.registerSchema(tacticsSettingsSchema);

        const settings = await mgr.getSettings('tactics');
        expect((settings as unknown as { showGrid: boolean }).showGrid).toBe(true);
        expect((settings as unknown as { animationSpeed: string }).animationSpeed).toBe('normal');
        expect(settings.audio.masterVolume).toBe(1.0);
    });
});
