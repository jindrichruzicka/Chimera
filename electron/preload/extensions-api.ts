// electron/preload/extensions-api.ts
//
// Extension registration infrastructure for the Chimera preload layer.
//
// Game packages and external integrations call `registerExtension()` to add
// typed namespaces to `window.__chimera.extensions`. All registrations MUST
// happen before `api.ts` calls `contextBridge.exposeInMainWorld`, because the
// contextBridge call is a one-shot operation that freezes the exposed surface.
//
// Type-level extensibility is achieved through TypeScript declaration merging:
// external packages augment the `ChimeraExtensions` interface (declared in
// `api-types.ts`) to add their namespace types. Runtime registration is
// separate — the factory passed to `registerExtension()` provides the
// implementation object.
//
// Invariant: `ChimeraExtensions` is empty in @chimera/core 1.0.0.
// No extensions are registered here — this file is the infrastructure only.

import type { ChimeraExtensions } from './api-types.js';

/**
 * Module-level registry. Populated by `registerExtension()` calls before
 * the preload entry point (`api.ts`) invokes `contextBridge.exposeInMainWorld`.
 * Using a plain `Record` (not a `Map`) so `buildExtensionsApi()` can freeze
 * and return it directly without an extra copy.
 */
const registry: Partial<Record<keyof ChimeraExtensions, unknown>> = {};

/**
 * Register a named extension namespace for inclusion in
 * `window.__chimera.extensions`.
 *
 * @param name    - The key that will appear on `window.__chimera.extensions`.
 *                  Must match a key declared in `ChimeraExtensions` (enforced
 *                  at the TypeScript level via the `keyof` constraint).
 * @param factory - Called exactly once during registration; the returned object
 *                  becomes `window.__chimera.extensions[name]`. The factory
 *                  receives no arguments — all IPC dependencies should be
 *                  captured in the factory's closure.
 *
 * @throws {Error} If `name` has already been registered. Duplicate registration
 *                 indicates a programming error (e.g. a preload entry imported
 *                 twice) and is always fatal.
 *
 * @example
 * ```ts
 * // In your game's preload entry, before importing api.ts:
 * import { registerExtension } from '@chimera/core/electron/preload/extensions-api.js';
 * import { createTacticsApi } from './tactics-api.js';
 *
 * registerExtension('tactics', () => createTacticsApi(ipcRenderer));
 * ```
 */
export function registerExtension<TKey extends keyof ChimeraExtensions>(
    name: TKey,
    factory: () => ChimeraExtensions[TKey],
): void {
    if (Object.prototype.hasOwnProperty.call(registry, name)) {
        throw new Error(
            `Chimera extension already registered: "${String(name)}". ` +
                `Each extension name may only be registered once per preload session.`,
        );
    }
    registry[name] = factory();
}

/**
 * Build the frozen `ChimeraExtensions` object from all registered extensions.
 *
 * Called once by `api.ts` when composing the `ChimeraAPI` object that is
 * passed to `contextBridge.exposeInMainWorld`. The returned object is frozen
 * so that renderer-side code cannot mutate the extension surface.
 *
 * @returns A frozen `ChimeraExtensions` record — empty when no extensions have
 *          been registered (the 1.0.0 default for core).
 */
export function buildExtensionsApi(): ChimeraExtensions {
    // `ChimeraExtensions` is an empty interface — any non-null object satisfies it.
    // External packages that augment it must pair each declaration with a matching
    // `registerExtension()` call; the runtime registry is the source of truth.
    return Object.freeze({ ...registry });
}
