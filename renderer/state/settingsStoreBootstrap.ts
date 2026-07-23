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
 * Invariant #1: ResolvedSettings (not GameSnapshot) is what crosses IPC.
 */

import type { SettingsAPI, Unsubscribe } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSettingsStore } from './settingsStore';
import { emitRendererError } from '../logging/rendererLogger';

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
                // Invariant #67: forward the failure with its stack and a named
                // module. emitRendererError alone — no console.* — because no
                // developer is watching this bootstrap path and a console call
                // would double the entry (console.* is forwarded too).
                const logsApi = (
                    globalThis as Record<string, unknown> & {
                        __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                    }
                ).__chimera?.logs;
                emitRendererError(
                    logsApi,
                    '[settingsStoreBootstrap] Failed to replay engine settings',
                    error instanceof Error ? error : new Error(String(error)),
                    undefined,
                    'settings-store-bootstrap',
                );
            }
        });

    return () => {
        disposed = true;
        unsubscribe();
    };
}
