// @vitest-environment jsdom

import React from 'react';
import type { ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type {
    AmbientLight,
    DirectionalLight,
    Object3D,
    PointLight,
    WebGLRenderTarget,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LightingRig } from './LightingRig';
import type { ShadowQuality } from './rendererConfig';
import { ShadowQualityContext } from './shadowQualityContext';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

describe('LightingRig', () => {
    it('mounts one ambient light and one directional key light at the documented defaults', async () => {
        const renderer = await ReactThreeTestRenderer.create(underCanvas(<LightingRig />));

        try {
            const ambient = onlyObject<AmbientLight>(renderer.scene, 'AmbientLight');
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');

            expect(ambient.intensity).toBe(0.6);
            expect(key.intensity).toBe(1);
            expect(key.position.toArray()).toEqual([5, 10, 5]);
            expect(key.castShadow).toBe(true);
            expect(renderer.scene.allChildren).toHaveLength(2);
        } finally {
            await renderer.unmount();
        }
    });

    it('applies the authored ambient intensity, key intensity and key position', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            underCanvas(
                <LightingRig
                    ambientIntensity={0.25}
                    keyLightIntensity={1.5}
                    keyLightPosition={[-2, 7, 3]}
                />,
            ),
        );

        try {
            expect(onlyObject<AmbientLight>(renderer.scene, 'AmbientLight').intensity).toBe(0.25);
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(key.intensity).toBe(1.5);
            expect(key.position.toArray()).toEqual([-2, 7, 3]);
        } finally {
            await renderer.unmount();
        }
    });

    it.each([true, false])(
        'makes the key light cast exactly when castShadow is %s',
        async (castShadow) => {
            const renderer = await ReactThreeTestRenderer.create(
                underCanvas(<LightingRig castShadow={castShadow} />),
            );

            try {
                const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
                expect(key.castShadow).toBe(castShadow);
            } finally {
                await renderer.unmount();
            }
        },
    );

    it('follows a changed castShadow on the mounted key light', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            underCanvas(<LightingRig castShadow />),
        );

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(key.castShadow).toBe(true);

            await renderer.update(underCanvas(<LightingRig castShadow={false} />));

            const updated = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(updated).toBe(key);
            expect(updated.castShadow).toBe(false);
        } finally {
            await renderer.unmount();
        }
    });

    it('leaves a light the game mounts beside the rig in the scene', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            underCanvas(
                <>
                    <LightingRig />
                    <pointLight intensity={3} position={[0, 2, 0]} />
                </>,
            ),
        );

        try {
            const gameLight = onlyObject<PointLight>(renderer.scene, 'PointLight');
            expect(gameLight.intensity).toBe(3);
            expect(onlyObject<AmbientLight>(renderer.scene, 'AmbientLight').intensity).toBe(0.6);
            expect(onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight').intensity).toBe(
                1,
            );
        } finally {
            await renderer.unmount();
        }
    });
});

