// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { Mesh, MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityId } from '@chimera/simulation/engine/types.js';
import {
    TACTICS_UNIT_COLOR_BY_OWNERSHIP,
    TacticsUnitPrimitive,
    type TacticsUnitPrimitiveProps,
} from './TacticsUnitPrimitive';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

const UNIT_ID = entityId('unit-1');
const OWN_UNIT = {
    id: UNIT_ID,
    world: { x: 2, y: 0, z: -1 },
    ownership: 'own',
    isAlive: true,
} satisfies TacticsUnitPrimitiveProps['unit'];

const MOVED_OWN_UNIT = {
    ...OWN_UNIT,
    world: { x: 4, y: 0, z: 1 },
} satisfies TacticsUnitPrimitiveProps['unit'];

afterEach(() => {
    document.documentElement.style.removeProperty('--ch-duration-normal');
});

describe('TacticsUnitPrimitive', () => {
    it('renders a live unit at its world position with the provided ownership color', async () => {
        const renderer = await renderUnit({ isSelected: false });

        try {
            const group = findThreeObject(renderer.scene, 'Group');
            const [unitMesh] = findThreeObjects(renderer.scene, 'Mesh');

            expect(group.instance.position.toArray()).toEqual([2, 0.45, -1]);
            expect(unitMesh?.instance.scale.toArray()).toEqual([1, 1, 1]);
            expect(meshMaterial(unitMesh).color.getHexString()).toBe('2563eb');
            expect(findThreeObjects(renderer.scene, 'Mesh')).toHaveLength(1);
        } finally {
            await renderer.unmount();
        }
    });

    it('tweens visual position from the previous projection to the next without selecting', async () => {
        document.documentElement.style.setProperty('--ch-duration-normal', '250ms');
        const onSelect = vi.fn();
        const renderer = await renderUnit({ isSelected: false, onSelect });

        try {
            const group = findThreeObject(renderer.scene, 'Group');

            expect(group.instance.position.toArray()).toEqual([2, 0.45, -1]);

            await renderer.update(
                renderUnitElement({ unit: MOVED_OWN_UNIT, isSelected: false, onSelect }),
            );

            expect(group.instance.position.toArray()).toEqual([2, 0.45, -1]);

            await renderer.advanceFrames(1, 0.125);

            const inFlightPosition = group.instance.position.toArray();
            expect(inFlightPosition[0]).toBeGreaterThan(2);
            expect(inFlightPosition[0]).toBeLessThan(4);
            expect(inFlightPosition[1]).toBe(0.45);
            expect(inFlightPosition[2]).toBeGreaterThan(-1);
            expect(inFlightPosition[2]).toBeLessThan(1);

            await renderer.advanceFrames(1, 0.2);

            expect(group.instance.position.toArray()).toEqual([4, 0.45, 1]);
            expect(onSelect).not.toHaveBeenCalled();
        } finally {
            await renderer.unmount();
        }
    });

    it('completes visual movement immediately when motion duration tokens are disabled', async () => {
        document.documentElement.style.setProperty('--ch-duration-normal', '0ms');
        const renderer = await renderUnit({ isSelected: false });

        try {
            const group = findThreeObject(renderer.scene, 'Group');

            await renderer.update(renderUnitElement({ unit: MOVED_OWN_UNIT, isSelected: false }));

            expect(group.instance.position.toArray()).toEqual([4, 0.45, 1]);
        } finally {
            await renderer.unmount();
        }
    });

    it('starts remounted units at the current projected position', async () => {
        const renderer = await renderUnit({ isSelected: false });

        await renderer.unmount();

        const remountedRenderer = await renderUnit({ unit: MOVED_OWN_UNIT, isSelected: false });

        try {
            const group = findThreeObject(remountedRenderer.scene, 'Group');

            expect(group.instance.position.toArray()).toEqual([4, 0.45, 1]);
        } finally {
            await remountedRenderer.unmount();
        }
    });

    it('dispatches selection and stops propagation when clicked', async () => {
        const onSelect = vi.fn();
        const renderer = await renderUnit({ isSelected: false, onSelect });

        try {
            const unitMesh = findThreeObject(renderer.scene, 'Mesh');
            const stopPropagation = vi.fn();

            await renderer.fireEvent(unitMesh, 'click', { stopPropagation });

            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(onSelect).toHaveBeenCalledWith(UNIT_ID);
        } finally {
            await renderer.unmount();
        }
    });

    it('shows and hides the hover affordance ring on pointer movement', async () => {
        const renderer = await renderUnit({ isSelected: false });

        try {
            const unitMesh = findThreeObject(renderer.scene, 'Mesh');
            const stopPropagation = vi.fn();

            await renderer.fireEvent(unitMesh, 'pointerEnter', { stopPropagation });

            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(unitMesh?.instance.scale.toArray()).toEqual([1.12, 1.12, 1.12]);
            expect(meshColorHexes(renderer.scene)).toContain('facc15');

            await renderer.fireEvent(unitMesh, 'pointerLeave', { stopPropagation: vi.fn() });

            expect(unitMesh?.instance.scale.toArray()).toEqual([1, 1, 1]);
            expect(meshColorHexes(renderer.scene)).not.toContain('facc15');
        } finally {
            await renderer.unmount();
        }
    });

    it('shows a selected affordance ring without hover', async () => {
        const renderer = await renderUnit({ isSelected: true });

        try {
            const [unitMesh] = findThreeObjects(renderer.scene, 'Mesh');

            expect(unitMesh?.instance.scale.toArray()).toEqual([1.12, 1.12, 1.12]);
            expect(meshColorHexes(renderer.scene)).toEqual(['2563eb', 'ffffff']);
        } finally {
            await renderer.unmount();
        }
    });

    it('renders inactive units with the inactive color', async () => {
        const renderer = await renderUnit({ unit: { ...OWN_UNIT, isAlive: false } });

        try {
            const [unitMesh] = findThreeObjects(renderer.scene, 'Mesh');
            expect(meshMaterial(unitMesh).color.getHexString()).toBe('6b7280');
        } finally {
            await renderer.unmount();
        }
    });
});

