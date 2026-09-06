'use client';

import { type ThreeEvent } from '@react-three/fiber';
import React, { useState } from 'react';
import { useEntityInterpolation } from '@chimera-engine/renderer/components/r3f';
import type { TacticsSceneUnit } from './tacticsSceneModel.js';
import { TacticsSelectionRing } from './TacticsSelectionRing.js';

const TACTICS_UNIT_INACTIVE_COLOR = '#6b7280';
const TACTICS_UNIT_HOVER_RING_COLOR = '#facc15';
const TACTICS_UNIT_SELECTED_RING_COLOR = '#ffffff';
const UNIT_POSITION_Y = 0.45;
const UNIT_GEOMETRY_ARGS = [0.3, 0.36, 0.9, 20] as const;
const UNIT_NORMAL_SCALE = [1, 1, 1] as const;
const UNIT_AFFORDANCE_SCALE = [1.12, 1.12, 1.12] as const;
const DEFAULT_UNIT_MOVEMENT_DURATION_MS = 250;
const UNIT_MOVEMENT_DURATION_TOKEN = '--ch-duration-normal';

export interface TacticsUnitPrimitiveProps {
    readonly unit: Pick<TacticsSceneUnit, 'id' | 'world' | 'isAlive'>;
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

    // The engine seam, not a tween of this game's own: what it does between two
    // authoritative positions — and the one-beat presentation delay that buys —
    // is `useEntityInterpolation`'s contract. The board is turn-based, so the
    // duration is a motion token rather than a beat period, and it collapses to
    // 0 under reduced motion, which the hook reads as "apply on arrival".
    // Re-read only when the target moves: `getComputedStyle` on the document
    // element forces a style resolve, and every unit on the board renders
    // whenever any of them does.
    const durationMs = React.useMemo(
        () => resolveUnitMovementDurationMs(),
        [unit.world.x, unit.world.z],
    );
    const groupRef = useEntityInterpolation({
        entityId: unit.id,
        target: [unit.world.x, UNIT_POSITION_Y, unit.world.z],
        durationMs,
    });

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
        <group ref={groupRef}>
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

function resolveUnitMovementDurationMs(): number {
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        return DEFAULT_UNIT_MOVEMENT_DURATION_MS;
    }

    const tokenValue = window
        .getComputedStyle(window.document.documentElement)
        .getPropertyValue(UNIT_MOVEMENT_DURATION_TOKEN)
        .trim();

    return parseCssDurationMs(tokenValue) ?? DEFAULT_UNIT_MOVEMENT_DURATION_MS;
}

function parseCssDurationMs(value: string): number | null {
    if (value.endsWith('ms')) {
        return normalizeDurationMs(Number.parseFloat(value.slice(0, -2)));
    }
    if (value.endsWith('s')) {
        return normalizeDurationMs(Number.parseFloat(value.slice(0, -1)) * 1000);
    }
    return null;
}

function normalizeDurationMs(value: number): number | null {
    return Number.isFinite(value) && value >= 0 ? value : null;
}

export default TacticsUnitPrimitive;
