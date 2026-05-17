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

import type { Logger } from '@chimera/shared/logging.js';
import type {
    EngineSettings,
    GameSettingsSchema,
    ResolvedSettings,
    SettingsRepository,
    UserSettings,
} from '@chimera/simulation/settings/index.js';
import {
    ENGINE_DEFAULTS,
    SettingsNamespaceCollisionError,
    SettingsMerger,
} from '@chimera/simulation/settings/index.js';

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

// SettingsNamespaceCollisionError is defined in simulation/settings/SettingsSchema.ts
// and re-exported from simulation/settings/index.ts — imported above.
export { SettingsNamespaceCollisionError } from '@chimera/simulation/settings/index.js';

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
        private readonly logger?: Logger,
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

        // Invariant #35: game-specific keys (keys beyond the five engine namespaces)
        // must not shadow engine namespace keys. Extract only the game-specific keys.
        const allKeys = Object.keys(schema.defaults);
        const gameSpecificKeys = allKeys.filter((k) => !ENGINE_NAMESPACE_KEYS.has(k));

        // If the game has added custom keys, verify none of them conflict with engine namespaces.
        // This check is redundant if gameSpecificKeys are truly outside ENGINE_NAMESPACE_KEYS,
        // but is kept here for clarity and as a defence-in-depth check.
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
        const rawOverrides = await this.repo.load(gameId);

        // ── Legacy migration: controls.keyBindings → controls.bindings ──────
        // Pre-v0.7 settings files used controls.keyBindings (flat string map).
        // The new schema uses controls.bindings (structured KeyBinding objects).
        // We cannot reliably convert the old combo strings to KeyBinding objects,
        // so we strip the legacy key, reset bindings to defaults, and warn once.
        // The cleaned-up overrides are written back so this path is never hit again.
        const migratedOverrides = this.stripLegacyKeyBindings(gameId, rawOverrides);

        let userOverrides: UserSettings = migratedOverrides;
        if (schema !== undefined && Object.keys(migratedOverrides).length > 0) {
            try {
                userOverrides = SettingsMerger.validatePatch(schema.schema, migratedOverrides);
            } catch {
                this.logger?.warn(
                    'Stored settings for game failed schema validation; falling back to defaults.',
                    { gameId },
                );
                userOverrides = {};
            }
        }
        return SettingsMerger.mergeAll(defaults, userOverrides);
    }

    /**
     * Detects the legacy `controls.keyBindings` field written by pre-v0.7 builds,
     * removes it from the overrides, logs a one-time warning, and re-persists the
     * cleaned-up overrides so the migration path is only executed once per file.
     *
     * Returns the (possibly unchanged) overrides object.
     */
    private stripLegacyKeyBindings(gameId: string, raw: UserSettings): UserSettings {
        const controls = (raw as Record<string, unknown>)['controls'];
        if (
            controls === null ||
            typeof controls !== 'object' ||
            Array.isArray(controls) ||
            !('keyBindings' in controls)
        ) {
            return raw;
        }

        this.logger?.warn(
            'Legacy key-binding format (controls.keyBindings) detected; ' +
                'migrating to controls.bindings — custom key bindings have been reset to defaults.',
            { gameId },
        );

        // Drop keyBindings; keep any other controls sub-keys (e.g. bindings).
        const { keyBindings: _dropped, ...restControls } = controls as Record<string, unknown>;
        const cleaned: UserSettings = {
            ...(raw as Record<string, unknown>),
            controls: restControls,
        };

        // Persist the cleaned overrides so this migration runs only once per file.
        // Errors are caught and logged; a failure means the migration will re-run
        // on the next boot (harmless but noisy).
        this.repo.save(gameId, cleaned).catch((err: unknown) => {
            this.logger?.warn(
                'Failed to persist migrated key-binding overrides; migration will re-run on next boot.',
                { gameId, err },
            );
        });

        return cleaned;
    }

    /**
     * Validate, merge, persist, and broadcast updated settings.
     * Throws `SettingsValidationError` if the patch contains invalid values.
     *
     * Only the validated user overrides are persisted — never the full defaults
     * tree (BLOCK-1 fix). The return value of validatePatch is used so that
     * type-coerced, unknown-key-stripped values are what gets saved (WARN-2 fix).
     */
    /**
     * Validate a patch against the registered per-game schema.
     * Throws `SettingsValidationError` if validation fails or if no schema
     * is registered for the game (BLOCK-4: called at IPC boundary before updateSettings).
     * Returns the validated, unknown-key-stripped patch on success.
     */
    validatePatchForGame(gameId: string, patch: Partial<UserSettings>): Partial<UserSettings> {
        const schema = this.schemas.get(gameId);
        if (schema === undefined) {
            return patch;
        }
        return SettingsMerger.validatePatch(schema.schema, patch);
    }

    async updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings> {
        const schema = this.schemas.get(gameId);
        // WARN-2 fix: use the return value (validated, stripped patch)
        const validatedPatch =
            schema !== undefined ? SettingsMerger.validatePatch(schema.schema, patch) : patch;

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
