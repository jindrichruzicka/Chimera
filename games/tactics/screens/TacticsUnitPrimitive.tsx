'use client';

import type { ThreeEvent } from '@react-three/fiber';
import React, { useState } from 'react';
import type { TacticsSceneUnit } from './tacticsSceneModel.js';
import { TacticsSelectionRing } from './TacticsSelectionRing.js';

export const TACTICS_UNIT_COLOR_BY_OWNERSHIP = {
    own: '#2563eb',
    opponent: '#dc2626',
} as const;

const TACTICS_UNIT_INACTIVE_COLOR = '#6b7280';
const TACTICS_UNIT_HOVER_RING_COLOR = '#facc15';
const TACTICS_UNIT_SELECTED_RING_COLOR = '#ffffff';
const UNIT_POSITION_Y = 0.45;
const UNIT_GEOMETRY_ARGS = [0.3, 0.36, 0.9, 20] as const;
const UNIT_NORMAL_SCALE = [1, 1, 1] as const;
const UNIT_AFFORDANCE_SCALE = [1.12, 1.12, 1.12] as const;

export interface TacticsUnitPrimitiveProps {
    readonly unit: Pick<TacticsSceneUnit, 'id' | 'world' | 'ownership' | 'isAlive'>;
    readonly color: string;
    readonly isSelected: boolean;
    readonly onSelect: (unitId: TacticsSceneUnit['id']) => void;
}

export function TacticsUnitPrimitive({
    unit,
    color,
    isSelected,
    onSelect,
}: TacticsUnitPrimitiveProps): React.ReactElement {
    const [isHovered, setIsHovered] = useState(false);
    const isAfforded = isHovered || isSelected;
    const unitColor = unit.isAlive ? color : TACTICS_UNIT_INACTIVE_COLOR;
    const ringColor = isSelected ? TACTICS_UNIT_SELECTED_RING_COLOR : TACTICS_UNIT_HOVER_RING_COLOR;
    const position = [unit.world.x, UNIT_POSITION_Y, unit.world.z] as const;

    const handleClick = (event: ThreeEvent<MouseEvent>): void => {
        event.stopPropagation();
        onSelect(unit.id);
    };

    const handlePointerEnter = (event: ThreeEvent<PointerEvent>): void => {
        event.stopPropagation();
        setIsHovered(true);
    };

    const handlePointerLeave = (event: ThreeEvent<PointerEvent>): void => {
        event.stopPropagation();
        setIsHovered(false);
    };

    return (
        <group position={position}>
            <mesh
                castShadow
                scale={isAfforded ? UNIT_AFFORDANCE_SCALE : UNIT_NORMAL_SCALE}
                onClick={handleClick}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
            >
                <cylinderGeometry args={UNIT_GEOMETRY_ARGS} />
                <meshStandardMaterial color={unitColor} roughness={0.65} />
            </mesh>
            <TacticsSelectionRing color={ringColor} isVisible={isAfforded} />
        </group>
    );
}

export default TacticsUnitPrimitive;
