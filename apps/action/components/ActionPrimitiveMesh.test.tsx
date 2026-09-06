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

    it('slides between two cells instead of stepping, and lands on the new one', async () => {
        // The arena advances a primitive a whole cell per beat, so drawn
        // straight from the snapshot it would jump ten times a second. The
        // mid-beat sample is the measurement that matters: strictly BETWEEN the
        // two cells, on both axes it moved.
        // The longest move a beat can make: one cell on BOTH axes.
        const from = makePrimitive({ grid: { x: 2, y: -1 } });
        const to = makePrimitive({
            grid: { x: 3, y: 0 },
            world: arenaToWorld({ x: 3, y: 0 }, ACTION_PRIMITIVE_HEIGHT),
        });
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh primitive={from} isControlled={false} onSelect={vi.fn()} />,
        );
        try {
            const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;
            expect(mesh.position.toArray()).toEqual([2, ACTION_PRIMITIVE_HEIGHT, -1]);

            await renderer.update(
                <ActionPrimitiveMesh primitive={to} isControlled={false} onSelect={vi.fn()} />,
            );
            // A beat is 100 ms; a frame partway in must show the primitive
            // partway across.
            await renderer.advanceFrames(1, 0.03);

            const midBeat = mesh.position.toArray();
            expect(midBeat[0]).toBeGreaterThan(2);
            expect(midBeat[0]).toBeLessThan(3);
            expect(midBeat[2]).toBeGreaterThan(-1);
            expect(midBeat[2]).toBeLessThan(0);
            expect(midBeat[1]).toBe(ACTION_PRIMITIVE_HEIGHT);

            await renderer.advanceFrames(1, 0.2);

            expect(mesh.position.toArray()).toEqual([3, ACTION_PRIMITIVE_HEIGHT, 0]);
        } finally {
            await renderer.unmount();
        }
    });

    it('snaps rather than slides across a jump no beat could have made', async () => {
        // A restore, or a rules teleport, moves further in one step than a beat
        // can. Sliding it would draw a path across the arena the simulation
        // never took — so the snap threshold sits above the longest real move,
        // a one-cell diagonal.
        const from = makePrimitive({ grid: { x: 2, y: -1 } });
        const teleported = makePrimitive({
            grid: { x: 9, y: 6 },
            world: arenaToWorld({ x: 9, y: 6 }, ACTION_PRIMITIVE_HEIGHT),
        });
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh primitive={from} isControlled={false} onSelect={vi.fn()} />,
        );
        try {
            const mesh = findByType(renderer.scene, 'Mesh').instance as Mesh;

            await renderer.update(
                <ActionPrimitiveMesh
                    primitive={teleported}
                    isControlled={false}
                    onSelect={vi.fn()}
                />,
            );
            await renderer.advanceFrames(1, 0.001);

            expect(mesh.position.toArray()).toEqual([9, ACTION_PRIMITIVE_HEIGHT, 6]);
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

    it('reports no click on the primitive the viewer already drives', async () => {
        // Re-picking what you already drive is a no-op the simulation refuses
        // (`already_controlled`). Dispatching it anyway would take the host's
        // rejection arm and write a warn line per click, so the click is not
        // reported. The ray still stops here — the ground plane sits behind.
        const onSelect = vi.fn();
        const renderer = await ReactThreeTestRenderer.create(
            <ActionPrimitiveMesh
                primitive={makePrimitive({ id: 'primitive-cone' })}
                isControlled
                onSelect={onSelect}
            />,
        );
        try {
            const stopPropagation = vi.fn();
            await renderer.fireEvent(findByType(renderer.scene, 'Mesh'), 'click', {
                stopPropagation,
            });

            expect(onSelect).not.toHaveBeenCalled();
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
