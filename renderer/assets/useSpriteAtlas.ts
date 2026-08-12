'use client';

/**
 * renderer/assets/useSpriteAtlas.ts
 *
 * The React seam onto a sprite sheet's measured cells: loads the sheet through
 * the asset manager, measures its atlas descriptor once, and hands back both the
 * cells and the manager-owned texture to draw them with.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why the texture comes back too.** `SpriteAtlas` deliberately carries no
 * texture — `SpriteClipBackend` writes UVs into a caller's geometry and must
 * never touch a shared `Texture` (Rule SPRITE-NO-SHARED-MUTATION). But whatever
 * DRAWS the sprite needs one, so the hook returns the pair: the cells for the
 * backend, the texture for the material. It is passed through BY REFERENCE and
 * never configured, cloned or disposed here — it is manager-owned and shared by
 * every sprite cut from the same sheet (Invariant #21).
 *
 * **The memo is keyed on the LOADED ASSET's identity.** A hook that re-measured
 * every render would hand a fresh `SpriteAtlas` — and a fresh `frames` array — to
 * the backend allocation downstream on every frame, re-cutting every sprite in
 * the scene. The manager caches by ref, so a sheet that has not been reloaded is
 * the same object.
 *
 * **An unmeasurable atlas is not an error.** A sheet loaded straight from an
 * image has no descriptor to measure, and that is a legitimate sprite sheet with
 * nothing to cut — so `atlas` is `null` while `error` stays `null` and the
 * texture is still returned. Only a failed LOAD is an error.
 */

import { useMemo } from 'react';

import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { LoadedSpriteSheetAsset } from './AssetManager.js';
import { parseSpriteAtlas } from './spriteAtlas.js';
import type { SpriteAtlas } from './spriteAtlas.js';
import { useAsset } from './useAsset.js';

/** What {@link useSpriteAtlas} reports, in the same shape `useAsset` reports a load. */
export interface UseSpriteAtlasState {
    /**
     * The measured cells, or `null` while loading, on a failed load, or for a
     * sheet with no atlas descriptor to measure.
     */
    readonly atlas: SpriteAtlas | null;
    /**
     * The decoded sheet texture, or `null` until the load resolves. Manager-owned
     * and shared: read it, never configure or dispose it.
     */
    readonly texture: LoadedSpriteSheetAsset['texture'] | null;
    /** True while the sheet is in flight. */
    readonly loading: boolean;
    /** The load failure, if the sheet could not be fetched or decoded. */
    readonly error: Error | null;
}

/**
 * Load and measure the sprite sheet `ref` names.
 *
 * A `null` ref loads nothing and reports the idle state. Never throws for a
 * malformed descriptor — an unusable cell is refused into
 * {@link SpriteAtlas.warnings}, which is the caller's to surface. The one throw
 * is `useAssetManager`'s missing-provider refusal (Invariant #83).
 */
export function useSpriteAtlas(ref: AssetRef<SpriteSheetAsset> | null): UseSpriteAtlasState {
    const { asset, loading, error } = useAsset(ref);

    // Keyed on the loaded object, so measuring happens once per load and not
    // once per render — see the module header.
    const atlas = useMemo(() => (asset === null ? null : parseSpriteAtlas(asset)), [asset]);

    return { atlas, texture: asset?.texture ?? null, loading, error };
}
