// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
    ACTION_PRIMITIVE_HEIGHT,
    arenaToWorld,
    type ActionScenePrimitive,
} from './actionSceneModel.js';
import { ActionGroundPlane } from './ActionGroundPlane';
import { ActionPrimitiveMesh } from './ActionPrimitiveMesh';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

function makePrimitive(overrides: Partial<ActionScenePrimitive> = {}): ActionScenePrimitive {
    return {
        id: 'primitive-cube',
        shape: 'cube',
        grid: { x: 2, y: -1 },
        world: arenaToWorld({ x: 2, y: -1 }, ACTION_PRIMITIVE_HEIGHT),
        ownerId: null,
        ...overrides,
    };
}

function findByType(scene: TestInstance, type: string): TestInstance {
    return scene.find((node) => node.instance.type === type);
}

function meshMaterial(mesh: TestInstance): MeshStandardMaterial {
    expect(mesh.instance.type).toBe('Mesh');
    return (mesh.instance as Mesh).material as MeshStandardMaterial;
}

describe('ActionPrimitiveMesh', () => {
    it('places the mesh at the primitive’s world position', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive()}
                isControlled={false}
                onSelect={vi.fn()}
            />,
        );
        try {
            const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;
            expect([mesh.position.x, mesh.position.y, mesh.position.z]).toEqual([
                2,
                ACTION_PRIMITIVE_HEIGHT,
                -1,
            ]);
        } finally {
            await renderer.unmount();
        }
    });

    it('names the mesh after the entity, so the scene is addressable', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ id: 'primitive-cone' })}
                isControlled={false}
                onSelect={vi.fn()}
            />,
        );
        try {
            expect((findByType(renderer.scene, 'Mesh').instance as Mesh).name).toBe(
                'primitive-cone',
            );
        } finally {
            await renderer.unmount();
        }
    });

    const SHAPES = [
        ['cube', 'BoxGeometry'],
        ['sphere', 'SphereGeometry'],
        ['cone', 'ConeGeometry'],
    ] as const;

    for (const [shape, geometryType] of SHAPES) {
        it(`renders a ${shape} as ${geometryType}`, async () => {
            const renderer = await ReactThreeTestRenderer.create(
                <ActionPrimitiveMesh
                    primitive={makePrimitive({ shape })}
                    isControlled={false}
                    onSelect={vi.fn()}
                />,
            );
            try {
                const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;
                expect(mesh.geometry.type).toBe(geometryType);
            } finally {
                await renderer.unmount();
            }
        });
    }

    // Three colours, three fixtures: each pair differs on exactly one input, so
    // a branch collapsed into another is caught rather than masked.
    it('colours the primitive the viewer drives distinctly from another seat’s', async () => {
        const controlled = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ ownerId: 'player-1' })}
                isControlled
                onSelect={vi.fn()}
            />,
        );
        const other = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ ownerId: 'player-2' })}
                isControlled={false}
                onSelect={vi.fn()}
            />,
        );
        try {
            expect(
                meshMaterial(findByType(controlled.scene, 'Mesh')).color.getHexString(),
            ).not.toBe(meshMaterial(findByType(other.scene, 'Mesh')).color.getHexString());
        } finally {
            await controlled.unmount();
            await other.unmount();
        }
    });

    it('reports its own entity id on click', async () => {
        const onSelect = vi.fn();
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ id: 'primitive-cone' })}
                isControlled={false}
                onSelect={onSelect}
            />,
        );
        try {
            const stopPropagation = vi.fn();
            await renderer.fireEvent(findByType(renderer.scene, 'Mesh'), 'click', {
                stopPropagation,
            });

            expect(onSelect).toHaveBeenCalledWith('primitive-cone');
            // Without this the same click also reaches the ground plane behind.
            expect(stopPropagation).toHaveBeenCalledOnce();
        } finally {
            await renderer.unmount();
        }
    });

    it('colours an unclaimed primitive distinctly from another seat’s', async () => {
        const unclaimed = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ ownerId: null })}
                isControlled={false}
                onSelect={vi.fn()}
            />,
        );
        const other = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ ownerId: 'player-2' })}
                isControlled={false}
                onSelect={vi.fn()}
            />,
        );
        try {
            expect(meshMaterial(findByType(unclaimed.scene, 'Mesh')).color.getHexString()).not.toBe(
                meshMaterial(findByType(other.scene, 'Mesh')).color.getHexString(),
            );
        } finally {
            await unclaimed.unmount();
            await other.unmount();
        }
    });
});

describe('ActionGroundPlane', () => {
    it('sizes the plane from the ground entity', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <ActionGroundPlane ground={{ widthCells: 17, depthCells: 11 }} />,
        );
        try {
            const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;
            const parameters = (
                mesh.geometry as unknown as {
                    parameters: { width: number; height: number };
                }
            ).parameters;
            // Width and depth differ, so a swapped pair is observable.
            expect(parameters.width).toBe(17);
            expect(parameters.height).toBe(11);
        } finally {
            await renderer.unmount();
        }
    });

    it('lays the plane flat on the world XZ plane', async () => {
        // `planeGeometry` is authored in XY facing +Z; without the -90° X
        // rotation the arena renders as a wall the top-down camera sees edge-on.
        const renderer = await ReactThreeTestRenderer.create(
            <ActionGroundPlane ground={{ widthCells: 17, depthCells: 11 }} />,
        );
        try {
            const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;
            expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
            expect(mesh.rotation.y).toBe(0);
            expect(mesh.rotation.z).toBe(0);
            expect([mesh.position.x, mesh.position.y, mesh.position.z]).toEqual([0, 0, 0]);
        } finally {
            await renderer.unmount();
        }
    });
});
