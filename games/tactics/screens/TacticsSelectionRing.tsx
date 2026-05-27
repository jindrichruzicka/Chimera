'use client';

import React from 'react';

export interface TacticsSelectionRingProps {
    readonly color: string;
    readonly isVisible: boolean;
}

const RING_ROTATION = [-Math.PI / 2, 0, 0] as const;
const RING_POSITION = [0, 0.03, 0] as const;
const RING_GEOMETRY_ARGS = [0.48, 0.035, 12, 36] as const;

export function TacticsSelectionRing({
    color,
    isVisible,
}: TacticsSelectionRingProps): React.ReactElement | null {
    if (!isVisible) {
        return null;
    }

    return (
        <mesh position={RING_POSITION} rotation={RING_ROTATION}>
            <torusGeometry args={RING_GEOMETRY_ARGS} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
    );
}

export default TacticsSelectionRing;
