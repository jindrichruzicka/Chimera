// @vitest-environment jsdom

/**
 * renderer/assets/useAnimationSheet.test.tsx
 *
 * Holds the hook's one non-obvious property: the parsed sheet is allocated once
 * per METADATA IDENTITY, not once per render.
 *
 * A hook that re-parsed every render would satisfy every value assertion in this
 * file — the sheets would be deep-equal, the warnings identical — and would put
 * a fresh object into the deps of every effect and memo downstream of it, on
 * every frame. So the identity assertions carry the weight, and each one is
 * taken across a rerender that changes nothing, then across one that changes the
 * metadata, so a hook that simply never recomputed would fail too.
 *
 * The StrictMode case is separate because it is a different claim: React
 * double-invokes render, and `useMemo` is explicitly allowed to discard a cached
 * value. What is asserted there is what a caller may actually rely on — identity
 * held across a COMMITTED rerender.
 *
 * That claim is also why this file mounts StrictMode through a `wrapper` and
 * means it — see `../components/r3f/useModelAnimation.test.tsx` for which half
 * of StrictMode that form reaches.
 */

import { cleanup, renderHook } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetRef, GLTFModelAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from './AssetManager.js';
import { AssetManagerContext } from './AssetManagerContext.js';
import { useAnimationSheet } from './useAnimationSheet.js';

afterEach(() => {
    cleanup();
});

/** Authored the way a game authors one: a module-scope constant, built once. */
const SWING_SHEET = {
    clips: {
        swing: {
            durationSeconds: 1,
            notifies: { woosh: { at: 0.25 } },
            passages: { strike: { from: 0.1, to: 0.5, window: 'melee-hit' } },
        },
    },
};

const SWING_REF: AssetRef<GLTFModelAsset> = buildAssetRef<GLTFModelAsset>(
    'tactics',
    'models/warrior.glb',
);

function createManager(getManifestMetadata: () => unknown): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        getManifestMetadata,
        async load(): Promise<never> {
            throw new Error('unused asset manager stub');
        },
        dispose(): void {},
    };
}

function wrapperFor(
    manager: AssetManager,
    strict = false,
): ({ children }: { readonly children: React.ReactNode }) => React.ReactElement {
    return function Wrapper({ children }): React.ReactElement {
        const tree = (
            <AssetManagerContext.Provider value={manager}>{children}</AssetManagerContext.Provider>
        );
        return strict ? <StrictMode>{tree}</StrictMode> : tree;
    };
}

describe('useAnimationSheet reads the manifest metadata slot', () => {
    it('parses the sheet the manager holds for the ref', () => {
        const manager = createManager(() => SWING_SHEET);
        const { result } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(manager),
        });

        expect(result.current?.sheet.clips?.['swing']?.notifies).toEqual({ woosh: { at: 0.25 } });
        expect(result.current?.warnings).toEqual([]);
    });

    it('asks the manager for the ref it was given', () => {
        const getManifestMetadata = vi.fn(() => SWING_SHEET);
        const { result } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(getManifestMetadata)),
        });

        expect(result.current).not.toBeNull();
        expect(getManifestMetadata).toHaveBeenCalledWith(SWING_REF);
    });

    it('returns null for a null ref without asking the manager anything', () => {
        const getManifestMetadata = vi.fn(() => SWING_SHEET);
        const { result } = renderHook(() => useAnimationSheet(null), {
            wrapper: wrapperFor(createManager(getManifestMetadata)),
        });

        expect(result.current).toBeNull();
        expect(getManifestMetadata).not.toHaveBeenCalled();
    });

    it('returns null for a ref whose entry declares no metadata', () => {
        const { result } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(() => undefined)),
        });

        expect(result.current).toBeNull();
    });

    it('surfaces a malformed sheet as warnings rather than a throw', () => {
        const { result } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(() => ({ clips: { swing: { loop: 'ping-pong' } } }))),
        });

        expect(result.current?.warnings).toHaveLength(1);
        expect(result.current?.sheet.clips?.['swing']).toEqual({});
    });

    it('refuses to run outside an AssetManagerContext provider', () => {
        expect(() => renderHook(() => useAnimationSheet(SWING_REF))).toThrow(
            'useAssetManager must be used inside AssetManagerContext.Provider',
        );
    });
});

describe('useAnimationSheet allocates once per metadata identity', () => {
    it('returns the very same object across a rerender that changes nothing', () => {
        const { result, rerender } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(() => SWING_SHEET)),
        });
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });

    it('holds that identity across a committed rerender under StrictMode', () => {
        const getManifestMetadata = vi.fn(() => SWING_SHEET);
        const { result, rerender } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(getManifestMetadata), true),
        });
        const first = result.current;

        // Positive control: the hook body reads the manifest slot once per
        // render invocation, so TWO reads is StrictMode's double-invoke
        // actually happening. Without it this case asserts nothing the
        // non-strict sibling above does not already assert, and would stay
        // green if the `strict` argument were dropped.
        expect(getManifestMetadata).toHaveBeenCalledTimes(2);

        rerender();

        expect(result.current).toBe(first);
        expect(getManifestMetadata).toHaveBeenCalledTimes(4);
    });

    it('re-parses when the manager hands back a different object, deep-equal or not', () => {
        // Deep-equal on purpose: identity is the trigger, so a hook keyed on
        // anything coarser (the ref string, a serialisation) would fail here.
        let metadata: unknown = SWING_SHEET;
        const { result, rerender } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(() => metadata)),
        });
        const first = result.current;

        metadata = structuredClone(SWING_SHEET);
        rerender();

        expect(result.current).not.toBe(first);
        expect(result.current).toEqual(first);
    });

    it('parses once per identity, not once per render', () => {
        const getManifestMetadata = vi.fn(() => SWING_SHEET);
        const { result, rerender } = renderHook(() => useAnimationSheet(SWING_REF), {
            wrapper: wrapperFor(createManager(getManifestMetadata)),
        });
        const first = result.current;

        rerender();
        rerender();

        // The manager IS read every render — it is a Map lookup, and reading it
        // is how a changed identity is noticed at all. The PARSE is what the
        // memo saves, and the returned identity is the only observable of it.
        expect(getManifestMetadata.mock.calls.length).toBeGreaterThan(1);
        expect(result.current).toBe(first);
    });
});
