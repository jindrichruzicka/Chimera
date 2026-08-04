'use client';

/**
 * Turns the active game's `settings.display.targetFps` into the `frameloop` a
 * `<Canvas>` must be given. The engine `<GameCanvas>` applies it itself; a game
 * that owns its `<Canvas>` writes `<Canvas frameloop={useEngineFrameloop()}>`
 * and mounts `<FrameRateLimiter />` inside it — see `selectTargetFps.ts` for
 * why both halves are one contract.
 *
 * It must be the PROP, never an internal `setFrameloop` call: R3F's `CanvasImpl`
 * runs `configure()` from a layout effect with NO dependency array, so every
 * Canvas render re-applies the prop and clobbers any internally-set value.
 * Mount ordering is safe — `configure()` is awaited before the children render,
 * so a child effect calling `advance` already sees the final frameloop.
 *
 * `targetFps: 0` stays on `'always'` so the uncapped path is byte-for-byte the
 * R3F default. Under `'never'`, `invalidate()` early-returns, so demand
 * rendering is off for the whole capped branch — which is fine only because the
 * driver advances continuously.
 *
 * Canvas-FREE by contract: this is called OUTSIDE the `<Canvas>` whose prop it
 * computes, so it reads `settingsStore` and must reach no R3F hook.
 */

import { useSettingsStore } from '../../state/settingsStore.js';
import { selectTargetFps } from './selectTargetFps.js';

/** The `frameloop` values the engine cap produces. */
export type EngineFrameloop = 'always' | 'never';

function selectFrameloop(state: Parameters<typeof selectTargetFps>[0]): EngineFrameloop {
    return selectTargetFps(state) > 0 ? 'never' : 'always';
}

/** `'never'` while a frame-rate cap is active, `'always'` when uncapped. */
export function useEngineFrameloop(): EngineFrameloop {
    return useSettingsStore(selectFrameloop);
}
