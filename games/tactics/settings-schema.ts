/**
 * games/tactics/settings-schema.ts
 *
 * TacticsSettings extends EngineSettings with tactics-specific fields.
 * The exported tacticsSettingsSchema is registered with SettingsManager at startup.
 *
 * Architecture reference: §F07/T7 (issue #153), §4.13
 *
 * Module boundary: may import from simulation/, ai/, shared/ and own files only.
 * Must NOT import from renderer/, electron/, or other games/ directories.
 */

import { z } from 'zod';
import { ENGINE_DEFAULTS } from '@chimera/simulation/settings/index.js';
import type { EngineSettings, GameSettingsSchema } from '@chimera/simulation/settings/index.js';

// ── TacticsSettings interface ─────────────────────────────────────────────────

export interface TacticsSettings extends EngineSettings {
    /** Whether to render the hex/tile grid overlay. */
    readonly showGrid: boolean;
    /** Speed of unit movement and attack animations. */
    readonly animationSpeed: 'slow' | 'normal' | 'fast' | 'instant';
    /** Whether to show floating damage numbers on hit. */
    readonly showDamageNumbers: boolean;
    /** Milliseconds the AI "thinking" indicator is shown before acting (0 = instant). */
    readonly aiThinkingDelayMs: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const TACTICS_DEFAULTS: TacticsSettings = {
    ...ENGINE_DEFAULTS,
    showGrid: true,
    animationSpeed: 'normal',
    showDamageNumbers: true,
    aiThinkingDelayMs: 500,
} as const;

// ── Zod schema ────────────────────────────────────────────────────────────────

const tacticsZodSchema = z.object({
    // Engine fields (re-declared for full round-trip validation)
    audio: z.object({
        masterVolume: z.number().min(0).max(1),
        sfxVolume: z.number().min(0).max(1),
        musicVolume: z.number().min(0).max(1),
        muted: z.boolean(),
    }),
    display: z.object({
        fullscreen: z.boolean(),
        vsync: z.boolean(),
        targetFps: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(0)]),
        uiScale: z.number().min(0.5).max(2.0),
    }),
    gameplay: z.object({
        language: z.string().min(1),
        autoSave: z.boolean(),
        autoSaveIntervalTurns: z.number().int().nonnegative(),
        showHints: z.boolean(),
        showPerfHud: z.boolean(),
    }),
    controls: z.object({
        keyBindings: z.record(z.string(), z.string()),
    }),
    // Tactics-specific fields
    showGrid: z.boolean(),
    animationSpeed: z.enum(['slow', 'normal', 'fast', 'instant']),
    showDamageNumbers: z.boolean(),
    aiThinkingDelayMs: z.number().int().min(0).max(5000),
});

// ── Schema declaration ────────────────────────────────────────────────────────

export const tacticsSettingsSchema: GameSettingsSchema<TacticsSettings> = {
    gameId: 'tactics',
    defaults: TACTICS_DEFAULTS,
    zodSchema: tacticsZodSchema,
};
