/**
 * The ONE read of the active game's frame-rate cap.
 *
 * The cap is applied by two halves that must never disagree: the `frameloop`
 * prop `<Canvas>` is given (`useEngineFrameloop`) and the loop driver mounted
 * inside it (`FrameRateLimiter`). A canvas whose prop says `'never'` while its
 * driver stays idle renders nothing at all, so both import this selector rather
 * than each deriving the cap from the store.
 *
 * Renderer-only: reads the IPC-mirrored `settingsStore`, the same source
 * AudioBus reads volumes from. No simulation/ runtime, electron/ or ai/ import.
 */

import type { EngineSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import type { SettingsStoreState } from '../../state/settingsStore.js';

/** Fallback settings namespace when no game context is active (mirrors AudioBus). */
const ENGINE_SETTINGS_GAME_ID = '__engine__';

/** Read the active game's frame-rate cap; `0` (uncapped) when unavailable. */
export function selectTargetFps(state: SettingsStoreState): number {
    const active = state.activeGameId === null ? undefined : state.settings[state.activeGameId];
    // Cast so `.display` reads the declared EngineSettings key rather than
    // ResolvedSettings' index signature (ResolvedSettings is index-typed, so a
    // plain annotation is rejected — this mirrors AudioBus reading the store).
    const resolved = (active ?? state.settings[ENGINE_SETTINGS_GAME_ID]) as
        | EngineSettings
        | undefined;
    const targetFps = resolved?.display?.targetFps;
    return typeof targetFps === 'number' ? targetFps : 0;
}
