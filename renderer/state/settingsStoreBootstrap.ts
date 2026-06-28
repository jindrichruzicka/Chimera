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

import type { SettingsAPI, Unsubscribe } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSettingsStore } from './settingsStore';

const ENGINE_SETTINGS_GAME_ID = '__engine__';

/**
 * Register the `onChange` push listener on the supplied bridge and route
 * incoming `(gameId, settings)` events into the settingsStore via
 * `_applySettings`.
 *
 * Returns the unsubscribe function from the bridge so the caller can clean
 * up when the component unmounts or the bridge is replaced.
 */
export function bootstrapSettingsStore(api: SettingsAPI): Unsubscribe {
    let disposed = false;
    let engineSettingsEpoch = 0;
    const initialEngineSettingsEpoch = engineSettingsEpoch;

    const unsubscribe = api.onChange((gameId, settings) => {
        if (gameId === ENGINE_SETTINGS_GAME_ID) {
            engineSettingsEpoch += 1;
        }
        useSettingsStore.getState()._applySettings(gameId, settings);
    });

    api.get(ENGINE_SETTINGS_GAME_ID)
        .then((settings) => {
            if (!disposed && initialEngineSettingsEpoch === engineSettingsEpoch) {
                useSettingsStore.getState()._applySettings(ENGINE_SETTINGS_GAME_ID, settings);
            }
        })
        .catch((error: unknown) => {
            if (!disposed) {
                console.warn('[settingsStoreBootstrap] Failed to replay engine settings:', error);
            }
        });

    return () => {
        disposed = true;
        unsubscribe();
    };
}
