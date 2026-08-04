// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelInstance } from '@chimera-engine/renderer/assets';
import { useModelInstance } from '@chimera-engine/renderer/assets';

import { tacticsModelRefs } from '../asset-manifest.js';
import {
    SHOWCASE_POSE_RADIANS,
    TacticsModelShowcase,
    type TacticsModelShowcaseReport,
} from './TacticsModelShowcase.js';

vi.mock('@chimera-engine/renderer/assets', () => ({
    useModelInstance: vi.fn(),
}));

const useModelInstanceMock = vi.mocked(useModelInstance);

interface StubBone {
    readonly name: string;
    readonly rotation: { z: number };
}

function createStubInstance(uuid: string): { instance: ModelInstance; topBone: StubBone } {
    const topBone: StubBone = { name: 'top', rotation: { z: 0 } };
    const root = {
        uuid,
        getObjectByName: (name: string) => (name === 'top' ? topBone : undefined),
    };
    return { instance: { root, clips: [] } as unknown as ModelInstance, topBone };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

describe('TacticsModelShowcase', () => {
    it('mounts two instances of the single showcase ref, poses only A, and reports both', () => {
        const stubA = createStubInstance('uuid-a');
        const stubB = createStubInstance('uuid-b');
        useModelInstanceMock
            .mockReturnValueOnce({ instance: stubA.instance, loading: false, error: null })
            .mockReturnValueOnce({ instance: stubB.instance, loading: false, error: null });
        const reportsA: TacticsModelShowcaseReport[] = [];
        const reportsB: TacticsModelShowcaseReport[] = [];

        render(
            <TacticsModelShowcase
                onReportA={(report) => reportsA.push(report)}
                onReportB={(report) => reportsB.push(report)}
            />,
        );

        expect(useModelInstanceMock).toHaveBeenCalledTimes(2);
        for (const call of useModelInstanceMock.mock.calls) {
            expect(call[0]).toBe(tacticsModelRefs.showcaseRig);
        }
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
        // z swings its upper half ~0.7 sideways. At x=∓1.1 that gives
        // A x∈[-1.8,-0.65] and B x∈[0.65,1.55] — disjoint, and both inside the
        // screen camera's left/right ±2.4 frustum. Collapsing the two onto one
        // spot still satisfies the e2e magenta-pixel floor, so only this pins it.
        const stubA = createStubInstance('uuid-a');
        const stubB = createStubInstance('uuid-b');
        useModelInstanceMock
            .mockReturnValueOnce({ instance: stubA.instance, loading: false, error: null })
            .mockReturnValueOnce({ instance: stubB.instance, loading: false, error: null });

        const { container } = render(
            <TacticsModelShowcase onReportA={() => {}} onReportB={() => {}} />,
        );

        const positions = Array.from(container.querySelectorAll('primitive')).map((node) =>
            node.getAttribute('position'),
        );
        expect(positions).toEqual(['-1.1,0,0', '1.1,0,0']);
    });

    it('surfaces a load failure as the report errorName instead of throwing', () => {
        const error = new Error('undeclared');
        error.name = 'UnknownAssetManifestEntryError';
        useModelInstanceMock.mockReturnValue({ instance: null, loading: false, error });
        const reportsA: TacticsModelShowcaseReport[] = [];

        render(
            <TacticsModelShowcase
                onReportA={(report) => reportsA.push(report)}
                onReportB={() => {}}
            />,
        );

        expect(reportsA).toHaveLength(1);
        expect(reportsA[0]?.errorName).toBe('UnknownAssetManifestEntryError');
    });

    it('renders nothing and reports nothing while both instances are still loading', () => {
        useModelInstanceMock.mockReturnValue({ instance: null, loading: true, error: null });
        const reportsA: TacticsModelShowcaseReport[] = [];

        const { container } = render(
            <TacticsModelShowcase
                onReportA={(report) => reportsA.push(report)}
                onReportB={() => {}}
            />,
        );

        expect(reportsA).toHaveLength(0);
        expect(container.querySelector('primitive')).toBeNull();
    });
});
