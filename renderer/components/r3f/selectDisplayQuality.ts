/**
 * The ONE read of the active game's display-quality settings.
 *
 * `selectTargetFps.ts` is the sibling this follows, and its header is where
 * the cast below and the `__engine__` fallback are explained; both are repeated
 * here rather than shared, because a module the two could live in would be a
 * third place to look for the same two lines.
 *
 * Renderer-only: reads the IPC-mirrored `settingsStore`, the same source
 * AudioBus reads volumes from. No simulation/ runtime, electron/ or ai/ import.
 *
 * These are the SETTING values, in the settings vocabulary. Turning a tier into
 * a shadow-map name, or a fraction into a device-pixel ratio, is
 * `rendererConfig.ts`'s job and happens against the game's authored ceiling.
 */

import type { EngineSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import type { SettingsStoreState } from '../../state/settingsStore.js';
import type { ShadowQualityTier } from './rendererConfig.js';

/** Fallback settings namespace when no game context is active (mirrors AudioBus). */
const ENGINE_SETTINGS_GAME_ID = '__engine__';

/** Applied when the store carries no resolved value — the engine defaults. */
const DEFAULT_SHADOW_QUALITY: ShadowQualityTier = 'off';
const DEFAULT_RENDER_SCALE_FRACTION = 1;

/**
 * The active game's resolved `display` namespace, or `undefined`.
 *
 * Cast so `.display` reads the declared EngineSettings key rather than
 * ResolvedSettings' index signature (ResolvedSettings is index-typed, so a
 * plain annotation is rejected — this mirrors AudioBus reading the store).
 */
function selectDisplay(state: SettingsStoreState): EngineSettings['display'] | undefined {
    const active = state.activeGameId === null ? undefined : state.settings[state.activeGameId];
    const resolved = (active ?? state.settings[ENGINE_SETTINGS_GAME_ID]) as
        | EngineSettings
        | undefined;

    return resolved?.display;
}

/** The player's shadow-quality tier; the engine default when unavailable. */
export function selectShadowQualityTier(state: SettingsStoreState): ShadowQualityTier {
    return selectDisplay(state)?.shadowQuality ?? DEFAULT_SHADOW_QUALITY;
}

/** The player's render-scale fraction; the engine default when unavailable. */
export function selectRenderScaleFraction(state: SettingsStoreState): number {
    const fraction = selectDisplay(state)?.renderScale;

    return typeof fraction === 'number' ? fraction : DEFAULT_RENDER_SCALE_FRACTION;
}
