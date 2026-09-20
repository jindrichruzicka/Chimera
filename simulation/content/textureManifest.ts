// simulation/content/textureManifest.ts
// §4.10 — Texture sampling authoring surface (sim side).
//
// The builder games call to declare a 'texture' manifest entry together with how
// its image is sampled. The declaration rides the existing
// AssetManifestEntry.metadata slot (typed `unknown`) as `metadata.sampling`; the
// sampling vocabulary and its reader are defined in
// ../foundation/texture-sampling. A 'sprite-sheet' entry declares the same
// options through `spriteAnimationEntry` (./animationManifest).
//
// AssetManifestEntry itself is unchanged (metadata?: unknown).
//
// Zero-dependency leaf edge: imports only within simulation/ — no renderer,
// DOM, React, Electron, or Three.js (Invariant #1).

import type { AssetManifestEntry, AssetPriority } from './AssetManifest.js';
import type { AssetRef, TextureAsset } from './AssetRef.js';
import { readTextureSampling } from '../foundation/texture-sampling.js';
import type {
    TextureColorSpace,
    TextureMagFilter,
    TextureMetadata,
    TextureMinFilter,
    TextureSampling,
    TextureWrapMode,
} from '../foundation/texture-sampling.js';

// Re-export the sampling vocabulary so a game authors a declaration and its
// manifest entry from a single content-layer import site.
export { InvalidTextureSamplingError } from '../foundation/texture-sampling.js';
export type {
    TextureColorSpace,
    TextureMagFilter,
    TextureMetadata,
    TextureMinFilter,
    TextureSampling,
    TextureWrapMode,
};

/**
 * Build a `'texture'` {@link AssetManifestEntry}, optionally declaring how the
 * image is sampled.
 *
 * The declaration is CHECKED here, so a misspelled option or a value outside the
 * vocabulary fails where it is authored rather than rendering wrong later — the
 * type catches a literal, and this catches what a spread or a cast carries past
 * it.
 *
 * @param args.ref       A typed reference to the texture.
 * @param args.priority  Load priority (`'critical'` preloads; `'deferred'` lazy-loads).
 * @param args.sampling  Optional sampling. Omit for a behaviour-neutral entry
 *                       identical to a hand-authored one (no `metadata` key).
 * @throws {InvalidTextureSamplingError} When `sampling` is not a valid declaration.
 */
export function textureEntry(args: {
    readonly ref: AssetRef<TextureAsset>;
    readonly priority: AssetPriority;
    readonly sampling?: TextureSampling;
}): AssetManifestEntry<TextureAsset> {
    if (args.sampling === undefined) {
        return { ref: args.ref, kind: 'texture', priority: args.priority };
    }
    const metadata: TextureMetadata = { sampling: args.sampling };
    readTextureSampling(metadata);
    return { ref: args.ref, kind: 'texture', priority: args.priority, metadata };
}
