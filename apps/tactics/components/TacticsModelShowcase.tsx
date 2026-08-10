'use client';

import React from 'react';
import type { Object3D } from 'three';

/**
 * One showcase instance's observable state, reported to
 * `TacticsModelShowcaseScreen` so the DOM status element (and through it the
 * e2e spec) can assert what the canvas cannot say on its own: that the two
 * clones are DISTINCT scene-graph roots and that posing one leaves the other
 * unmoved.
 */
export interface TacticsModelShowcaseReport {
    readonly rootUuid: string;
    readonly topBonePoseZ: number;
    readonly errorName: string;
}

/**
 * A resolved model instance, flattened to what the scene needs.
 *
 * The screen owns the `useModelInstance` call and hands the outcome down, so
 * this component resolves nothing itself and mounts with no asset provider
 * above it — which is what lets its co-located test render it directly.
 * `root` is null while the load is in flight or has failed; `errorName` is ''
 * unless it did fail.
 */
export interface TacticsModelShowcaseInstance {
    readonly root: Object3D | null;
    readonly errorName: string;
}

export interface TacticsModelShowcaseProps {
    readonly instanceA: TacticsModelShowcaseInstance;
    readonly instanceB: TacticsModelShowcaseInstance;
    readonly onReportA: (report: TacticsModelShowcaseReport) => void;
    readonly onReportB: (report: TacticsModelShowcaseReport) => void;
}

/** The bone the posed instance rotates; authored in showcase-rig.glb. */
const POSED_BONE_NAME = 'top';
export const SHOWCASE_POSE_RADIANS = Math.PI / 2;

// Placement on the showcase screen's own camera (`TacticsModelShowcaseScreen`,
// looking straight down -Z). The quads are authored upright in the XY plane
// facing +Z, so they need no corrective rotation here; they are simply set
// side by side, far enough apart that the posed instance's sideways swing
// cannot overlap the unposed one — the e2e reads the pose off the scene graph,
// but an overlap would make the rendered frame unreadable to a human diagnosing
// a failure. This pair occupies the LEFT half of the frustum; the clip-player
// pair (`TacticsAnimatedShowcase`) has the right, at the same 1.7 spacing.
const MODEL_A_POSITION: readonly [number, number, number] = [-2.55, 0, 0];
const MODEL_B_POSITION: readonly [number, number, number] = [-0.85, 0, 0];

function findPosedBone(root: Object3D): Object3D | undefined {
    return root.getObjectByName(POSED_BONE_NAME);
}

interface ShowcaseModelProps extends TacticsModelShowcaseInstance {
    readonly position: readonly [number, number, number];
    readonly poseTopBone: boolean;
    readonly onReport: (report: TacticsModelShowcaseReport) => void;
}

function ShowcaseModel({
    root,
    errorName,
    position,
    poseTopBone,
    onReport,
}: ShowcaseModelProps): React.ReactElement | null {
    React.useEffect(() => {
        if (errorName !== '') {
            onReport({ rootUuid: '', topBonePoseZ: Number.NaN, errorName });
            return;
        }
        if (root === null) {
            return;
        }
        const posedBone = findPosedBone(root);
        if (poseTopBone && posedBone !== undefined) {
            posedBone.rotation.z = SHOWCASE_POSE_RADIANS;
        }
        onReport({
            rootUuid: root.uuid,
            topBonePoseZ: posedBone?.rotation.z ?? Number.NaN,
            errorName: '',
        });
    }, [root, errorName, poseTopBone, onReport]);

    if (root === null) {
        return null;
    }
    return <primitive object={root} position={position} />;
}

/**
 * Model-seam adoption surface (§4.10): TWO instances of ONE `gltf-model` ref,
 * mounted in the `/model-showcase/` route's canvas — a test-only screen no
 * in-app navigation reaches, so this geometry is in no gameplay frame. This is
 * the scene half of the runtime proof of the model seam; the screen resolves
 * the ref twice (the cached gltf loads over `chimera://` through the webpack
 * async chunk, and each call receives its own `SkeletonUtils` clone) and this
 * mounts, poses and reports what it is given.
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
    instanceA,
    instanceB,
    onReportA,
    onReportB,
}: TacticsModelShowcaseProps): React.ReactElement {
    return (
        <>
            <ShowcaseModel
                root={instanceA.root}
                errorName={instanceA.errorName}
                position={MODEL_A_POSITION}
                poseTopBone={true}
                onReport={onReportA}
            />
            <ShowcaseModel
                root={instanceB.root}
                errorName={instanceB.errorName}
                position={MODEL_B_POSITION}
                poseTopBone={false}
                onReport={onReportB}
            />
        </>
    );
}
