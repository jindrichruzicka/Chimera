/**
 * renderer/state/settingsStore.ts
 *
 * Zustand store for per-game resolved settings.
 *
 * Architecture reference: §F07/T6 (issue #152), §renderer/state/settingsStore.ts
 *
 * Rules:
 *  - Components subscribe through narrow typed selectors only (renderer.instructions.md)
 *  - _applySettings() is called by IPC listeners; do NOT call from components
 *  - updateSettings / resetSettings delegate through the injected chimera bridge
 *    (defaults to window.__chimera in the browser; overridable in tests)
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { ResolvedSettings, UserSettings, SettingsAPI } from '../../electron/preload/api-types';

// ── Store shape ───────────────────────────────────────────────────────────────

export interface SettingsStoreState {
    /** Current fully-resolved settings per gameId. Populated by IPC on app mount or game load. */
    readonly settings: Record<string, ResolvedSettings>;
    readonly activeGameId: string | null;

    /**
     * Apply incoming settings from IPC (chimera:settings:changed push or initial fetch).
     * Do NOT call from components directly.
     */
    _applySettings(gameId: string, settings: ResolvedSettings): void;

    /** Dispatch update to main process; applies returned merged settings to store. */
    updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<void>;

    /** Reset user overrides in main process; applies returned defaults to store. */
    resetSettings(gameId: string): Promise<void>;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance.  Pass a `bridge` in tests to avoid
 * relying on `window.__chimera`.  In production, the bridge is resolved
 * lazily from `window.__chimera` at call time so the store can be created
 * before the preload is ready.
 */
export function createSettingsStore(bridge?: {
    readonly settings: SettingsAPI;
}): StoreApi<SettingsStoreState> {
    return createStore<SettingsStoreState>()((set) => ({
        settings: {},
        activeGameId: null,

        _applySettings(gameId: string, incoming: ResolvedSettings): void {
            set((state) => ({
                settings: { ...state.settings, [gameId]: incoming },
            }));
        },

        async updateSettings(gameId: string, patch: Partial<UserSettings>): Promise<void> {
            const api =
                bridge ?? (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera;
            if (api === undefined) {
                throw new Error(
                    '[settingsStore] preload bridge unavailable — window.__chimera is not set',
                );
            }
            const result = await api.settings.update(gameId, patch);
            set((state) => ({
                settings: { ...state.settings, [gameId]: result },
            }));
        },

        async resetSettings(gameId: string): Promise<void> {
            const api =
                bridge ?? (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera;
            if (api === undefined) {
                throw new Error(
                    '[settingsStore] preload bridge unavailable — window.__chimera is not set',
                );
            }
            const result = await api.settings.reset(gameId);
            set((state) => ({
                settings: { ...state.settings, [gameId]: result },
            }));
        },
    }));
}

// ── Singleton store ───────────────────────────────────────────────────────────

const settingsStoreInstance = createSettingsStore();

/**
 * Zustand hook for the settings store.
 *
 * Always subscribe via a narrow selector:
 *
 * ```typescript
 * // ✅ Narrow selector
 * const masterVolume = useSettingsStore(
 *   s => (s.settings['tactics'] as EngineSettings | undefined)?.audio.masterVolume ?? 1.0
 * );
 * ```
 */
export function useSettingsStore<T>(selector: (state: SettingsStoreState) => T): T {
    return useStore(settingsStoreInstance, selector);
}

// Expose static accessors for direct store access (IPC wiring, tests)
useSettingsStore.getState = settingsStoreInstance.getState.bind(settingsStoreInstance);
useSettingsStore.setState = settingsStoreInstance.setState.bind(settingsStoreInstance);
useSettingsStore.subscribe = settingsStoreInstance.subscribe.bind(settingsStoreInstance);
