// simulation/content/animationManifest.ts
// Animation System → clip-sheet authoring surface (sim side). Feature F82,
// docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
//
// The write-only authoring builders games call to attach a clip sheet to a
// 'gltf-model' or 'sprite-sheet' manifest entry. They only WRITE the value into
// the existing AssetManifestEntry.metadata slot (typed `unknown`); they never
// read or parse it. The sheet vocabulary is defined sim-side
// (../foundation/animation-clip-sheet) and flows sim → renderer — the sole
// playback parser/resolver is the renderer, never the reverse.
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
 * sheet in the opaque `metadata` slot. The exact twin of
 * {@link modelAnimationEntry} for sprite content.
 *
 * @param args.ref       A typed reference to the sprite sheet.
 * @param args.priority  Load priority (`'critical'` preloads; `'deferred'` lazy-loads).
 * @param args.metadata  Optional clip sheet. Omit for a behaviour-neutral entry
 *                       identical to a hand-authored one (no `metadata` key).
 */
export function spriteAnimationEntry(args: {
    readonly ref: AssetRef<SpriteSheetAsset>;
    readonly priority: AssetPriority;
    readonly metadata?: SpriteAnimationMetadata;
}): AssetManifestEntry<SpriteSheetAsset> {
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
