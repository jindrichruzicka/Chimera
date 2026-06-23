/**
 * games/tactics/settings-schema.test.ts
 *
 * TDD tests for TacticsSettings and tacticsSettingsSchema.
 *
 * Architecture reference: §F07/T7 (issue #153), §4.13
 */

import { describe, it, expect } from 'vitest';
import { ENGINE_DEFAULTS, SettingsMerger } from '@chimera/simulation/settings/index.js';
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

    it('keeps game:end-turn out of engine defaults and owns it as a tactics binding', () => {
        expect(ENGINE_DEFAULTS.controls.bindings['game:end-turn']).toBeUndefined();
        expect(tacticsSettingsSchema.defaults.controls.bindings['game:end-turn']).toEqual({
            primary: 'Enter',
        });
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

describe('tacticsSettingsSchema.schema', () => {
    it('accepts valid animationSpeed values', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
            ...TACTICS_DEFAULTS,
            animationSpeed: 'fast',
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid animationSpeed', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
            ...TACTICS_DEFAULTS,
            animationSpeed: 'turbo',
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative aiThinkingDelayMs', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: -1,
        });
        expect(result.success).toBe(false);
    });

    it('rejects aiThinkingDelayMs above 5000', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: 5001,
        });
        expect(result.success).toBe(false);
    });

    it('accepts aiThinkingDelayMs of 0', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
            ...TACTICS_DEFAULTS,
            aiThinkingDelayMs: 0,
        });
        expect(result.success).toBe(true);
    });

    it('accepts aiThinkingDelayMs of 5000', () => {
        const result = tacticsSettingsSchema.schema.safeParse({
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

// NOTE (F62 #777): the former "SettingsManager round-trip" block was removed when
// @chimera/electron gained its curated `exports` map. SettingsManager is an
// electron-main internal (electron/main/settings/SettingsManager.ts) and is not a
// reachable package subpath (Invariant #5) — a game's tests must not reach across
// into host internals. Its assertions (registerSchema('tactics') + getSettings
// returns the full merged tactics defaults) duplicated the SettingsMerger smoke
// test above; the registerSchema/getSettings integration is owned by electron's
// own SettingsManager tests, which use a game schema as a fixture.
