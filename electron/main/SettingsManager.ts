/**
 * electron/main/SettingsManager.ts
 *
 * Orchestrates per-game settings: schema registration, merge, persist, and
 * broadcast.  Delegates I/O to an injected `SettingsRepository`.
 *
 * Architecture reference: §F07/T4 (issue #150), §3 settings-manager.ts
 *
 * Invariants upheld:
 *   #34 — registerSchema() must be called before getSettings/updateSettings
 *          for a game.  Calling getSettings for an unregistered gameId returns
 *          engine defaults and does NOT throw (graceful degradation).
 *   #35 — Game schema keys must not shadow engine namespace keys
 *          (audio, display, gameplay, controls).  Enforced in registerSchema().
 *   #67 — Constructed with injected dependencies; no raw console.* calls.
 */

import type {
    EngineSettings,
    GameSettingsSchema,
    ResolvedSettings,
    SettingsRepository,
    UserSettings,
} from '@chimera/simulation/settings/index.js';
import { ENGINE_DEFAULTS, SettingsMerger } from '@chimera/simulation/settings/index.js';

/** Top-level engine namespace keys that game schemas must not shadow (invariant #35). */
const ENGINE_NAMESPACE_KEYS = new Set(['audio', 'display', 'gameplay', 'controls']);

/**
 * Deep-merges `incoming` into `current`, keeping all keys from both.
 * Used to combine two UserSettings objects (both are DeepPartial) so that
 * incoming values win at each leaf, without injecting any defaults.
 */
function mergeUserOverrides(
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...current };
    for (const [key, inVal] of Object.entries(incoming)) {
        const curVal = current[key];
        if (
            curVal !== null &&
            typeof curVal === 'object' &&
            !Array.isArray(curVal) &&
            inVal !== null &&
            typeof inVal === 'object' &&
            !Array.isArray(inVal)
        ) {
            result[key] = mergeUserOverrides(
                curVal as Record<string, unknown>,
                inVal as Record<string, unknown>,
            );
        } else {
            result[key] = inVal;
        }
    }
    return result;
}

/**
 * Thrown by `registerSchema()` when:
 * (a) a schema for the same gameId is registered twice, or
 * (b) the schema's game-specific keys shadow an engine namespace key.
 */
export class SettingsNamespaceCollisionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SettingsNamespaceCollisionError';
    }
}

/** Optional broadcast callback type — avoids importing Electron in this module. */
export type BroadcastFn = (gameId: string, settings: ResolvedSettings) => void;

/**
 * Main-process settings orchestrator.
 *
 * Inject `InMemorySettingsRepository` in tests and `FileSettingsRepository`
 * in production.  Supply an optional `broadcastFn` to push changed settings
 * to renderer windows (wired in `electron/main/index.ts` via
 * `BrowserWindow.getAllWindows()...webContents.send(...)`).
 */
export class SettingsManager {
    private readonly schemas = new Map<string, GameSettingsSchema<EngineSettings>>();

    constructor(
        private readonly repo: SettingsRepository,
        private readonly broadcastFn?: BroadcastFn,
    ) {}

    /**
     * Register a game's settings schema.  Must be called during game startup
     * before `getSettings()` or `updateSettings()` is called for that game.
     *
     * Throws `SettingsNamespaceCollisionError` if:
     * - The same gameId was already registered.
     * - The schema's game-specific default keys shadow an engine namespace key.
     */
    registerSchema<T extends EngineSettings>(schema: GameSettingsSchema<T>): void {
        if (this.schemas.has(schema.gameId)) {
            throw new SettingsNamespaceCollisionError(
                `Settings schema for gameId ${JSON.stringify(schema.gameId)} is already registered.`,
            );
        }

        // Invariant #35: game-specific keys must not shadow engine namespace keys.
        const gameSpecificKeys = Object.keys(schema.defaults).filter(
            (k) => !ENGINE_NAMESPACE_KEYS.has(k),
        );
        const colliding = gameSpecificKeys.filter((k) => ENGINE_NAMESPACE_KEYS.has(k));
        if (colliding.length > 0) {
            throw new SettingsNamespaceCollisionError(
                `Game schema for ${JSON.stringify(schema.gameId)} shadows engine namespace key(s): ${colliding.join(', ')}`,
            );
        }

        this.schemas.set(schema.gameId, schema);
    }

    /**
     * Return fully-merged settings for the given game.
     * If no schema has been registered for the gameId, returns engine defaults
     * (graceful degradation — invariant #34).
     */
    async getSettings(gameId: string): Promise<ResolvedSettings> {
        const schema = this.schemas.get(gameId);
        const defaults = schema?.defaults ?? ENGINE_DEFAULTS;
        const userOverrides = await this.repo.load(gameId);
        return SettingsMerger.mergeAll(defaults, userOverrides);
    }

    /**
     * Validate, merge, persist, and broadcast updated settings.
     * Throws `SettingsValidationError` if the patch contains invalid values.
     *
     * Only the validated user overrides are persisted — never the full defaults
     * tree (BLOCK-1 fix). The return value of validatePatch is used so that
     * type-coerced, unknown-key-stripped values are what gets saved (WARN-2 fix).
     */
    async updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings> {
        const schema = this.schemas.get(gameId);
        // WARN-2 fix: use the return value (validated, stripped patch)
        const validatedPatch =
            schema !== undefined ? SettingsMerger.validatePatch(schema.zodSchema, patch) : patch;

        const currentOverrides = await this.repo.load(gameId);
        // BLOCK-1 fix: merge the validated patch into existing OVERRIDES only,
        // not into the full resolved defaults tree.
        const newOverrides = mergeUserOverrides(currentOverrides, validatedPatch) as UserSettings;
        await this.repo.save(gameId, newOverrides);

        const result = await this.getSettings(gameId);
        this.broadcastFn?.(gameId, result);
        return result;
    }

    /**
     * Delete user overrides and return the game's default settings.
     * Broadcasts the reset settings to all renderer windows.
     */
    async resetSettings(gameId: string): Promise<ResolvedSettings> {
        await this.repo.reset(gameId);
        const result = await this.getSettings(gameId);
        this.broadcastFn?.(gameId, result);
        return result;
    }
}
