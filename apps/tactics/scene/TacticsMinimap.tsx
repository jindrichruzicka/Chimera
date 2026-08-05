'use client';

import React from 'react';
import {
    TACTICS_BOARD_HEIGHT_TILES,
    TACTICS_BOARD_WIDTH_TILES,
} from '@chimera-engine/tactics/simulation/constants.js';
import type { TacticsSceneUnit } from './tacticsSceneModel.js';

/**
 * The unit fields the minimap renders (plus `ownerId`, which the board's
 * colour resolver reads) — never the whole scene unit, per the renderer rule
 * that R3F components take only the fields they render. `TacticsSceneUnit`
 * satisfies this structurally, so the board hands over the same parsed array.
 */
export type TacticsMinimapUnit = Pick<TacticsSceneUnit, 'id' | 'ownerId' | 'world' | 'isAlive'>;

export interface TacticsMinimapProps {
    /** The board's parsed units — the SAME array the main scene renders. */
    readonly units: readonly TacticsMinimapUnit[];
    /** Host-configured board colour, as resolved for the main ground plane. */
    readonly boardColor: string;
    /** Resolves a unit's marker colour — the board passes its own resolver. */
    readonly unitColorFor: (unit: TacticsMinimapUnit) => string;
}

// Mirrors the main scene's ground constants (TacticsGroundPlane): the same
// centre offset and tile extent, so the minimap frames exactly the board.
const GROUND_POSITION = [1, -0.02, 0] as const;
const GROUND_ROTATION = [-Math.PI / 2, 0, 0] as const;
const GROUND_GEOMETRY_ARGS = [TACTICS_BOARD_WIDTH_TILES, TACTICS_BOARD_HEIGHT_TILES] as const;

// Markers sit above the ground readout; flat boxes read cleanly top-down.
const MARKER_POSITION_Y = 0.2;
const MARKER_GEOMETRY_ARGS = [0.6, 0.1, 0.6] as const;

/**
 * Simplified top-down board readout for the minimap overlay canvas: the
 * ground plane plus one flat marker per LIVING unit (a dead unit's marker
 * would lie about the field). Non-interactive by design — no handlers, no
 * lights (`meshBasicMaterial` is unlit), no per-frame work.
 */
export function TacticsMinimap({
    units,
    boardColor,
    unitColorFor,
}: Readonly<TacticsMinimapProps>): React.ReactElement {
    return (
        <>
            <mesh position={GROUND_POSITION} rotation={GROUND_ROTATION}>
                <planeGeometry args={GROUND_GEOMETRY_ARGS} />
                <meshBasicMaterial color={boardColor} />
            </mesh>
            {units
                .filter((unit) => unit.isAlive)
                .map((unit) => (
                    <mesh key={unit.id} position={[unit.world.x, MARKER_POSITION_Y, unit.world.z]}>
                        <boxGeometry args={MARKER_GEOMETRY_ARGS} />
                        <meshBasicMaterial color={unitColorFor(unit)} />
                    </mesh>
                ))}
        </>
    );
}

export default TacticsMinimap;
