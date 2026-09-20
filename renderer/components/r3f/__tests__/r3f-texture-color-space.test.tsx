// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/r3f-texture-color-space.test.tsx
 *
 * What `@react-three/fiber` does to a texture's `colorSpace` when a game hands
 * the texture to a material, measured against the installed library.
 *
 * The engine defaults a loaded texture's color space to sRGB (§4.10), and what
 * that default changes for a game depends on this behaviour: r3f tags a texture
 * sRGB itself on some routes and leaves it alone on others. The changeset and
 * `docs/core-components/asset-reference-system.md` describe the consequence in
 * these terms, so an r3f upgrade that moves any row below has to fail here
 * rather than quietly falsify them.
 *
 * These pin a dependency, not engine code: there is nothing to turn red first.
 */

import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import {
    LinearSRGBColorSpace,
    MeshStandardMaterial,
    NoColorSpace,
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
