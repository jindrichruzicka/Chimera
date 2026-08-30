'use client';

import React from 'react';

import type { ActionSceneGround } from './actionSceneModel.js';

// The arena floor. A plain lit plane in the XZ world plane, sized from the
// snapshot's own ground entity rather than from the arena constants — so a
// resized arena restored from a save renders at the size it was saved at.
//
// The size is the CELL COUNT, and both extents are inclusive, so a 17×11 arena
// spanning x ∈ [-8, 8] gets a 17×11 plane centred on the origin: every cell
// centre lands on an integer and the outermost cells keep a half-cell margin.
//
// Colours are literals rather than `var(--ch-*)` tokens because a three.js
// material takes a colour value, not a CSS custom property — which is also why
// this lives under `components/` rather than `screens/`, where
// `chimera/no-hardcoded-design-values` would (correctly) refuse them.
const GROUND_COLOR = '#1f2937';
const GROUND_POSITION = [0, 0, 0] as const;
/** Lay the plane flat: `planeGeometry` is authored in XY and faces +Z. */
const GROUND_ROTATION = [-Math.PI / 2, 0, 0] as const;

export interface ActionGroundPlaneProps {
    readonly ground: ActionSceneGround;
}

export function ActionGroundPlane({ ground }: ActionGroundPlaneProps): React.ReactElement {
    return (
        <mesh receiveShadow position={GROUND_POSITION} rotation={GROUND_ROTATION}>
            <planeGeometry args={[ground.widthCells, ground.depthCells]} />
            <meshStandardMaterial color={GROUND_COLOR} roughness={0.95} />
        </mesh>
    );
}
