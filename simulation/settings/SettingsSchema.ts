import type { z } from 'zod';

// ─── DeepPartial utility ─────────────────────────────────────────────────────

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// ─── Engine base settings ────────────────────────────────────────────────────

export interface EngineSettings {
    readonly audio: {
        readonly masterVolume: number; // 0.0–1.0
        readonly sfxVolume: number;
        readonly musicVolume: number;
        readonly muted: boolean;
    };
    readonly display: {
        readonly fullscreen: boolean;
        readonly vsync: boolean;
        readonly targetFps: 30 | 60 | 120 | 0; // 0 = uncapped
        readonly uiScale: number; // 0.5–2.0 multiplier
    };
    readonly gameplay: {
        readonly language: string; // BCP 47 locale tag, e.g. 'en-US'
        readonly autoSave: boolean;
        readonly autoSaveIntervalTurns: number;
        readonly showHints: boolean;
        readonly showPerfHud: boolean;
    };
    readonly controls: {
        readonly keyBindings: Readonly<Record<string, string>>; // actionId → key
    };
}

// ─── Engine defaults ─────────────────────────────────────────────────────────

export const ENGINE_DEFAULTS: EngineSettings = {
    audio: {
        masterVolume: 1.0,
        sfxVolume: 1.0,
        musicVolume: 0.8,
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
        keyBindings: {
            undo: 'Ctrl+Z',
            redo: 'Ctrl+Y',
            endTurn: 'Enter',
        },
    },
} as const;

// ─── Game-specific schema declaration ────────────────────────────────────────

export interface GameSettingsSchema<T extends EngineSettings> {
    readonly gameId: string;
    /** Complete set of game defaults (engine fields + game fields). */
    readonly defaults: T;
    /** Zod schema for parse / strip / validate. */
    readonly zodSchema: z.ZodType<T>;
}

// ─── Runtime types ───────────────────────────────────────────────────────────

/** Fully merged result — what the renderer and simulation-host see. */
export type ResolvedSettings = EngineSettings & Record<string, unknown>;

/** What the file on disk contains — only keys the user explicitly changed. */
export type UserSettings = DeepPartial<ResolvedSettings>;
