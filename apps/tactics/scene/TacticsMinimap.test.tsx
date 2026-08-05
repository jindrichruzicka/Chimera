// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import type { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { entityId, playerId } from '@chimera-engine/simulation/engine/types.js';
import {
    TACTICS_BOARD_HEIGHT_TILES,
    TACTICS_BOARD_WIDTH_TILES,
} from '@chimera-engine/tactics/simulation/constants.js';
import { gridToWorldPoint } from './tacticsSceneModel';
import { TacticsMinimap, type TacticsMinimapUnit } from './TacticsMinimap';

type TestInstance = ReactThreeTest.ReactThreeTestInstance;

function makeUnit(
    overrides: Partial<Omit<TacticsMinimapUnit, 'id'>> & {
        readonly id: string;
        readonly grid?: { readonly x: number; readonly y: number };
    },
): TacticsMinimapUnit {
    const grid = { x: overrides.grid?.x ?? 0, y: overrides.grid?.y ?? 0 };
    return {
        id: entityId(overrides.id),
        ownerId: overrides.ownerId ?? playerId('p1'),
        isAlive: overrides.isAlive ?? true,
        world: overrides.world ?? gridToWorldPoint(grid),
    };
}

describe('TacticsMinimap', () => {
    it('renders the ground readout plus one marker per living unit at its world position', async () => {
        const units = [
            makeUnit({ id: 'unit-1', grid: { x: 0, y: 0 } }),
            makeUnit({ id: 'unit-2', ownerId: playerId('p2'), grid: { x: 3, y: 1 } }),
        ];
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsMinimap
                units={units}
                boardColor="#123456"
                unitColorFor={(unit) => (unit.ownerId === playerId('p1') ? '#2563eb' : '#dc2626')}
            />,
        );

        try {
            const meshes = findThreeObjects(renderer.scene, 'Mesh');
            // 1 ground plane + 2 unit markers.
            expect(meshes).toHaveLength(3);

            const markers = meshes.slice(1).map((instance) => instance.instance as Mesh);
            const expectedFirst = units[0]?.world;
            const expectedSecond = units[1]?.world;
            expect(markers[0]?.position.x).toBe(expectedFirst?.x);
            expect(markers[0]?.position.z).toBe(expectedFirst?.z);
            expect(markers[1]?.position.x).toBe(expectedSecond?.x);
            expect(markers[1]?.position.z).toBe(expectedSecond?.z);
            // Markers sit ABOVE the ground readout (top-down view: below it
            // they vanish), with a visible flat extent.
            for (const marker of markers) {
                expect(marker?.position.y).toBe(0.2);
                const markerGeometry = marker.geometry as BoxGeometry;
                expect(markerGeometry.parameters.width).toBe(0.6);
                expect(markerGeometry.parameters.height).toBe(0.1);
                expect(markerGeometry.parameters.depth).toBe(0.6);
            }

            const colors = markers.map((marker) =>
                (marker.material as MeshBasicMaterial).color.getHexString(),
            );
            expect(colors).toEqual(['2563eb', 'dc2626']);

            // The ground readout frames exactly the board: the main scene's
            // centre offset, laid flat toward the top-down camera, at the
            // shared tile extent.
            const ground = meshes[0]?.instance as Mesh;
            expect((ground.material as MeshBasicMaterial).color.getHexString()).toBe('123456');
            expect(ground.position.toArray()).toEqual([1, -0.02, 0]);
            expect(ground.rotation.x).toBe(-Math.PI / 2);
            expect(ground.rotation.y).toBe(0);
            expect(ground.rotation.z).toBe(0);
            const groundGeometry = ground.geometry as PlaneGeometry;
            expect(groundGeometry.parameters.width).toBe(TACTICS_BOARD_WIDTH_TILES);
            expect(groundGeometry.parameters.height).toBe(TACTICS_BOARD_HEIGHT_TILES);
        } finally {
            await renderer.unmount();
        }
    });

    it('marks no dead unit — a stale marker would lie about the field', async () => {
        const units = [
            makeUnit({ id: 'unit-1' }),
            makeUnit({ id: 'unit-2', isAlive: false, grid: { x: 2, y: 2 } }),
        ];
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsMinimap units={units} boardColor="#123456" unitColorFor={() => '#2563eb'} />,
        );

        try {
            // 1 ground + 1 living marker; the dead unit contributes nothing.
            expect(findThreeObjects(renderer.scene, 'Mesh')).toHaveLength(2);
        } finally {
            await renderer.unmount();
        }
    });
});

function findThreeObjects(scene: TestInstance, type: string): TestInstance[] {
    return scene.findAll((instance) => instance.instance.type === type);
}
