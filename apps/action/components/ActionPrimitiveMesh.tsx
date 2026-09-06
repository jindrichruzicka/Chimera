'use client';

import type { ThreeEvent } from '@react-three/fiber';
import React from 'react';

import { useEntityInterpolation } from '@chimera-engine/renderer/components/r3f';

import { ACTION_TICK_RATE_MS, type ActionPrimitiveShape } from '../simulation/constants.js';
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

/**
 * A move at least this far is drawn as a teleport, not a slide.
 *
 * A beat advances a primitive at most one cell per axis, so the longest walk
 * the arena can produce is a diagonal — √2 world units. This sits above that,
 * with room for the cell size to change without turning ordinary diagonals into
 * teleports.
 *
 * What the hook measures is the distance from where the primitive is DRAWN, not
 * from the cell it was last on. The slide lasts one beat, so the two normally
 * coincide by the time the next beat lands; where they do not — a frame budget
 * that lost several beats' worth of frames — the larger distance snapping is
 * the right outcome anyway.
 */
const PRIMITIVE_TELEPORT_SNAP_DISTANCE = 2;

/** Unit-ish geometry so a primitive sits one cell wide on the arena grid. */
const CUBE_ARGS = [0.8, 0.8, 0.8] as const;
const SPHERE_ARGS = [0.45, 24, 16] as const;
const CONE_ARGS = [0.45, 0.9, 24] as const;

export interface ActionPrimitiveMeshProps {
    readonly primitive: ActionScenePrimitive;
    /** True when the local viewer is the seat driving this primitive. */
    readonly isControlled: boolean;
    /**
     * In-scene selection: called with this primitive's entity id on click.
     * What a consumer does with it is the consumer's business. Which clicks
     * are reported at all is `handleClick`'s, and `ActionPrimitiveMesh.test.tsx`
     * measures it.
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
        // Re-picking what this viewer already drives is not reported —
        // `ActionPrimitiveMesh.test.tsx > reports no click on the primitive the
        // viewer already drives` is the pin.
        if (isControlled) return;
        onSelect(primitive.id);
    };

    // No `position` prop: the hook owns this mesh's transform and writes it
    // for as long as a slide is in flight. The arena advances a primitive a
    // whole cell per beat, so drawn straight from the snapshot it would step
    // ten times a second — and a diagonal beat would cover √2 world units at
    // once. What this trades for the smoothing is up to one beat of
    // presentation delay; anything that has to agree with the host reads
    // `primitive.grid`, not the mesh.
    const meshRef = useEntityInterpolation({
        entityId: primitive.id,
        target: primitive.world,
        // The same constant the manifest declares `tickRateMs` from
        // (`manifest.test.ts` measures that). It is the UNDILATED period: the
        // host scales its own beat by the live `timeScalePermille`, and this
        // does not follow.
        durationMs: ACTION_TICK_RATE_MS,
        snapDistance: PRIMITIVE_TELEPORT_SNAP_DISTANCE,
    });

    return (
        <mesh castShadow name={primitive.id} ref={meshRef} onClick={handleClick}>
            <ShapeGeometry shape={primitive.shape} />
            <meshStandardMaterial
                color={resolveColor(primitive, isControlled)}
                metalness={0.1}
                roughness={0.6}
            />
        </mesh>
    );
}
