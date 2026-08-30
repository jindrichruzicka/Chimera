'use client';

import React from 'react';

import type { ActionWorldPoint } from './actionSceneModel.js';

// The ring the shell background draws around a picked primitive — the visible
// half of the F87 draft, and the only thing that says which shape a seat is
// about to drive.
//
// A ring on the FLOOR rather than a recolour of the primitive itself: the shell
// has no session and no seats, so a primitive coloured as "yours" would be a
// claim about ownership that no snapshot backs. A marker beside it says the
// same thing about the PICK without saying anything about the match.
//
// Two colours, one per local seat, and neither is a `var(--ch-*)` token for the
// reason `ActionGroundPlane`'s are not: a three.js material takes a colour
// value, not a CSS custom property — which is also why this lives under
// `components/` rather than `shell/`.
const HOST_RING_COLOR = '#f59e0b';
const SECOND_RING_COLOR = '#a855f7';

/** Torus geometry: radius, tube, radial segments, tubular segments. */
const RING_ARGS = [0.72, 0.05, 8, 48] as const;
/** Lay the ring flat: `torusGeometry` is authored in XY. */
const RING_ROTATION = [-Math.PI / 2, 0, 0] as const;
/** Just above the floor, so the ring is not z-fighting the ground plane. */
const RING_HEIGHT = 0.02;
/** How brightly the ring glows against the unlit floor. */
const RING_EMISSIVE_INTENSITY = 0.6;

export interface ActionSelectionRingProps {
    /** The primitive's world position; the ring drops to the floor beneath it. */
    readonly at: ActionWorldPoint;
    /** Which local seat this ring belongs to. */
    readonly seat: 'host' | 'second';
}

export function ActionSelectionRing({ at, seat }: ActionSelectionRingProps): React.ReactElement {
    const color = seat === 'host' ? HOST_RING_COLOR : SECOND_RING_COLOR;

    return (
        <mesh
            name={`selection-ring-${seat}`}
            position={[at[0], RING_HEIGHT, at[2]]}
            rotation={RING_ROTATION}
        >
            <torusGeometry args={RING_ARGS} />
            <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={RING_EMISSIVE_INTENSITY}
            />
        </mesh>
    );
}
