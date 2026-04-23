/**
 * renderer/state/settingsStoreBootstrap.ts
 *
 * Side-effect-free bootstrap function that wires the chimera:settings:change
 * push channel into the settingsStore singleton.
 *
 * Usage (from a 'use client' component's useEffect):
 *
 *   const stop = bootstrapSettingsStore(window.__chimera.settings);
 *   return stop; // cleanup on unmount
 *
 * Architecture reference: §F07 hardening #157 (BLOCK-2, WARN-4)
 *
 * Invariant #1: ResolvedSettings (not GameSnapshot) is what crosses IPC.
 */

import type { SettingsAPI, Unsubscribe } from '../../electron/preload/api-types';
import { useSettingsStore } from './settingsStore';

/**
 * Register the `onChange` push listener on the supplied bridge and route
 * incoming `(gameId, settings)` events into the settingsStore via
 * `_applySettings`.
 *
 * Returns the unsubscribe function from the bridge so the caller can clean
 * up when the component unmounts or the bridge is replaced.
 */
export function bootstrapSettingsStore(api: SettingsAPI): Unsubscribe {
    return api.onChange((gameId, settings) => {
        useSettingsStore.getState()._applySettings(gameId, settings);
    });
}
