// @vitest-environment jsdom

/**
 * renderer/assets/useSpriteAtlas.test.tsx
 *
 * The React seam onto a measured sprite sheet: the loading states a caller has
 * to survive, and the one non-obvious property — the atlas is measured once per
 * LOADED ASSET IDENTITY, not once per render.
 *
 * The identity assertions carry the weight for the same reason they do in
 * `useAnimationSheet.test.tsx`: a hook that re-measured every render would
 * satisfy every value assertion here and put a fresh `SpriteAtlas` — with a
 * fresh `frames` array — into the deps of the backend allocation downstream of
 * it, re-cutting every sprite in the scene on every frame.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, LoadedSpriteSheetAsset } from './AssetManager.js';
import { AssetManagerContext } from './AssetManagerContext.js';
import { useSpriteAtlas } from './useSpriteAtlas.js';

afterEach(() => {
    cleanup();
});

const RUN_REF: AssetRef<SpriteSheetAsset> = buildAssetRef<SpriteSheetAsset>(
    'tactics',
    'sprites/runner.json',
);

/**
 * A loaded sheet with a decoded 64x32 image and two 32x32 cells. The texture is
 * the shape `parseSpriteAtlas` actually reads — an object carrying an `image`
 * with numeric dimensions — and nothing more.
 */
function createLoadedSheet(): LoadedSpriteSheetAsset {
    return {
        texture: { image: { width: 64, height: 32 } },
        frames: {
            run_0: { frame: { x: 0, y: 0, w: 32, h: 32 } },
            run_1: { frame: { x: 32, y: 0, w: 32, h: 32 } },
        },
    } as unknown as LoadedSpriteSheetAsset;
}

function createManager(load: (ref: unknown) => Promise<unknown>): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        getManifestMetadata(): undefined {
            return undefined;
        },
        load,
        dispose(): void {},
    } as unknown as AssetManager;
}

function wrapperFor(
    manager: AssetManager,
): ({ children }: { readonly children: React.ReactNode }) => React.ReactElement {
    return function Wrapper({ children }): React.ReactElement {
        return (
            <AssetManagerContext.Provider value={manager}>{children}</AssetManagerContext.Provider>
        );
    };
}

describe('useSpriteAtlas measures the loaded sheet', () => {
    it('reports loading before the sheet resolves, with no atlas yet', () => {
        const manager = createManager(() => new Promise(() => {}));
        const { result } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(manager),
        });

        expect(result.current.loading).toBe(true);
        expect(result.current.atlas).toBeNull();
        expect(result.current.texture).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('measures the cells and hands back the manager-owned texture once resolved', async () => {
        const sheet = createLoadedSheet();
        const { result } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(createManager(() => Promise.resolve(sheet))),
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.atlas?.frames).toHaveLength(2);
        expect(result.current.atlas?.imageWidth).toBe(64);
        expect(result.current.atlas?.imageHeight).toBe(32);
        // The texture is passed through by reference: it is manager-owned
        // (Invariant #21) and every sprite cut from this sheet shares it.
        expect(result.current.texture).toBe(sheet.texture);
    });

    it('puts v = 1 on the image top row, the orientation the atlas reader fixes', async () => {
        const { result } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(createManager(() => Promise.resolve(createLoadedSheet()))),
        });

        await waitFor(() => {
            expect(result.current.atlas).not.toBeNull();
        });

        // A cell measured from y = 0 samples the TOP row, which after three's
        // default flipY decode is v = 1. Pinned here because the whole point of
        // the hook is that a caller never re-derives this.
        expect(result.current.atlas?.frames[0]?.uv[0]).toEqual([0, 1]);
    });

    it('surfaces a load failure as an error rather than throwing', async () => {
        const failure = new Error('sheet 404');
        const { result } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(createManager(() => Promise.reject(failure))),
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe(failure);
        expect(result.current.atlas).toBeNull();
    });

    it('answers a null atlas for a sheet loaded straight from an image, with no error', async () => {
        // No descriptor at all: a bare texture is a legitimate sprite sheet, it
        // just has no cells to cut. That is not a fault, so no error is raised —
        // the caller sees a texture and no atlas.
        const bare = {
            texture: { image: { width: 8, height: 8 } },
        } as unknown as LoadedSpriteSheetAsset;
        const { result } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(createManager(() => Promise.resolve(bare))),
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.atlas).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.texture).toBe(bare.texture);
    });

    it('is idle for a null ref and asks the manager for nothing', () => {
        const load = vi.fn(() => Promise.resolve(createLoadedSheet()));
        const { result } = renderHook(() => useSpriteAtlas(null), {
            wrapper: wrapperFor(createManager(load)),
        });

        expect(result.current).toEqual({
            atlas: null,
            texture: null,
            loading: false,
            error: null,
        });
        expect(load).not.toHaveBeenCalled();
    });

    it('refuses to run outside an AssetManagerContext provider', () => {
        expect(() => renderHook(() => useSpriteAtlas(RUN_REF))).toThrow(
            'useAssetManager must be used inside AssetManagerContext.Provider',
        );
    });
});

describe('useSpriteAtlas measures once per loaded asset identity', () => {
    it('returns the very same atlas across a rerender that changes nothing', async () => {
        const sheet = createLoadedSheet();
        const { result, rerender } = renderHook(() => useSpriteAtlas(RUN_REF), {
            wrapper: wrapperFor(createManager(() => Promise.resolve(sheet))),
        });

        await waitFor(() => {
            expect(result.current.atlas).not.toBeNull();
        });
        const first = result.current.atlas;

        rerender();

        expect(result.current.atlas).toBe(first);
    });

    it('re-measures when a new ref resolves to a different loaded object', async () => {
        // Driven through a ref change, because that is the only way a new loaded
        // object actually arrives: `useAsset` keys its load effect on the ref, so
        // a rerender alone re-resolves nothing. The two sheets are deep-equal on
        // purpose — identity is the trigger, so a hook keyed on anything coarser
        // (the ref string, a serialisation) would fail here.
        const manager = createManager(() => Promise.resolve(createLoadedSheet()));
        const { result, rerender } = renderHook(({ ref }) => useSpriteAtlas(ref), {
            wrapper: wrapperFor(manager),
            initialProps: { ref: RUN_REF },
        });

        await waitFor(() => {
            expect(result.current.atlas).not.toBeNull();
        });
        const first = result.current.atlas;

        rerender({ ref: buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/walker.json') });

        await waitFor(() => {
            expect(result.current.atlas).not.toBeNull();
        });
        expect(result.current.atlas).not.toBe(first);
        expect(result.current.atlas).toEqual(first);
    });
});
