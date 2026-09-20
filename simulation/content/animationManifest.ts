// simulation/content/animationManifest.ts
// Animation System → clip-sheet authoring surface (sim side). Feature F82,
// docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
//
// The write-only authoring builders games call to attach a clip sheet to a
// 'gltf-model' or 'sprite-sheet' manifest entry. They only WRITE the sheet into
// the existing AssetManifestEntry.metadata slot (typed `unknown`). The sheet
// vocabulary is defined sim-side
// (../foundation/animation-clip-sheet) and flows sim → renderer — the sole
// playback parser/resolver is the renderer, never the reverse.
//
// A 'sprite-sheet' entry may also declare how its image is sampled (§4.10). That
// declaration is a sibling of the sheet under `metadata.sampling`, and unlike the
// sheet it IS checked here — see ../foundation/texture-sampling.
//
// AssetManifestEntry itself is unchanged (metadata?: unknown).
//
// Zero-dependency leaf edge: imports only within simulation/ — no renderer,
// DOM, React, Electron, or Three.js (Invariant #1).

import type { AssetManifestEntry, AssetPriority } from './AssetManifest.js';
import type { AssetRef, GLTFModelAsset, SpriteSheetAsset } from './AssetRef.js';
import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
    AnimationNotify,
    AnimationPassage,
    AnimationTrackSheet,
    AnimationWindowName,
    ClipPosition,
    ModelAnimationMetadata,
    SpriteAnimationMetadata,
    SpriteClipDeclaration,
} from '../foundation/animation-clip-sheet.js';
import { readTextureSampling, type TextureSampling } from '../foundation/texture-sampling.js';

// Re-export the sim-side clip vocabulary so a game authors a clip sheet and its
// manifest entry from a single content-layer import site.
export type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
    AnimationNotify,
    AnimationPassage,
    AnimationTrackSheet,
    AnimationWindowName,
    ClipPosition,
    ModelAnimationMetadata,
    SpriteAnimationMetadata,
    SpriteClipDeclaration,
};

/**
 * Build a `'gltf-model'` {@link AssetManifestEntry}, optionally carrying a clip
 * sheet in the opaque `metadata` slot.
 *
 * Write-only: the returned `metadata` is the passed {@link ModelAnimationMetadata}
 * VERBATIM — the same object, by reference — and is never inspected here. The
 * sole playback reader is the renderer. `AssetManifestEntry`
 * stays `metadata?: unknown`; this builder just fills the slot with a typed
 * value at the call site.
 *
 * @param args.ref       A typed reference to the glTF model.
 * @param args.priority  Load priority (`'critical'` preloads; `'deferred'` lazy-loads).
 * @param args.metadata  Optional clip sheet. Omit for a behaviour-neutral entry
 *                       identical to a hand-authored one (no `metadata` key).
 */
export function modelAnimationEntry(args: {
    readonly ref: AssetRef<GLTFModelAsset>;
    readonly priority: AssetPriority;
    readonly metadata?: ModelAnimationMetadata;
}): AssetManifestEntry<GLTFModelAsset> {
    if (args.metadata === undefined) {
        // No sheet → omit the key entirely (exactOptionalPropertyTypes), so the
        // entry deep-equals a manifest authored without this builder.
        return { ref: args.ref, kind: 'gltf-model', priority: args.priority };
    }
    return {
        ref: args.ref,
        kind: 'gltf-model',
        priority: args.priority,
        metadata: args.metadata, // verbatim; never inspected sim-side
    };
}

/**
 * Build a `'sprite-sheet'` {@link AssetManifestEntry}, optionally carrying a clip
 * sheet in the opaque `metadata` slot. The twin of {@link modelAnimationEntry}
 * for sprite content, plus the sheet image's sampling.
 *
 * Without `sampling` the sheet is carried verbatim, by reference. With it, the
 * entry's metadata is a new object holding the sheet's keys and `sampling`
 * beside them; the passed sheet is never written to.
 *
 * @param args.ref       A typed reference to the sprite sheet.
 * @param args.priority  Load priority (`'critical'` preloads; `'deferred'` lazy-loads).
 * @param args.metadata  Optional clip sheet. Omit it and `sampling` for a
 *                       behaviour-neutral entry identical to a hand-authored one
 *                       (no `metadata` key).
 * @param args.sampling  Optional sampling of the sheet image, checked here.
 * @throws {InvalidTextureSamplingError} When `sampling` is not a valid declaration.
 */
export function spriteAnimationEntry(args: {
    readonly ref: AssetRef<SpriteSheetAsset>;
    readonly priority: AssetPriority;
    readonly metadata?: SpriteAnimationMetadata;
    readonly sampling?: TextureSampling;
}): AssetManifestEntry<SpriteSheetAsset> {
    if (args.sampling !== undefined) {
        const metadata = { ...args.metadata, sampling: args.sampling };
        readTextureSampling(metadata);
        return { ref: args.ref, kind: 'sprite-sheet', priority: args.priority, metadata };
    }
    if (args.metadata === undefined) {
        return { ref: args.ref, kind: 'sprite-sheet', priority: args.priority };
    }
    return {
        ref: args.ref,
        kind: 'sprite-sheet',
        priority: args.priority,
        metadata: args.metadata, // verbatim; never inspected sim-side
    };
}
