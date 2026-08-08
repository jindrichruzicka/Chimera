'use client';

import React from 'react';

export interface TacticsSelectionRingProps {
    readonly color: string;
    readonly isVisible: boolean;
    /** Torus radius; defaults to the affordance-ring size. Smaller values nest inside it. */
    readonly radius?: number;
}

const RING_ROTATION = [-Math.PI / 2, 0, 0] as const;
const RING_POSITION = [0, 0.03, 0] as const;
const RING_DEFAULT_RADIUS = 0.48;
const RING_TUBE = 0.035;
const RING_RADIAL_SEGMENTS = 12;
const RING_TUBULAR_SEGMENTS = 36;

export function TacticsSelectionRing({
    color,
    isVisible,
    radius = RING_DEFAULT_RADIUS,
}: TacticsSelectionRingProps): React.ReactElement | null {
    if (!isVisible) {
        return null;
    }

    return (
        <mesh position={RING_POSITION} rotation={RING_ROTATION}>
            <torusGeometry
                args={[radius, RING_TUBE, RING_RADIAL_SEGMENTS, RING_TUBULAR_SEGMENTS]}
            />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
    );
}

export default TacticsSelectionRing;
