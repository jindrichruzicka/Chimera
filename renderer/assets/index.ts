/**
 * renderer/assets/index.ts
 *
 * Public asset barrel (`@chimera-engine/renderer/assets`).
 *
 * The reachability half of the model seam (§4.10). The clone and mixer verbs
 * landed on the asset layer, but a game surface may name only a public barrel
 * (Invariant #96), and there was none for assets — no game could obtain ANY
 * loaded asset at all. This barrel is that subpath.
 *
 * What it exports is the consuming surface and nothing else: the hooks a game
 * calls (`useAsset` to resolve a declared ref, `useModelInstance` for a
 * per-component clone of a gltf scene, `useAnimationSheet` for the animation
 * clip sheet authored onto a model's manifest entry, `useAssetManager` for the
 * manager itself — Invariant #84 makes the context hook the only sanctioned way
 * to reach it), the provider those hooks read from, and the state, asset and
 * error types the calls take. `AssetManagerProvider` is here because a hook a
 * game may call is only half of what the game needs: its component tests have
 * to mount something that satisfies the hook, and without a provider the game
 * would be forced back onto the internal context object. The app root mounts
 * the one live provider; a game mounts its own only over a double.
 *
 * A game may CONSUME a manager, never build one: `createAssetManager`,
 * `DefaultAssetManager`, `AssetResolver`, `AssetPreloader`,
 * `DelegatingAssetManager` and the context object stay internal, by rule
 * rather than by list — what is not re-exported below is not reachable.
 * Which surface disposes which manager is enumerated in Invariant #21 and
 * not restated here.
 *
 * The sprite half of the sheet seam ships from here too, now that there is
 * something to draw with (`AnimatedSprite`, `useSpriteClipPlayer`):
 * `useSpriteAtlas` measures a loaded sheet's cells, `useSpriteAnimationSheet`
 * reads its clip sheet, and `parseSpriteAtlas` is the non-React reader under the
 * first. `SpriteAtlas`/`SpriteAtlasFrame` are named because `useSpriteAtlas`
 * returns them and a game factoring that value out has to annotate it.
 *
 * Re-export only: importing this barrel mounts nothing, loads nothing, and —
 * unlike `audio` — constructs no store.
 * `__tests__/assets-barrel-side-effects.test.ts` pins the exact module graph
 * and the exported symbol set.
 */

export { useAsset, type UseAssetState } from './useAsset.js';
export { useAssetManager } from './AssetManagerContext.js';
export { AssetManagerProvider, type AssetManagerProviderProps } from './AssetManagerProvider.js';
export { useModelInstance, type UseModelInstanceState } from './useModelInstance.js';
export { useAnimationSheet, useSpriteAnimationSheet } from './useAnimationSheet.js';
export type { ParsedModelAnimationSheet, ParsedSpriteAnimationSheet } from './animationSheet.js';
export { useSpriteAtlas, type UseSpriteAtlasState } from './useSpriteAtlas.js';
export { parseSpriteAtlas, type SpriteAtlas, type SpriteAtlasFrame } from './spriteAtlas.js';
export { MalformedModelAssetError, type ModelInstance } from './ModelInstance.js';
export {
    UnknownAssetManifestEntryError,
    type AssetManager,
    type LoadedGltfAsset,
    type LoadedSpriteSheetAsset,
    type ResolvedAsset,
} from './AssetManager.js';
export { NoActiveGameSessionError } from './DelegatingAssetManager.js';
