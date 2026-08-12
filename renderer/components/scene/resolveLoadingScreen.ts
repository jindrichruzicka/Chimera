// renderer/components/scene/resolveLoadingScreen.ts
//
// Registry resolution for the loading cover (§4.36) — the read side of the
// `loadingScreen` / `loadingScreens` slot pair. Kept beside `resolveScreen`
// (SceneRouter.tsx) and shaped identically: a presence-based cascade, no
// booleans, no defaults invented here.

import type {
    GameLoadingScreen,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';

/**
 * Resolve the loading cover for one screen key through the three-level cascade
 * the registry declares: the per-key entry, then the registry-wide slot, then
 * absent.
 *
 * `??` on the map lookup rather than a truthiness or sentinel filter is what
 * makes the `'none'` opt-out SUBTRACT a single key from a registry-wide cover:
 * the sentinel is a resolved value, so it stops the cascade instead of falling
 * through to {@link GameScreenRegistry.loadingScreen}.
 *
 * Returns the declared value in whatever form the union admits — including
 * `'none'`. Callers own the narrowing (see `SceneLoadingFallback`), so this
 * resolver never renders and never decides what "no cover" looks like.
 */
export function resolveLoadingScreen(
    registry: GameScreenRegistry,
    screenKey: string,
): GameLoadingScreen | undefined {
    return registry.loadingScreens?.[screenKey] ?? registry.loadingScreen;
}
