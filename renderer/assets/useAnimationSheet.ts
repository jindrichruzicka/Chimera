'use client';

/**
 * renderer/assets/useAnimationSheet.ts
 *
 * The React seam onto a model's authored animation clip sheet.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * The manager is reached through `useAssetManager` and never as a module-level
 * singleton (Invariant #84), and the read itself — `getManifestMetadata` — is a
 * synchronous Map lookup that resolves no URL, invokes no loader and populates
 * no cache. That is what lets it happen during render: a sheet is manifest data,
 * available the moment the manifest is registered, and does not wait on the
 * model it describes to decode.
 *
 * **The memo is keyed on metadata identity, not on the ref.** The manager
 * returns the authored object verbatim, so a sheet that has not been
 * re-registered is the same object, and one that HAS been — a manifest
 * replacement carrying a different sheet — is not, whatever its ref string still
 * says. A caller that wants the parsed sheet to stay one object therefore has to
 * keep the authored one stable; the manifest re-registration case in
 * `AssetManager.test.ts` is the pattern where it does not.
 *
 * **Both halves are published.** The two hooks differ only in which parser they
 * name: a mesh clip is marked, a sprite clip is marked AND carries the atlas
 * frame run that says which cells it plays. The sprite half shipped once there
 * was something to draw with — `AnimatedSprite` and `useSpriteClipPlayer` — so
 * neither signature is frozen without a caller.
 */

import { useMemo } from 'react';

import type {
    AssetRef,
    GLTFModelAsset,
    SpriteSheetAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import { parseModelAnimationMetadata, parseSpriteAnimationMetadata } from './animationSheet.js';
import type { ParsedModelAnimationSheet, ParsedSpriteAnimationSheet } from './animationSheet.js';
import { useAssetManager } from './AssetManagerContext.js';

/**
 * The clip sheet authored onto `ref`'s manifest entry, parsed and memoised, or
 * `null` when there is none to read — a `null` ref, a ref absent from the active
 * manifest, an entry with no metadata, or metadata that is no sheet at all.
 *
 * Never throws for malformed metadata: authoring faults arrive as
 * {@link ParsedModelAnimationSheet.warnings}. The one throw is
 * `useAssetManager`'s missing-provider refusal (Invariant #83).
 */
export function useAnimationSheet(
    ref: AssetRef<GLTFModelAsset> | null,
): ParsedModelAnimationSheet | null {
    const assetManager = useAssetManager();
    const metadata = ref === null ? undefined : assetManager.getManifestMetadata(ref);

    // No `ref === null` arm: an absent ref yields absent metadata, which the
    // parser already answers `null` for. A second guard here would be a branch
    // no input could tell apart from the first.
    return useMemo(() => parseModelAnimationMetadata(metadata), [metadata]);
}

/**
 * The sprite clip sheet authored onto `ref`'s manifest entry, parsed and
 * memoised, or `null` when there is none to read.
 *
 * Identical to {@link useAnimationSheet} but for the one field a sprite clip
 * adds: `frames`, the atlas frame indices the clip plays in order. A sprite clip
 * without a usable frame run is DROPPED rather than kept, because there is
 * nothing for it to show — that fault arrives as a warning, like every other.
 */
export function useSpriteAnimationSheet(
    ref: AssetRef<SpriteSheetAsset> | null,
): ParsedSpriteAnimationSheet | null {
    const assetManager = useAssetManager();
    const metadata = ref === null ? undefined : assetManager.getManifestMetadata(ref);

    return useMemo(() => parseSpriteAnimationMetadata(metadata), [metadata]);
}
