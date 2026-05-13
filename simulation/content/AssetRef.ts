// simulation/content/AssetRef.ts
// §4.8 / §4.10 — Typed asset reference primitives.
//
// parseAssetRef, MalformedAssetRefError, and isTraversalUnsafe live in
// shared/asset-ref-parse.ts so that renderer/assets/AssetResolver.ts can
// import them without violating the renderer→simulation runtime-value boundary.
// They are re-exported here for backwards compatibility.
//
// AssetRef<T> is a phantom-typed branded string of the form
// "<game-id>/<relative-path-under-assets/>".
// Examples:
//   "tactics/textures/units/warrior-portrait.webp"
//   "tactics/models/units/warrior.glb"
//   "tactics/audio/sfx/sword-hit.ogg"
//
// The simulation stores and passes these strings but NEVER resolves them.
// Only the renderer's AssetManager converts an AssetRef into a loaded asset.
//
// Invariants: #1 (no renderer / DOM / Three.js deps), #20 (simulation never
// resolves AssetRef values — they remain opaque strings to the engine).

import {
    isTraversalUnsafe,
    MalformedAssetRefError,
    parseAssetRef as parseAssetRefBase,
} from '@chimera/shared/asset-ref-parse.js';

export { MalformedAssetRefError } from '@chimera/shared/asset-ref-parse.js';

// ---------------------------------------------------------------------------
// Phantom asset-kind types — compile-time documentation only; no runtime
// representation. The renderer maps these to actual loader output types.
//
// Each kind carries a unique nominal `__kind` literal brand so that
// AssetRef<TextureAsset> and AssetRef<AudioClipAsset> are mutually
// incompatible types (H1 hardening).
// ---------------------------------------------------------------------------

/** → THREE.Texture */
export interface TextureAsset {
    readonly __kind: 'texture';
}
/** → AudioBuffer (Web Audio API) */
export interface AudioClipAsset {
    readonly __kind: 'audio-clip';
}
/** → GLTF (drei or three/examples/jsm) */
export interface GLTFModelAsset {
    readonly __kind: 'gltf-model';
}
/** → THREE.Texture + SpriteAtlas frame map */
export interface SpriteSheetAsset {
    readonly __kind: 'sprite-sheet';
}
/** → plain JSON (no Three.js dependency at all) */
export interface ParticleConfigAsset {
    readonly __kind: 'particle-config';
}

/** Union of all recognised asset kinds. */
export type AssetKind =
    | TextureAsset
    | AudioClipAsset
    | GLTFModelAsset
    | SpriteSheetAsset
    | ParticleConfigAsset;

// ---------------------------------------------------------------------------
// AssetRef<T> — branded phantom type
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildAssetRef — safe factory
// ---------------------------------------------------------------------------

/**
 * Construct an `AssetRef<T>` from its constituent parts.
 *
 * @param gameId        The game identifier, e.g. `"tactics"`.
 * @param relativePath  The path relative to the game's `assets/` directory,
 *                      e.g. `"textures/units/warrior-portrait.webp"`.
 */
export function buildAssetRef<T extends AssetKind>(
    gameId: string,
    relativePath: string,
): AssetRef<T> {
    const ref = `${gameId}/${relativePath}`;
    if (isTraversalUnsafe(gameId, relativePath)) {
        throw new MalformedAssetRefError(ref);
    }
    return ref as AssetRef<T>;
}

// ---------------------------------------------------------------------------
// parseAssetRef — typed wrapper around the shared utility
// ---------------------------------------------------------------------------

/**
 * Decompose an `AssetRef` into its `gameId` and `relativePath` parts.
 *
 * Delegates to the shared `parseAssetRef` in `shared/asset-ref-parse.ts`;
 * this typed overload narrows the parameter to `AssetRef` for simulation-layer
 * callers without duplicating validation logic.
 *
 * @throws {MalformedAssetRefError} When the ref does not contain a `/`, when
 *   the slash is at position 0 (empty game id), or when the ref contains
 *   path-traversal components.
 */
export function parseAssetRef(ref: AssetRef): {
    readonly gameId: string;
    readonly relativePath: string;
} {
    return parseAssetRefBase(ref);
}

// AssetManifest types (AssetPriority, AssetManifestEntry, AssetManifest) have been
// extracted to ./AssetManifest.ts — see §4.10.
