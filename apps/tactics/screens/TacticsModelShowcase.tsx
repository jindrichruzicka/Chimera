'use client';

import React from 'react';
import { useModelInstance } from '@chimera-engine/renderer/assets';
import type { Object3D } from 'three';

import { tacticsModelRefs } from '../asset-manifest.js';

/**
 * One showcase instance's observable state, reported to the board so the DOM
 * status element (and through it the e2e spec) can assert what the canvas
 * cannot say on its own: that the two clones are DISTINCT scene-graph roots
 * and that posing one leaves the other unmoved.
 */
export interface TacticsModelShowcaseReport {
    readonly rootUuid: string;
    readonly topBonePoseZ: number;
    readonly errorName: string;
}

export interface TacticsModelShowcaseProps {
    readonly onReportA: (report: TacticsModelShowcaseReport) => void;
    readonly onReportB: (report: TacticsModelShowcaseReport) => void;
}

/** The bone the posed instance rotates; authored in showcase-rig.glb. */
const POSED_BONE_NAME = 'top';
export const SHOWCASE_POSE_RADIANS = Math.PI / 2;

// Board-plane placement (§4.22 camera: looking down -Y at the XZ plane).
// Bottom corners of the widened frustum, clear of the gameplay grid rows so
// the quads can never occlude a board click. The colour-count specs sample
// the WHOLE canvas — what keeps magenta out of their counts is classifier
// arithmetic (it fails the red/blue dominance deltas), pinned in
// e2e/helpers/canvas-pixels.test.ts, not this placement. The quad is
// authored in the XY plane facing +Z, so -PI/2 around X lays it onto the
// board plane facing the camera.
const MODEL_A_POSITION: readonly [number, number, number] = [-2.2, 0.02, -2.0];
const MODEL_B_POSITION: readonly [number, number, number] = [4.2, 0.02, -2.0];
const MODEL_ROTATION: readonly [number, number, number] = [-Math.PI / 2, 0, 0];

function findPosedBone(root: Object3D): Object3D | undefined {
    return root.getObjectByName(POSED_BONE_NAME);
}

interface ShowcaseModelProps {
    readonly position: readonly [number, number, number];
    readonly poseTopBone: boolean;
    readonly onReport: (report: TacticsModelShowcaseReport) => void;
}

function ShowcaseModel({
    position,
    poseTopBone,
    onReport,
}: ShowcaseModelProps): React.ReactElement | null {
    const { instance, error } = useModelInstance(tacticsModelRefs.showcaseRig);

    React.useEffect(() => {
        if (error !== null) {
            onReport({ rootUuid: '', topBonePoseZ: Number.NaN, errorName: error.name });
            return;
        }
        if (instance === null) {
            return;
        }
        const posedBone = findPosedBone(instance.root);
        if (poseTopBone && posedBone !== undefined) {
            posedBone.rotation.z = SHOWCASE_POSE_RADIANS;
        }
        onReport({
            rootUuid: instance.root.uuid,
            topBonePoseZ: posedBone?.rotation.z ?? Number.NaN,
            errorName: '',
        });
    }, [instance, error, poseTopBone, onReport]);

    if (instance === null) {
        return null;
    }
    return <primitive object={instance.root} position={position} rotation={MODEL_ROTATION} />;
}

/**
 * Model-seam adoption surface (§4.10): TWO instances of ONE `gltf-model` ref, mounted in the
 * live board canvas. This is the runtime proof of the model seam — the cached
 * gltf loads over `chimera://` through the webpack async chunk, and each
 * mount receives its own `SkeletonUtils` clone.
 *
 * A is posed, B is not, and B reads its own bone AFTER A's pose runs: both
 * instances resolve from the same in-flight load, so their publish commits
 * batch together and the report effects run in tree order (A first) within
 * one flush. Under the two known failure shapes the reports change — a
 * shared cached scene mounted twice collapses the two roots into one uuid,
 * and a plain `.clone()` shares the skeleton, so A's pose shows up in B's
 * read.
 */
export function TacticsModelShowcase({
    onReportA,
    onReportB,
}: TacticsModelShowcaseProps): React.ReactElement {
    return (
        <>
            <ShowcaseModel position={MODEL_A_POSITION} poseTopBone={true} onReport={onReportA} />
            <ShowcaseModel position={MODEL_B_POSITION} poseTopBone={false} onReport={onReportB} />
        </>
    );
}
