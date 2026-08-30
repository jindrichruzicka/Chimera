// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { ACTION_PRIMITIVE_HEIGHT, arenaToWorld } from './actionSceneModel.js';
import { ActionSelectionRing } from './ActionSelectionRing';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

function findMesh(scene: TestInstance): Mesh {
    return scene.find((node) => node.instance.type === 'Mesh').instance as Mesh;
}

const AT = arenaToWorld({ x: 4, y: -2 }, ACTION_PRIMITIVE_HEIGHT);

describe('ActionSelectionRing', () => {
    it('drops the ring to the floor under the primitive it marks', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionSelectionRing at={AT} seat="host" />,
        );
        try {
            const mesh = findMesh(renderer.scene);
            expect(mesh.position.x).toBe(4);
            expect(mesh.position.z).toBe(-2);
            // On the floor, not at the primitive's centre: a ring at the
            // primitive's own height would cut through the shape.
            expect(mesh.position.y).toBeLessThan(ACTION_PRIMITIVE_HEIGHT);
            expect(mesh.position.y).toBeGreaterThan(0);
        } finally {
            await renderer.unmount();
        }
    });

    it('lays the ring flat on the world XZ plane', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionSelectionRing at={AT} seat="host" />,
        );
        try {
            expect(findMesh(renderer.scene).rotation.x).toBeCloseTo(-Math.PI / 2, 6);
        } finally {
            await renderer.unmount();
        }
    });

    it('names the ring after its seat, so the scene is addressable', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionSelectionRing at={AT} seat="second" />,
        );
        try {
            expect(findMesh(renderer.scene).name).toBe('selection-ring-second');
        } finally {
            await renderer.unmount();
        }
    });

    it('gives the two seats different colours', async () => {
        // One colour for both rings would leave a two-player picker unable to
        // say which primitive belongs to which player.
        const colours: string[] = [];
        for (const seat of ['host', 'second'] as const) {
            const renderer = await ReactThreeTestRenderer.create(
                <ActionSelectionRing at={AT} seat={seat} />,
            );
            try {
                const material = findMesh(renderer.scene).material as MeshStandardMaterial;
                colours.push(material.color.getHexString());
            } finally {
                await renderer.unmount();
            }
        }

        expect(colours[0]).not.toBe(colours[1]);
    });
});
