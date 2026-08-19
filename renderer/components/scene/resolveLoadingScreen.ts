// renderer/components/scene/resolveLoadingScreen.ts
//
// Registry resolution for the loading cover (§4.36) — the read side of the
// `loadingScreen` / `loadingScreens` slot pair. Kept beside `resolveScreen`
// (SceneRouter.tsx) and shaped identically: a presence-based cascade, no
// booleans, no defaults invented here.

import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
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

/** The scene and screen key a route cover stands in for — the route's own cascade. */
export interface RouteCoverTarget {
    readonly sceneId: string;
    readonly screenKey: string;
}

/**
 * The screen key a ROUTE owns, which is not the one `useActiveScreen()` reports.
 *
 * `snapshot.sceneDefaultScreen ?? registry.sceneDefaultScreens[sceneId] ??
 * 'playfield'` — the same cascade `SceneRouter` commits. `uiStore` is a module
 * singleton the routes never reset and `setActiveSceneId` early-returns on an
 * unchanged `sceneId`, so a second match in one process would otherwise resolve
 * the PREVIOUS match's screen while its own scene is still loading.
 */
export function resolveRouteCoverTarget(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
): RouteCoverTarget {
    const sceneId = String(snapshot.sceneId ?? 'engine:game');
    const screenKey =
        snapshot.sceneDefaultScreen ?? registry.sceneDefaultScreens?.[sceneId] ?? 'playfield';
    return { sceneId, screenKey };
}

/**
 * Whether a route's cover resolves a GAME-DECLARED form (§4.36): anything the
 * cascade yields except `undefined` (the engine's empty placeholder) and the
 * `'none'` opt-out.
 *
 * This is what arms the loading beat's cover leg. An empty placeholder held on
 * screen is a wait with no explanation, so a game that declared nothing gets
 * the sequence without a cover in it.
 */
export function isRouteCoverGameDeclared(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
): boolean {
    const { screenKey } = resolveRouteCoverTarget(registry, snapshot);
    const cover = resolveLoadingScreen(registry, screenKey);
    return cover !== undefined && cover !== 'none';
}
