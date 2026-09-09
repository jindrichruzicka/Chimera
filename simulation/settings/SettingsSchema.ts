import { z } from 'zod';

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
        /** Caps the renderer's frame rate; `0` = uncapped (native refresh).
         *  Applied by the renderer, never read by the simulation; see §4.13/§4.22
         *  for the mechanism. */
        readonly targetFps: 30 | 60 | 120 | 0;
        /** Shadow-map quality tier; `'off'` disables shadow mapping.
         *  An engine-owned NAME, never a `three` constant (Invariant #1): the
         *  tier becomes a shadow-map type on the renderer side alone. Applied
         *  by the renderer, never read by the simulation. */
        readonly shadowQuality: 'off' | 'low' | 'medium' | 'high';
        /** Fraction of the display's own pixel ratio to render at; `1` = native.
         *  Below 1 trades sharpness for fill rate — the usual lever on an
         *  integrated GPU. Applied by the renderer, never read by the
         *  simulation. */
        readonly renderScale: 0.5 | 0.75 | 1;
    };
    readonly gameplay: {
        readonly language: string; // BCP 47 locale tag, e.g. 'en-US'
        readonly autoSave: boolean;
        readonly autoSaveIntervalTurns: number;
        readonly showHints: boolean;
        readonly showPerfHud: boolean;
    };
    readonly controls: {
        /** Key bindings keyed by namespaced InputActionId (e.g. 'engine:undo').
         *  Each value is a KeyBinding-compatible object with a required `primary`
         *  key code and optional `secondary` / `modifiers`.
         *  Invariant #66: stored here, never in profile data.
         */
        readonly bindings: Readonly<
            Record<
                string,
                {
                    readonly primary: string;
                    readonly secondary?: string | undefined;
                    readonly modifiers?: readonly ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[] | undefined;
                }
            >
        >;
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
        // Shadows off and native scale: what the canvas rendered before either
        // setting existed, so a player who never opens the page sees no change.
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
        bindings: {
            'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
            'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
            'engine:toggle-menu': { primary: 'Escape' },
            'engine:toggle-perf-hud': { primary: 'F3' },
            'engine:toggle-i18n-token-mode': { primary: 'F4' },
            'engine:toggle-debug-inspector': { primary: 'F9' },
            // `Tab` = "next seat" for the spectator perspective switch. The input
            // layer does not preventDefault, so while spectating a Tab press both
            // cycles the followed seat and traverses DOM focus — benign on the
            // read-only spectator overlay, and the binding is rebindable.
            'engine:spectate-cycle': { primary: 'Tab' },
        },
    },
} as const;

// ─── Namespace collision guard ────────────────────────────────────────────────

/**
 * Thrown by `SettingsManager.registerSchema()` when one of the four reserved engine
 * namespaces (`audio`, `display`, `gameplay`, `controls`) does not reach it intact —
 * shadowed by a game-defined value, carrying only some engine sub-keys, or missing
 * altogether — and when the same `gameId` is registered twice.
 *
 * Enforces Invariant #35. The name predates the widening: a game omitting a reserved
 * namespace is not a "collision", but it is rejected by the same guard, because a
 * missing namespace degrades the merge exactly as a shadowed one does.
 */
export class SettingsNamespaceCollisionError extends Error {
    public override readonly name = 'SettingsNamespaceCollisionError';

    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, SettingsNamespaceCollisionError.prototype);
    }
}

// ─── Game-specific schema declaration ────────────────────────────────────────

export interface GameSettingsSchema<T extends EngineSettings> {
    readonly gameId: string;
    /** Complete set of game defaults (engine fields + game fields). */
    readonly defaults: T;
    /** Zod schema for parse / strip / validate at runtime. */
    readonly schema: z.ZodType<T>;
}

// ─── Runtime types ───────────────────────────────────────────────────────────

/** Fully merged result — what the renderer and simulation-host see. */
export type ResolvedSettings = EngineSettings & Record<string, unknown>;

/** What the file on disk contains — only keys the user explicitly changed. */
export type UserSettings = DeepPartial<ResolvedSettings>;

// ─── Shared engine Zod shape ──────────────────────────────────────────────────

/**
 * Zod shape for all four engine-owned setting namespaces.
 * Game schemas can spread this into their own `z.object({ ...engineSettingsZodShape, ... })`
 * to avoid duplicating the engine field definitions.
 *
 * This is exported as a raw `ZodRawShape` (plain object of Zod schemas) so
 * game packages can use it with `z.object({ ...engineSettingsZodShape, gameKey: ... })`
 * without importing a fully-constructed ZodObject.
 */
export const engineSettingsZodShape = {
    audio: z.object({
        masterVolume: z.number().min(0).max(1),
        sfxVolume: z.number().min(0).max(1),
        musicVolume: z.number().min(0).max(1),
        muted: z.boolean(),
    }),
    display: z.object({
        targetFps: z.literal(30).or(z.literal(60)).or(z.literal(120)).or(z.literal(0)),
        shadowQuality: z.enum(['off', 'low', 'medium', 'high']),
        renderScale: z.literal(0.5).or(z.literal(0.75)).or(z.literal(1)),
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
} as const;
