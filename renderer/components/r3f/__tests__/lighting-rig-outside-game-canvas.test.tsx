// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { DirectionalLight } from 'three';
import { describe, expect, it } from 'vitest';
import { LightingRig, ShadowQualityProvider } from '../index';

/**
 * What a game's own component test writes: its scene mounted under
 * `@react-three/test-renderer`, with no `GameCanvas` to resolve a shadow
 * quality, and both components taken from the public r3f barrel. The barrel
 * module is imported by path: the package specifier resolves to the built
 * `dist/`, which a focused run does not rebuild.
 */
describe('LightingRig outside a GameCanvas, under ShadowQualityProvider', () => {
    it("sizes the key light's shadow map from the provided quality", async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ShadowQualityProvider quality="percentage">
                <LightingRig />
            </ShadowQualityProvider>,
        );

        try {
            const key = keyLight(renderer.scene);
            expect(key.castShadow).toBe(true);
            expect(key.shadow.mapSize.toArray()).toEqual([1024, 1024]);
        } finally {
            await renderer.unmount();
        }
    });

    it("stops the key light casting when the provided quality is 'off'", async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ShadowQualityProvider quality="off">
                <LightingRig />
            </ShadowQualityProvider>,
        );

        try {
            expect(keyLight(renderer.scene).castShadow).toBe(false);
        } finally {
            await renderer.unmount();
        }
    });
});

function keyLight(scene: ReactThreeTest.ReactThreeTestInstance): DirectionalLight {
    const matches = scene.allChildren.filter((child) => child.type === 'DirectionalLight');
    expect(matches).toHaveLength(1);
    return matches[0]!.instance as DirectionalLight;
}
