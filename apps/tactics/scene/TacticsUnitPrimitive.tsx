'use client';

import { useFrame, type ThreeEvent } from '@react-three/fiber';
import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Group } from 'three';
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

interface TacticsVisualPosition {
    readonly x: number;
    readonly z: number;
}

interface TacticsMovementTween {
    readonly from: TacticsVisualPosition;
    readonly to: TacticsVisualPosition;
    readonly elapsedMs: number;
    readonly durationMs: number;
}

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
    const groupRef = useRef<Group | null>(null);
    const visualPositionRef = useRef(toVisualPosition(unit.world));
    const targetPositionRef = useRef(toVisualPosition(unit.world));
    const unitIdRef = useRef(unit.id);
    const movementTweenRef = useRef<TacticsMovementTween | null>(null);
    const isAfforded = isHovered || isSelected;
    const unitColor = unit.isAlive ? color : TACTICS_UNIT_INACTIVE_COLOR;
    const ringColor = isSelected ? TACTICS_UNIT_SELECTED_RING_COLOR : TACTICS_UNIT_HOVER_RING_COLOR;
    const position = [
        visualPositionRef.current.x,
        UNIT_POSITION_Y,
        visualPositionRef.current.z,
    ] as const;

    useLayoutEffect(() => {
        const nextTarget = toVisualPosition(unit.world);
        const group = groupRef.current;

        if (unitIdRef.current !== unit.id) {
            unitIdRef.current = unit.id;
            targetPositionRef.current = nextTarget;
            movementTweenRef.current = null;
            visualPositionRef.current = nextTarget;
            applyVisualPosition(group, nextTarget);
            return;
        }

        if (areSameVisualPosition(targetPositionRef.current, nextTarget)) {
            return;
        }

        targetPositionRef.current = nextTarget;

        const fromPosition = visualPositionRef.current;
        const durationMs = resolveUnitMovementDurationMs();

        if (durationMs === 0 || areSameVisualPosition(fromPosition, nextTarget)) {
            movementTweenRef.current = null;
            visualPositionRef.current = nextTarget;
            applyVisualPosition(group, nextTarget);
            return;
        }

        movementTweenRef.current = {
            from: fromPosition,
            to: nextTarget,
            elapsedMs: 0,
            durationMs,
        };
    }, [unit.id, unit.world.x, unit.world.z]);

    useFrame((state, deltaSeconds) => {
        const movementTween = movementTweenRef.current;
        const group = groupRef.current;

        if (movementTween === null || group === null) {
            return;
        }

        const elapsedMs = movementTween.elapsedMs + Math.max(0, deltaSeconds * 1000);

        if (elapsedMs >= movementTween.durationMs) {
            movementTweenRef.current = null;
            visualPositionRef.current = movementTween.to;
            applyVisualPosition(group, movementTween.to);
            state.invalidate();
            return;
        }

        const progress = easeOutUnit(elapsedMs / movementTween.durationMs);
        const nextPosition = {
            x: lerpNumber(movementTween.from.x, movementTween.to.x, progress),
            z: lerpNumber(movementTween.from.z, movementTween.to.z, progress),
        } satisfies TacticsVisualPosition;

        visualPositionRef.current = nextPosition;
        movementTweenRef.current = { ...movementTween, elapsedMs };
        applyVisualPosition(group, nextPosition);
        state.invalidate();
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
        <group ref={groupRef} position={position}>
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

function toVisualPosition(
    world: Pick<TacticsSceneUnit['world'], 'x' | 'z'>,
): TacticsVisualPosition {
    return { x: world.x, z: world.z };
}

function applyVisualPosition(group: Group | null, position: TacticsVisualPosition): void {
    group?.position.set(position.x, UNIT_POSITION_Y, position.z);
}

function areSameVisualPosition(
    first: TacticsVisualPosition,
    second: TacticsVisualPosition,
): boolean {
    return first.x === second.x && first.z === second.z;
}

function lerpNumber(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function easeOutUnit(progress: number): number {
    const clampedProgress = clampUnit(progress);
    return clampedProgress * (2 - clampedProgress);
}

function clampUnit(value: number): number {
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
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
