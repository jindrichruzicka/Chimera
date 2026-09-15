'use client';

/**
 * renderer/components/r3f/LightingRig.tsx
 *
 * The engine's default light rig (§4.22): one ambient light and one directional
 * KEY light, mounted as a child of `<GameCanvas>`. A game mounts it instead of
 * hand-rolling the pair, and imports neither `three` nor `Canvas` to do so
 * (Invariant #127) — every prop is a plain number, tuple or flag.
 *
 * A default, not a monopoly. The rig renders ordinary r3f lights and suppresses
 * nothing, so a game's own lights mount beside it as siblings, and a game that
 * wants bespoke lighting skips the rig and writes its lights as before.
 *
 * `castShadow` is the LIGHT's half of the shadow switch. The canvas half is the
 * shadow quality `<GameCanvas>` resolves — camera-system.md §4.22 "Lighting".
 */

import React from 'react';
import type { Vector3Tuple } from '../../types/r3f-types.js';

export type LightingRigProps = Readonly<{
    /** Intensity of the ambient fill light; default `0.6`. */
    ambientIntensity?: number;
    /** Intensity of the directional key light; default `1`. */
    keyLightIntensity?: number;
    /** Where the key light sits; default `[5, 10, 5]`. */
    keyLightPosition?: Vector3Tuple;
    /** Whether the key light casts shadows; default `true`. */
    castShadow?: boolean;
}>;

const DEFAULT_AMBIENT_INTENSITY = 0.6;
const DEFAULT_KEY_LIGHT_INTENSITY = 1;
const DEFAULT_KEY_LIGHT_POSITION: Vector3Tuple = [5, 10, 5];

export function LightingRig({
    ambientIntensity = DEFAULT_AMBIENT_INTENSITY,
    keyLightIntensity = DEFAULT_KEY_LIGHT_INTENSITY,
    keyLightPosition = DEFAULT_KEY_LIGHT_POSITION,
    castShadow = true,
}: LightingRigProps): React.ReactElement {
    return (
        <>
            <ambientLight intensity={ambientIntensity} />
            <directionalLight
                intensity={keyLightIntensity}
                position={keyLightPosition}
                castShadow={castShadow}
            />
        </>
    );
}