async function renderUnit(options: {
    readonly unit?: TacticsUnitPrimitiveProps['unit'];
    readonly isSelected?: boolean;
    readonly onSelect?: TacticsUnitPrimitiveProps['onSelect'];
}): ReturnType<typeof ReactThreeTestRenderer.create> {
    return ReactThreeTestRenderer.create(renderUnitElement(options));
}

function renderUnitElement(options: {
    readonly unit?: TacticsUnitPrimitiveProps['unit'];
    readonly isSelected?: boolean;
    readonly onSelect?: TacticsUnitPrimitiveProps['onSelect'];
}): React.ReactElement {
    return (
        <TacticsUnitPrimitive
            unit={options.unit ?? OWN_UNIT}
            color={TACTICS_UNIT_COLOR_BY_OWNERSHIP.own}
            isSelected={options.isSelected ?? false}
            onSelect={options.onSelect ?? vi.fn()}
        />
    );
}

function findThreeObject(scene: TestInstance, type: string): TestInstance {
    return scene.find((node) => node.instance.type === type);
}

function findThreeObjects(scene: TestInstance, type: string): readonly TestInstance[] {
    return scene.findAll((node) => node.instance.type === type);
}

function meshMaterial(mesh: TestInstance | undefined): MeshStandardMaterial {
    expect(mesh?.instance.type).toBe('Mesh');
    return (mesh?.instance as Mesh).material as MeshStandardMaterial;
}

function meshColorHexes(scene: TestInstance): readonly string[] {
    return findThreeObjects(scene, 'Mesh').map((mesh) => meshMaterial(mesh).color.getHexString());
}
