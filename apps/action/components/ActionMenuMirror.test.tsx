// @vitest-environment jsdom

/**
 * What the menu's mirror ball is for is that a smooth metal shows the
 * environment and nothing else, so the properties that make the reflection real
 * — the map reaching the material, full metalness, a low roughness — are the
 * ones asserted here, off the material three actually built.
 *
 * The asset layer is doubled at the HOOK, not at the manager: what this
 * component does with a resolved texture, and what it does before one arrives,
 * are the two behaviours, and a real manager would add a load to both.
 */

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import { EquirectangularReflectionMapping, Texture } from 'three';
import type { Mesh, MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What the doubled `useAsset` answers, in the shape the real hook returns. */
interface MirrorAssetState {
    asset: unknown;
    loading: boolean;
    error: Error | null;
}

const assetState = vi.hoisted(() => {
    const value: MirrorAssetState = { asset: null, loading: true, error: null };
    const refs: unknown[] = [];
    return { value, refs };
});

vi.mock('@chimera-engine/renderer/assets', () => ({
    useAsset: (ref: unknown) => {
        assetState.refs.push(ref);
        return assetState.value;
    },
}));

import { actionShellEnvironmentRefs } from '../shell-asset-manifest.js';
import { ActionMenuMirror } from './ActionMenuMirror';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

function findMesh(scene: TestInstance): Mesh | null {
    const meshes = scene.findAll((node) => node.instance.type === 'Mesh');
    return meshes.length === 0 ? null : (meshes[0]?.instance as Mesh);
}

function resolvedSky(): Texture {
    const texture = new Texture();
    // The loader writes this before publishing; the component is handed the
    // texture the manager resolved, so the fixture carries it too.
    texture.mapping = EquirectangularReflectionMapping;
    return texture;
}

beforeEach(() => {
    assetState.value = { asset: null, loading: true, error: null };
    assetState.refs.length = 0;
});

describe('ActionMenuMirror', () => {
    it('resolves the sky the shell manifest declares', async () => {
        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            expect(assetState.refs).toEqual([actionShellEnvironmentRefs.menuSky]);
        } finally {
            await renderer.unmount();
        }
    });

    it.each([
        ['still loading', { asset: null, loading: true, error: null }],
        ['failed to load', { asset: null, loading: false, error: new Error('no sky') }],
    ])('renders nothing while the sky is %s', async (_label, state) => {
        // One branch, two states: the component reads the resolved asset alone,
        // so `loading` and `error` reach the same return. Both are here because
        // both are states a game will see, not because the code forks on them.
        assetState.value = state;

        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            // A mirror with nothing to reflect is a black circle over the arena.
            expect(findMesh(renderer.scene)).toBeNull();
        } finally {
            await renderer.unmount();
        }
    });

    it('hands the resolved sky to the material as its environment map', async () => {
        const sky = resolvedSky();
        assetState.value = { asset: sky, loading: false, error: null };

        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            const mesh = findMesh(renderer.scene);
            const material = mesh?.material as MeshStandardMaterial;

            // Identity, not "some texture": the whole point is that THIS
            // declared asset is what the ball shows.
            expect(material.envMap).toBe(sky);
        } finally {
            await renderer.unmount();
        }
    });

    it('is a mirror: fully metallic and nearly smooth', async () => {
        assetState.value = { asset: resolvedSky(), loading: false, error: null };

        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            const material = findMesh(renderer.scene)?.material as MeshStandardMaterial;

            // Both are what make the reflection legible. At metalness 0 a
            // standard material keeps a diffuse term and the sky washes into it;
            // at a high roughness the pre-filtered map blurs the sky's gradient
            // into one flat average.
            expect(material.metalness).toBe(1);
            expect(material.roughness).toBeLessThan(0.2);
        } finally {
            await renderer.unmount();
        }
    });

    it('tints the reflection with nothing', async () => {
        assetState.value = { asset: resolvedSky(), loading: false, error: null };

        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            const material = findMesh(renderer.scene)?.material as MeshStandardMaterial;

            // A metal's reflection is multiplied by its colour, so anything but
            // white changes the hues the e2e counts off the screen.
            expect(material.color.getHex()).toBe(0xffffff);
        } finally {
            await renderer.unmount();
        }
    });

    it('hangs the ball above the arena rather than in it', async () => {
        assetState.value = { asset: resolvedSky(), loading: false, error: null };

        const renderer = await ReactThreeTestRenderer.create(<ActionMenuMirror />);
        try {
            const mesh = findMesh(renderer.scene);

            // Clear of the primitives, which sit at half a cell: a ball at their
            // height would occlude the seat colours the menu is actually for.
            expect(mesh?.position.y).toBeGreaterThan(2);
        } finally {
            await renderer.unmount();
        }
    });
});
