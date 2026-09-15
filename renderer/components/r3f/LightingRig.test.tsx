// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { AmbientLight, DirectionalLight, Object3D, PointLight } from 'three';
import { describe, expect, it } from 'vitest';
import { LightingRig } from './LightingRig';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

describe('LightingRig', () => {
    it('mounts one ambient light and one directional key light at the documented defaults', async () => {
        const renderer = await ReactThreeTestRenderer.create(<LightingRig />);

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
            <LightingRig
                ambientIntensity={0.25}
                keyLightIntensity={1.5}
                keyLightPosition={[-2, 7, 3]}
            />,
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
                <LightingRig castShadow={castShadow} />,
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
        const renderer = await ReactThreeTestRenderer.create(<LightingRig castShadow />);

        try {
            const key = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(key.castShadow).toBe(true);

            await renderer.update(<LightingRig castShadow={false} />);

            const updated = onlyObject<DirectionalLight>(renderer.scene, 'DirectionalLight');
            expect(updated).toBe(key);
            expect(updated.castShadow).toBe(false);
        } finally {
            await renderer.unmount();
        }
    });

    it('leaves a light the game mounts beside the rig in the scene', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <>
                <LightingRig />
                <pointLight intensity={3} position={[0, 2, 0]} />
            </>,
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

/** The single three object of `type` under the scene; fails on none or several. */
function onlyObject<T extends Object3D>(scene: TestInstance, type: string): T {
    const matches = scene.allChildren.filter((child) => child.type === type);
    expect(matches, type).toHaveLength(1);
    return matches[0]!.instance as T;
}
