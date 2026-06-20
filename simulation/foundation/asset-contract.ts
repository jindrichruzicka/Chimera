// shared/asset-contract.ts
// §4.8 / §4.10 — Typed asset reference primitives (foundation layer).
//
// The phantom asset-kind brands, the open `AssetKindRegistry`, and the
// `AssetRef<T>` branded string live in `@chimera/simulation/foundation` — the zero-dependency
// foundation leaf — so the foundation can describe asset-carrying contracts
// (e.g. the game-screen `eventAudioBinding`) without importing *up* into
// `simulation` (Invariant #1). The runtime factories `buildAssetRef` /
// `parseAssetRef` and the `MalformedAssetRefError` re-export stay in
// `simulation/content/AssetRef.ts`, which re-exports every type here so
// `@chimera/simulation/content/AssetRef.js` remains the unchanged public
// import path.
//
// `AssetKindRegistry` is open through TypeScript declaration merging so games
// and extension packages can contribute custom asset kinds without editing
// engine core — augment THIS module (`./asset-contract.js`).
//
// This module is PURE TYPE DECLARATIONS only — zero runtime code, zero
// workspace imports. Relocated under issue #758.

/** Base phantom brand for built-in and game-contributed asset kinds. */
export interface AssetKindBrand<TKind extends string> {
    readonly __kind: TKind;
}

/** → THREE.Texture */
export type TextureAsset = AssetKindBrand<'texture'>;
/** → AudioBuffer (Web Audio API) */
export type AudioClipAsset = AssetKindBrand<'audio-clip'>;
/** → GLTF (drei or three/examples/jsm) */
export type GLTFModelAsset = AssetKindBrand<'gltf-model'>;
/** → THREE.Texture + SpriteAtlas frame map */
export type SpriteSheetAsset = AssetKindBrand<'sprite-sheet'>;
/** → plain JSON (no Three.js dependency at all) */
export type ParticleConfigAsset = AssetKindBrand<'particle-config'>;

/**
 * Open asset-kind registry. External packages extend this interface via
 * declaration merging, mapping a runtime kind string to its phantom brand.
 */
export interface AssetKindRegistry {
    readonly texture: TextureAsset;
    readonly 'audio-clip': AudioClipAsset;
    readonly 'gltf-model': GLTFModelAsset;
    readonly 'sprite-sheet': SpriteSheetAsset;
    readonly 'particle-config': ParticleConfigAsset;
}

/** Union of all recognised built-in and declaration-merged asset kinds. */
export type AssetKind = {
    [K in keyof AssetKindRegistry]: AssetKindRegistry[K];
}[keyof AssetKindRegistry];

/** Runtime kind id carried by an {@link AssetManifestEntry}. */
export type AssetKindId<TAssetKind extends AssetKind = AssetKind> = TAssetKind['__kind'];

/**
 * A branded string that represents a typed reference to a game asset.
 * Format: `"<game-id>/<relative-path-under-assets/>"`.
 *
 * The `_T` parameter is a phantom — it carries type information for callers
 * but has no runtime representation. Passing a raw `string` where an
 * `AssetRef<TextureAsset>` is required is a TypeScript compile error.
 *
 * The game-id prefix prevents cross-game ref collisions and makes paths
 * self-describing.
 */
export type AssetRef<T extends AssetKind = AssetKind> = string & {
    // Embedding T in the brand makes AssetRef<TextureAsset> and
    // AssetRef<AudioClipAsset> structurally incompatible (H1 hardening).
    readonly __assetRef: T;
};
