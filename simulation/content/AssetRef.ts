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

// The phantom asset-kind TYPES now live in the zero-dependency foundation leaf
// `@chimera/shared/asset-contract.js` (issue #758). They are imported for local
// use by the runtime factories below and re-exported so
// `@chimera/simulation/content/AssetRef.js` stays the unchanged public import path.
import type {
    AssetKindBrand,
    TextureAsset,
    AudioClipAsset,
    GLTFModelAsset,
    SpriteSheetAsset,
    ParticleConfigAsset,
    AssetKindRegistry,
    AssetKind,
    AssetKindId,
    AssetRef,
} from '@chimera/shared/asset-contract.js';

// ---------------------------------------------------------------------------
// Phantom asset-kind types — declared in `@chimera/shared/asset-contract.js`
// (foundation leaf, issue #758) and re-exported here so the public import path
// `@chimera/simulation/content/AssetRef.js` is unchanged. `AssetKindRegistry`
// stays open for declaration merging — augment the shared module.
// ---------------------------------------------------------------------------

export type {
    AssetKindBrand,
    TextureAsset,
    AudioClipAsset,
    GLTFModelAsset,
    SpriteSheetAsset,
    ParticleConfigAsset,
    AssetKindRegistry,
    AssetKind,
    AssetKindId,
    AssetRef,
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
