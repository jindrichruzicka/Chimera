// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { Mesh, MeshStandardMaterial, TorusGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { TacticsSelectionRing } from './TacticsSelectionRing';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

describe('TacticsSelectionRing', () => {
    it('renders no mesh when hidden', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsSelectionRing color="#ffffff" isVisible={false} />,
        );

        try {
            expect(findThreeObjects(renderer.scene, 'Mesh')).toHaveLength(0);
        } finally {
            await renderer.unmount();
        }
    });

    it('renders an emissive ring when visible', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsSelectionRing color="#123456" isVisible />,
        );

        try {
            const [ring] = findThreeObjects(renderer.scene, 'Mesh');
            expect(ring?.instance.type).toBe('Mesh');
            expect((ring?.instance as Mesh).position.toArray()).toEqual([0, 0.03, 0]);

            const material = (ring?.instance as Mesh).material as MeshStandardMaterial;
            expect(material.color.getHexString()).toBe('123456');
            expect(material.emissive.getHexString()).toBe('123456');
            expect(material.emissiveIntensity).toBe(0.35);

            const geometry = (ring?.instance as Mesh).geometry as TorusGeometry;
            expect(geometry.parameters.radius).toBe(0.48);
        } finally {
            await renderer.unmount();
        }
    });

    it('renders at a custom radius when provided', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsSelectionRing color="#ffffff" isVisible radius={0.42} />,
        );

        try {
            const [ring] = findThreeObjects(renderer.scene, 'Mesh');
            const geometry = (ring?.instance as Mesh).geometry as TorusGeometry;
            expect(geometry.parameters.radius).toBe(0.42);
        } finally {
            await renderer.unmount();
        }
    });
});

function findThreeObjects(scene: TestInstance, type: string): readonly TestInstance[] {
    return scene.findAll((node) => node.instance.type === type);
}
