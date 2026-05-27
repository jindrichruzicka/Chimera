'use client';

import type { ThreeEvent } from '@react-three/fiber';
import React from 'react';
import {
    worldToGridPoint,
    type TacticsGridPoint,
    type TacticsWorldPoint,
} from './tacticsSceneModel.js';

export interface TacticsGroundPlaneProps {
    readonly onSelectGridPoint: (grid: TacticsGridPoint) => void;
    readonly onRevealGridPoint: (grid: TacticsGridPoint) => void;
}

const GROUND_POSITION = [1, -0.02, 0] as const;
const GROUND_ROTATION = [-Math.PI / 2, 0, 0] as const;
const GROUND_GEOMETRY_ARGS = [6, 4] as const;
const TACTICS_GROUND_COLOR = '#3f3f46';

export function TacticsGroundPlane({
    onSelectGridPoint,
    onRevealGridPoint,
}: TacticsGroundPlaneProps): React.ReactElement {
    const handleClick = (event: ThreeEvent<MouseEvent>): void => {
        event.stopPropagation();
        const point = {
            x: event.point.x,
            y: event.point.y,
            z: event.point.z,
        } satisfies TacticsWorldPoint;
        const grid = worldToGridPoint(point);
        if (isShiftClick(event)) {
            onRevealGridPoint(grid);
            return;
        }

        onSelectGridPoint(grid);
    };

    return (
        <mesh
            receiveShadow
            position={GROUND_POSITION}
            rotation={GROUND_ROTATION}
            onClick={handleClick}
        >
            <planeGeometry args={GROUND_GEOMETRY_ARGS} />
            <meshStandardMaterial color={TACTICS_GROUND_COLOR} roughness={0.95} />
        </mesh>
    );
}

function isShiftClick(event: ThreeEvent<MouseEvent>): boolean {
    const modifierEvent = event as Readonly<{ nativeEvent?: MouseEvent; shiftKey?: boolean }>;
    return modifierEvent.nativeEvent?.shiftKey ?? modifierEvent.shiftKey ?? false;
}

export default TacticsGroundPlane;
