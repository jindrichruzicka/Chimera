// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Object3D } from 'three';

import {
    SHOWCASE_POSE_RADIANS,
    TacticsModelShowcase,
    type TacticsModelShowcaseInstance,
    type TacticsModelShowcaseReport,
} from './TacticsModelShowcase.js';

interface StubBone {
    readonly name: string;
    readonly rotation: { z: number };
}

/**
 * A scene-graph root double. The component reads exactly `uuid` and
 * `getObjectByName`, so the stub carries those and nothing else — mounting a
 * real `Object3D` here would test three.js.
 */
function createStubRoot(uuid: string): { root: Object3D; topBone: StubBone } {
    const topBone: StubBone = { name: 'top', rotation: { z: 0 } };
    const root = {
        uuid,
        getObjectByName: (name: string) => (name === 'top' ? topBone : undefined),
    };
    return { root: root as unknown as Object3D, topBone };
}

const LOADING: TacticsModelShowcaseInstance = { root: null, errorName: '' };

afterEach(() => {
    cleanup();
});

describe('TacticsModelShowcase', () => {
    it('poses only A, and reports both', () => {
        const stubA = createStubRoot('uuid-a');
        const stubB = createStubRoot('uuid-b');
        const reportsA: TacticsModelShowcaseReport[] = [];
        const reportsB: TacticsModelShowcaseReport[] = [];

        render(
            <TacticsModelShowcase
                instanceA={{ root: stubA.root, errorName: '' }}
                instanceB={{ root: stubB.root, errorName: '' }}
                onReportA={(report) => reportsA.push(report)}
                onReportB={(report) => reportsB.push(report)}
            />,
        );

        expect(reportsA).toEqual([
            { rootUuid: 'uuid-a', topBonePoseZ: SHOWCASE_POSE_RADIANS, errorName: '' },
        ]);
        expect(reportsB).toEqual([{ rootUuid: 'uuid-b', topBonePoseZ: 0, errorName: '' }]);
        // Posing A must write to A's OWN bone and leave B's untouched.
        expect(stubA.topBone.rotation.z).toBe(SHOWCASE_POSE_RADIANS);
        expect(stubB.topBone.rotation.z).toBe(0);
    });

    it('places the two quads apart, so the posed one cannot overlap the unposed one', () => {
        // Measured from showcase-rig.glb: each quad spans x ±0.45 about its
        // position and the `top` bone sits at y=0.7, so posing A by π/2 about
        // z swings its upper half ~0.7 sideways. At x=-2.55 and x=-0.85 that
        // gives A x∈[-3.25,-2.1] and B x∈[-1.3,-0.4] — disjoint, and both
        // inside the screen camera's left/right ±3.4 frustum. This pair holds
        // the LEFT half of that frustum; the clip-player pair holds the right.
        // Collapsing the two onto one spot still satisfies the e2e
        // magenta-pixel floor, so only this pins it.
        const stubA = createStubRoot('uuid-a');
        const stubB = createStubRoot('uuid-b');

        const { container } = render(
            <TacticsModelShowcase
                instanceA={{ root: stubA.root, errorName: '' }}
                instanceB={{ root: stubB.root, errorName: '' }}
                onReportA={() => {}}
                onReportB={() => {}}
            />,
        );

        const positions = Array.from(container.querySelectorAll('primitive')).map((node) =>
            node.getAttribute('position'),
        );
        expect(positions).toEqual(['-2.55,0,0', '-0.85,0,0']);
    });

    it('surfaces a load failure as the report errorName instead of throwing', () => {
        const failed: TacticsModelShowcaseInstance = {
            root: null,
            errorName: 'UnknownAssetManifestEntryError',
        };
        const reportsA: TacticsModelShowcaseReport[] = [];

        render(
            <TacticsModelShowcase
                instanceA={failed}
                instanceB={failed}
                onReportA={(report) => reportsA.push(report)}
                onReportB={() => {}}
            />,
        );

        expect(reportsA).toHaveLength(1);
        expect(reportsA[0]?.errorName).toBe('UnknownAssetManifestEntryError');
    });

    it('renders nothing and reports nothing while both instances are still loading', () => {
        const reportsA: TacticsModelShowcaseReport[] = [];

        const { container } = render(
            <TacticsModelShowcase
                instanceA={LOADING}
                instanceB={LOADING}
                onReportA={(report) => reportsA.push(report)}
                onReportB={() => {}}
            />,
        );

        expect(reportsA).toHaveLength(0);
        expect(container.querySelector('primitive')).toBeNull();
    });
});
