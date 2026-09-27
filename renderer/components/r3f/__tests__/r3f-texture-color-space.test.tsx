// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/r3f-texture-color-space.test.tsx
 *
 * What `@react-three/fiber` does to a texture's `colorSpace` when a game hands
 * the texture to a material, measured against the installed library.
 *
 * The engine defaults a loaded texture's color space to sRGB (§4.10), and what
 * that default changes for a game depends on this behaviour: r3f tags a texture
 * sRGB itself on some routes and leaves it alone on others. An environment map is
 * the case where that matters most, because its decoder tags it LINEAR on purpose
 * and the JSX slot it goes to is one of the color slots — spared by the TYPE the
 * decoder emits, not by the slot. The changeset and
 * `docs/core-components/asset-reference-system.md` describe the consequence in
 * these terms, so an r3f upgrade that moves any row below has to fail here
 * rather than quietly falsify them.
 *
 * These pin a dependency, not engine code: there is nothing to turn red first.
 */

import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import {
    type BufferGeometry,
    HalfFloatType,
    LinearSRGBColorSpace,
    type Mesh,
    MeshStandardMaterial,
    NoColorSpace,
    RGBAFormat,
    SRGBColorSpace,
    Texture,
} from 'three';
import { describe, expect, it } from 'vitest';

function textureTagged(colorSpace: string): Texture {
    const texture = new Texture();
    texture.colorSpace = colorSpace;
    return texture;
}

/** Mounts `element`, unmounts it, and leaves whatever r3f wrote on the texture. */
async function mounted(element: React.ReactElement): Promise<void> {
    const renderer = await ReactThreeTestRenderer.create(element);
    await renderer.unmount();
}

/**
 * The same, returning the `envMap` three ended up holding on the material.
 *
 * Read BEFORE the unmount, because r3f releases what it built on the way out. It
 * exists so a case can pin WHICH SLOT its fixture went to: a texture r3f leaves
 * alone is indistinguishable from a texture that never reached a color slot, and
 * without this the difference is unobservable.
 */
async function mountedEnvMap(element: React.ReactElement): Promise<Texture | null> {
    const renderer = await ReactThreeTestRenderer.create(element);
    const root = renderer.scene.children[0];
    if (root === undefined) {
        throw new Error('Nothing mounted under the test scene.');
    }
    // `instance` is typed as the base `Object3D`, which declares no material, so
    // reaching one needs a narrowing the type cannot derive. What keeps it honest is
    // the caller: every case using this asserts the texture it passed comes back, so
    // a mount that stopped producing a standard material fails there rather than here.
    const mesh = root.instance as Mesh<BufferGeometry, MeshStandardMaterial>;
    const bound = mesh.material.envMap;
    await renderer.unmount();
    return bound;
}

describe('r3f and a texture set on a JSX color slot', () => {
    // The slots r3f treats as color. `meshPhysicalMaterial` because two of them do
    // not exist on a standard material.
    it.each(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap', 'envMap'] as const)(
        'tags an untagged texture sRGB when it is the `%s` prop',
        async (slot) => {
            const texture = textureTagged(NoColorSpace);

            await mounted(
                <mesh>
                    <meshPhysicalMaterial {...{ [slot]: texture }} />
                </mesh>,
            );

            expect(texture.colorSpace).toBe(SRGBColorSpace);
        },
    );

    it('re-tags an 8-bit envMap but spares a half-float one', async () => {
        // The case the environment-map route depends on: an HDRI arrives tagged
        // `LinearSRGBColorSpace` — three's decoder writes that itself, because radiance
        // is linear — and a game then hands it straight to `envMap=` in JSX, a slot
        // r3f re-tags. What spares it is that r3f re-tags only a texture of 8-bit
        // type. What an HDRI decoder actually emits is held by
        // `renderer/assets/AssetManager.environmentMap.test.ts`, not here.
        //
        // BOTH ARMS ON ONE SLOT, each asserting the binding as well as the colour
        // space. Colour space alone cannot carry this:
        // a texture r3f spared reads identically to one that never reached a color
        // slot, so a case that only checked `colorSpace` would keep passing with its
        // fixture moved to `roughnessMap` — measuring nothing about `envMap`.
        //
        // `format` is asserted to record that both fixtures sit at `RGBAFormat`, the
        // value the re-tag admits.
        const byteTexture = textureTagged(NoColorSpace);
        const halfFloatTexture = textureTagged(LinearSRGBColorSpace);
        halfFloatTexture.type = HalfFloatType;

        expect(byteTexture.format).toBe(RGBAFormat);
        expect(halfFloatTexture.format).toBe(RGBAFormat);

        const boundByte = await mountedEnvMap(
            <mesh>
                <meshStandardMaterial envMap={byteTexture} />
            </mesh>,
        );
        const boundHalfFloat = await mountedEnvMap(
            <mesh>
                <meshStandardMaterial envMap={halfFloatTexture} />
            </mesh>,
        );

        // The half-float arm needs the strict form: an unset `envMap` reads `null`,
        // which a `toBeDefined()` would admit, leaving its slot unpinned.
        expect(boundByte).toBe(byteTexture);
        expect(boundHalfFloat).toBe(halfFloatTexture);
        expect(byteTexture.colorSpace).toBe(SRGBColorSpace);
        expect(halfFloatTexture.colorSpace).toBe(LinearSRGBColorSpace);
    });

    it('overwrites a color space the texture already carried', async () => {
        const texture = textureTagged(LinearSRGBColorSpace);

        await mounted(
            <mesh>
                <meshStandardMaterial map={texture} />
            </mesh>,
        );

        expect(texture.colorSpace).toBe(SRGBColorSpace);
    });
});

describe('r3f and a texture set on a JSX data slot', () => {
    it.each(['roughnessMap', 'normalMap'] as const)(
        'leaves an untagged texture alone as the `%s` prop',
        async (slot) => {
            const texture = textureTagged(NoColorSpace);

            await mounted(
                <mesh>
                    <meshStandardMaterial {...{ [slot]: texture }} />
                </mesh>,
            );

            expect(texture.colorSpace).toBe(NoColorSpace);
        },
    );

    it.each(['roughnessMap', 'normalMap'] as const)(
        'leaves an sRGB-tagged texture sRGB as the `%s` prop',
        async (slot) => {
            // The hazard the engine default creates: a DATA map whose manifest entry
            // does not declare `colorSpace: 'none'` arrives tagged sRGB, and nothing
            // on this route puts it right.
            const texture = textureTagged(SRGBColorSpace);

            await mounted(
                <mesh>
                    <meshStandardMaterial {...{ [slot]: texture }} />
                </mesh>,
            );

            expect(texture.colorSpace).toBe(SRGBColorSpace);
        },
    );
});

describe('r3f and a texture that does not arrive as a JSX prop', () => {
    it('leaves a texture passed through constructor `args` untagged', async () => {
        const texture = textureTagged(NoColorSpace);

        await mounted(
            <mesh>
                <meshStandardMaterial args={[{ map: texture }]} />
            </mesh>,
        );

        expect(texture.colorSpace).toBe(NoColorSpace);
    });

    it('leaves a texture assigned to a material the game built itself untagged', async () => {
        const texture = textureTagged(NoColorSpace);
        const material = new MeshStandardMaterial();
        material.map = texture;

        await mounted(
            <mesh>
                <primitive object={material} attach="material" />
            </mesh>,
        );

        expect(texture.colorSpace).toBe(NoColorSpace);
    });
});
