// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TacticsGroundPlane } from './TacticsGroundPlane';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

const BOARD_COLOR = '#1e293b';

describe('TacticsGroundPlane', () => {
    it('renders the ground material with the provided board color', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsGroundPlane
                color={BOARD_COLOR}
                onSelectGridPoint={vi.fn()}
                onRevealGridPoint={vi.fn()}
            />,
        );

        try {
            const groundMesh = findThreeObject(renderer.scene, 'Mesh');
            expect(meshMaterial(groundMesh).color.getHexString()).toBe('1e293b');
        } finally {
            await renderer.unmount();
        }
    });

    it('maps clicked world positions to rounded grid points', async () => {
        const onSelectGridPoint = vi.fn();
        const onRevealGridPoint = vi.fn();
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsGroundPlane
                color={BOARD_COLOR}
                onSelectGridPoint={onSelectGridPoint}
                onRevealGridPoint={onRevealGridPoint}
            />,
        );

        try {
            const groundMesh = findThreeObject(renderer.scene, 'Mesh');
            const stopPropagation = vi.fn();

            await renderer.fireEvent(groundMesh, 'click', {
                point: { x: 1.4, y: -0.02, z: -0.6 },
                stopPropagation,
            });

            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(onSelectGridPoint).toHaveBeenCalledWith({ x: 1, y: -1 });
            expect(onRevealGridPoint).not.toHaveBeenCalled();
        } finally {
            await renderer.unmount();
        }
    });

    it('routes shift-clicked world positions to reveal grid selection', async () => {
        const onSelectGridPoint = vi.fn();
        const onRevealGridPoint = vi.fn();
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsGroundPlane
                color={BOARD_COLOR}
                onSelectGridPoint={onSelectGridPoint}
                onRevealGridPoint={onRevealGridPoint}
            />,
        );

        try {
            const groundMesh = findThreeObject(renderer.scene, 'Mesh');
            const stopPropagation = vi.fn();

            await renderer.fireEvent(groundMesh, 'click', {
                nativeEvent: { shiftKey: true },
                point: { x: 1.4, y: -0.02, z: -0.6 },
                stopPropagation,
            });

            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(onSelectGridPoint).not.toHaveBeenCalled();
            expect(onRevealGridPoint).toHaveBeenCalledWith({ x: 1, y: -1 });
        } finally {
            await renderer.unmount();
        }
    });
});

function findThreeObject(scene: TestInstance, type: string): TestInstance {
    return scene.find((node) => node.instance.type === type);
}

function meshMaterial(mesh: TestInstance | undefined): MeshStandardMaterial {
    expect(mesh?.instance.type).toBe('Mesh');
    return (mesh?.instance as Mesh).material as MeshStandardMaterial;
}
