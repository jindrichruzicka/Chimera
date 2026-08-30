'use client';

import type { ThreeEvent } from '@react-three/fiber';
import React from 'react';

import type { ActionPrimitiveShape } from '../simulation/constants.js';
import type { ActionScenePrimitive } from './actionSceneModel.js';

// One movable primitive. The shape comes off the snapshot, so a cube stays a
// cube through a save/restore round trip rather than being re-derived from the
// entity id.
//
// Three colours, and the distinction they draw is the one a player needs:
// the primitive THIS viewer drives, a primitive another seat drives, and an
// unclaimed one. Colour literals for the same reason as the ground plane — a
// three.js material takes a colour value, not a CSS custom property.
const CONTROLLED_COLOR = '#f59e0b';
const OTHER_SEAT_COLOR = '#38bdf8';
const UNCLAIMED_COLOR = '#94a3b8';

/** Unit-ish geometry so a primitive sits one cell wide on the arena grid. */
const CUBE_ARGS = [0.8, 0.8, 0.8] as const;
const SPHERE_ARGS = [0.45, 24, 16] as const;
const CONE_ARGS = [0.45, 0.9, 24] as const;

export interface ActionPrimitiveMeshProps {
    readonly primitive: ActionScenePrimitive;
    /** True when the local viewer is the seat driving this primitive. */
    readonly isControlled: boolean;
    /**
     * In-scene selection: called with this primitive's entity id on click. The
     * playfield turns it into `action:select-primitive`; the host decides
     * whether the claim is legal, so this reports the click and judges nothing.
     */
    readonly onSelect: (entityId: string) => void;
}

function resolveColor(primitive: ActionScenePrimitive, isControlled: boolean): string {
    if (isControlled) return CONTROLLED_COLOR;
    return primitive.ownerId === null ? UNCLAIMED_COLOR : OTHER_SEAT_COLOR;
}

function ShapeGeometry({ shape }: { readonly shape: ActionPrimitiveShape }): React.ReactElement {
    switch (shape) {
        case 'sphere':
            return <sphereGeometry args={SPHERE_ARGS} />;
        case 'cone':
            return <coneGeometry args={CONE_ARGS} />;
        case 'cube':
        default:
            return <boxGeometry args={CUBE_ARGS} />;
    }
}

export function ActionPrimitiveMesh({
    primitive,
    isControlled,
    onSelect,
}: ActionPrimitiveMeshProps): React.ReactElement {
    const handleClick = (event: ThreeEvent<MouseEvent>): void => {
        // Stop the ray here so the click does not also reach the ground plane
        // behind the primitive.
        event.stopPropagation();
        onSelect(primitive.id);
    };

    return (
        <mesh castShadow name={primitive.id} position={primitive.world} onClick={handleClick}>
            <ShapeGeometry shape={primitive.shape} />
            <meshStandardMaterial
                color={resolveColor(primitive, isControlled)}
                metalness={0.1}
                roughness={0.6}
            />
        </mesh>
    );
}
