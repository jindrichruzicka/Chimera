import type { z } from 'zod';
import type { EngineSettings, ResolvedSettings, UserSettings } from './SettingsSchema';

// ─── SettingsValidationError ─────────────────────────────────────────────────

export class SettingsValidationError extends Error {
    public override readonly name = 'SettingsValidationError';

    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, SettingsValidationError.prototype);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deep-merges `overrides` into `base`, stripping any keys from `overrides`
 * that are not present in `base`. Primitive values in `overrides` win.
 */
function deepMergeStripped(
    base: Record<string, unknown>,
    overrides: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(base)) {
        if (!(key in overrides)) continue;
        const bVal = base[key];
        const oVal = overrides[key];
        if (
            bVal !== null &&
            typeof bVal === 'object' &&
            !Array.isArray(bVal) &&
            oVal !== null &&
            typeof oVal === 'object' &&
            !Array.isArray(oVal)
        ) {
            result[key] = deepMergeStripped(
                bVal as Record<string, unknown>,
                oVal as Record<string, unknown>,
            );
        } else {
            result[key] = oVal;
        }
    }
    return result;
}

// ─── Deep partial validation ─────────────────────────────────────────────────

/**
 * Recursively validates only the keys present in `patch` against the Zod schema
 * shape. Unknown keys (not in `shape`) are stripped. Type mismatches throw
 * SettingsValidationError.
 */
function deepValidatePatch(
    shape: Record<string, z.ZodTypeAny>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (!(key in shape)) continue; // strip unknown
        const fieldSchema = shape[key]!;
        // Recurse into nested ZodObject shapes
        const innerShape = (fieldSchema as unknown as z.ZodObject<z.ZodRawShape>).shape;
        if (
            typeof innerShape === 'object' &&
            innerShape !== null &&
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            out[key] = deepValidatePatch(
                innerShape as Record<string, z.ZodTypeAny>,
                value as Record<string, unknown>,
            );
        } else {
            const result = fieldSchema.safeParse(value);
            if (!result.success) {
                throw new SettingsValidationError(result.error.message);
            }
            out[key] = result.data;
        }
    }
    return out;
}

// ─── SettingsMerger ───────────────────────────────────────────────────────────

export class SettingsMerger {
    /**
     * Produces a ResolvedSettings by merging two layers:
     *   1. gameDefaults  — from GameSettingsSchema.defaults (includes ENGINE_DEFAULTS baked in)
     *   2. userOverrides — loaded from disk; only explicitly saved keys are present
     *
     * Deep merge: nested objects are merged recursively; primitives in later layers win.
     * Unknown keys from userOverrides absent from gameDefaults are stripped.
     */
    static mergeAll(gameDefaults: ResolvedSettings, userOverrides: UserSettings): ResolvedSettings {
        return deepMergeStripped(gameDefaults, userOverrides ?? {}) as ResolvedSettings;
    }

    /**
     * Validates a proposed patch against the Zod schema; returns the patch with
     * unknown keys stripped and values coerced to their declared types.
     * Throws SettingsValidationError on type mismatch.
     *
     * Only the keys present in `patch` are validated — missing keys are not
     * required to be present (deep-partial semantics).
     */
    static validatePatch<T extends EngineSettings>(
        schema: z.ZodType<T>,
        patch: Partial<UserSettings>,
    ): Partial<UserSettings> {
        const zodObj = schema as unknown as z.ZodObject<z.ZodRawShape>;
        const shape = zodObj.shape;
        if (typeof shape !== 'object' || shape === null) {
            // Not a ZodObject — attempt full parse as fallback
            const result = (schema as z.ZodType<unknown>).safeParse(patch);
            if (!result.success) {
                throw new SettingsValidationError(result.error.message);
            }
            return result.data as Partial<UserSettings>;
        }
        return deepValidatePatch(shape as Record<string, z.ZodTypeAny>, patch ?? {});
    }
}
