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
 * R3F default.
 *
 * NEITHER value honours a demand-render request, which is why `invalidate()` is
 * inert everywhere in the engine. The two halves of that (measured against
 * `@react-three/fiber@9.6.1`) are easy to state only half of:
 *  - Under `'never'`, `invalidate` early-returns outright. Harmless, because the
 *    loop driver advances continuously instead.
 *  - Under `'always'`, it returns normally but changes nothing observable: R3F
 *    renders an active root whenever `frameloop === 'always' || internal.frames
 *    > 0` and never consults the counter `invalidate` writes, and the rAF chain
 *    it would otherwise restart is already running.
 * Demand rendering therefore reaches a canvas only when a game sets
 * `frameloop="demand"` on its own `<Canvas>`, which this hook never returns.
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