describe('LightingRig shadow quality', () => {
    it.each([
        ['basic', 512],
        ['percentage', 1024],
        ['soft', 2048],
        ['variance', 2048],
    ] as const)("sizes the key light's shadow map for '%s' at %i", async (quality, size) => {
        const renderer = await ReactThreeTestRenderer.create(underCanvas(<LightingRig />, quality));

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(key.shadow.mapSize.toArray()).toEqual([size, size]);
            expect(key.castShadow).toBe(true);
        } finally {
            await renderer.unmount();
        }
    });

    it("stops the key light casting at 'off', whatever castShadow says", async () => {
        const renderer = await ReactThreeTestRenderer.create(
            underCanvas(<LightingRig castShadow />, 'off'),
        );

        try {
            expect(
                onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight').castShadow,
            ).toBe(false);
        } finally {
            await renderer.unmount();
        }
    });

    it("resumes casting at the tier's size when the quality leaves 'off'", async () => {
        const renderer = await ReactThreeTestRenderer.create(underCanvas(<LightingRig />, 'off'));

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');

            await renderer.update(underCanvas(<LightingRig />, 'percentage'));

            expect(onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight')).toBe(key);
            expect(key.castShadow).toBe(true);
            expect(key.shadow.mapSize.toArray()).toEqual([1024, 1024]);
        } finally {
            await renderer.unmount();
        }
    });

    it('sizes the key light during the commit that mounts it, before passive effects run', async () => {
        const readAtLayout: number[][] = [];
        const renderer = await ReactThreeTestRenderer.create(
            underCanvas(
                <>
                    <LightingRig />
                    <KeyLightMapSizeAtLayout onRead={(size) => readAtLayout.push(size)} />
                </>,
                'percentage',
            ),
        );

        try {
            expect(readAtLayout).toEqual([[1024, 1024]]);
        } finally {
            await renderer.unmount();
        }
    });

    it('resizes a mounted key light live and releases the map built at the old size', async () => {
        const renderer = await ReactThreeTestRenderer.create(underCanvas(<LightingRig />, 'basic'));

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            const allocated = fakeShadowTargets(key);

            await renderer.update(underCanvas(<LightingRig />, 'soft'));

            expect(onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight')).toBe(key);
            expect(key.shadow.mapSize.toArray()).toEqual([2048, 2048]);
            expect(key.shadow.map).toBeNull();
            expect(key.shadow.mapPass).toBeNull();
            expect(allocated.depthTextureDispose).toHaveBeenCalledOnce();
            expect(allocated.mapDispose).toHaveBeenCalledOnce();
            expect(allocated.mapPassDispose).toHaveBeenCalledOnce();
        } finally {
            await renderer.unmount();
        }
    });

    it('keeps the allocated map when a quality change leaves the size unchanged', async () => {
        const renderer = await ReactThreeTestRenderer.create(underCanvas(<LightingRig />, 'soft'));

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            const allocated = fakeShadowTargets(key);

            await renderer.update(underCanvas(<LightingRig />, 'variance'));

            expect(key.shadow.map).toBe(allocated.map);
            expect(allocated.mapDispose).not.toHaveBeenCalled();
        } finally {
            await renderer.unmount();
        }
    });
});

/**
 * Reads the key light's shadow map size from a LAYOUT effect. Mounted after the
 * rig, it runs in the same commit after the rig's own layout effects and before
 * any passive effect.
 */
function KeyLightMapSizeAtLayout({ onRead }: { readonly onRead: (size: number[]) => void }): null {
    const scene = useThree((state) => state.scene);

    React.useLayoutEffect(() => {
        const key = scene.getObjectsByProperty('type', 'DirectionalLight')[0] as
            | DirectionalLight
            | undefined;
        onRead(key === undefined ? [] : key.shadow.mapSize.toArray());
    }, [scene, onRead]);

    return null;
}

/** The rig as a GameCanvas child, holding the shadow quality the canvas resolved. */
function underCanvas(node: ReactNode, quality: ShadowQuality = 'soft'): React.ReactElement {
    return <ShadowQualityContext.Provider value={quality}>{node}</ShadowQualityContext.Provider>;
}

/**
 * Stands in for the render targets three allocates the first time it renders a
 * casting light. The test renderer draws nothing, so none exist until planted.
 */
function fakeShadowTargets(light: DirectionalLight): Readonly<{
    map: WebGLRenderTarget;
    mapDispose: ReturnType<typeof vi.fn>;
    mapPassDispose: ReturnType<typeof vi.fn>;
    depthTextureDispose: ReturnType<typeof vi.fn>;
}> {
    const mapDispose = vi.fn();
    const mapPassDispose = vi.fn();
    const depthTextureDispose = vi.fn();
    const map = {
        dispose: mapDispose,
        depthTexture: { dispose: depthTextureDispose },
    } as unknown as WebGLRenderTarget;
    light.shadow.map = map;
    light.shadow.mapPass = { dispose: mapPassDispose } as unknown as WebGLRenderTarget;

    return { map, mapDispose, mapPassDispose, depthTextureDispose };
}

/** The single three object of `type` under the scene; fails on none or several. */
function onlyObject<T extends Object3D>(scene: TestInstance, type: string): T {
    const matches = scene.allChildren.filter((child) => child.type === type);
    expect(matches, type).toHaveLength(1);
    return matches[0]!.instance as T;
}
