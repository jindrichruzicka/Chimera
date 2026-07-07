'use client';

import type { ThreeEvent } from '@react-three/fiber';
import React from 'react';
import {
    TACTICS_BOARD_HEIGHT_TILES,
    TACTICS_BOARD_WIDTH_TILES,
} from '@chimera-engine/tactics/simulation/constants.js';
import {
    worldToGridPoint,
    type TacticsGridPoint,
    type TacticsWorldPoint,
} from './tacticsSceneModel.js';

export interface TacticsGroundPlaneProps {
    /** Host-configured board colour as a hex string; see `resolveTacticsBoardColor`. */
    readonly color: string;
    readonly onSelectGridPoint: (grid: TacticsGridPoint) => void;
    readonly onRevealGridPoint: (grid: TacticsGridPoint) => void;
}

// Centre offset for the playable grid; resizing the board (shared tile counts)
// also requires re-centring this position.
const GROUND_POSITION = [1, -0.02, 0] as const;
const GROUND_ROTATION = [-Math.PI / 2, 0, 0] as const;
const GROUND_GEOMETRY_ARGS = [TACTICS_BOARD_WIDTH_TILES, TACTICS_BOARD_HEIGHT_TILES] as const;

export function TacticsGroundPlane({
    color,
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
            <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
    );
}

function isShiftClick(event: ThreeEvent<MouseEvent>): boolean {
    const modifierEvent = event as Readonly<{ nativeEvent?: MouseEvent; shiftKey?: boolean }>;
    return modifierEvent.nativeEvent?.shiftKey ?? modifierEvent.shiftKey ?? false;
}

export default TacticsGroundPlane;
