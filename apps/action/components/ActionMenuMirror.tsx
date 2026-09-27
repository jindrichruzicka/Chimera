'use client';

import React from 'react';

import { useAsset } from '@chimera-engine/renderer/assets';

import { actionShellEnvironmentRefs } from '../shell-asset-manifest.js';

// The menu's mirror ball — a decorative sphere above the arena, lit by nothing
// but the environment map it reflects.
//
// It is here because a smooth metal is the one material that makes image-based
// lighting unmistakable. A physically-based metal has no diffuse term, so with
// no environment it renders near-black under any number of lights; what it shows
// IS the sky. That makes one frame enough to say the HDRI decoded, uploaded and
// lit a PBR material, with no before-and-after comparison to arrange.
//
// The map is applied to THIS MATERIAL rather than to `scene.environment`, which
// would light every standard material in the background at once. Two reasons:
// the arena's own primitives carry seat colours a reflection would wash out, and
// the shadow the key light casts is measured in pixels elsewhere against
// thresholds that assume the floor's current brightness.
//
// Three converts an equirectangular map to the pre-filtered form a physical
// material samples, so this needs no helper library and no manual pass.
//
// Module boundary: the renderer is reached only through its public barrels
// (Invariant #96) — here `assets`.

/** Where the ball hangs, in world units: above the arena, behind its midline. */
const MIRROR_POSITION = [0, 3.4, -2.5] as const;
/** Radius, in world units — about one and a half arena cells across. */
const MIRROR_ARGS = [0.75, 48, 32] as const;
/**
 * A mirror, not a tinted one. White at full metalness reflects the sky's own
 * colour, which is what the menu's pixels are read for; a tint would multiply
 * every hue by something before it reached the screen.
 */
const MIRROR_COLOR = 'white';
const MIRROR_ROUGHNESS = 0.08;

export function ActionMenuMirror(): React.ReactElement | null {
    const { asset: environmentMap } = useAsset(actionShellEnvironmentRefs.menuSky);

    if (environmentMap === null) {
        // Nothing to reflect yet. Rendering the ball anyway would put a black
        // circle over the arena for as long as the load takes.
        return null;
    }

    return (
        <mesh position={MIRROR_POSITION}>
            <sphereGeometry args={MIRROR_ARGS} />
            <meshStandardMaterial
                color={MIRROR_COLOR}
                metalness={1}
                roughness={MIRROR_ROUGHNESS}
                envMap={environmentMap}
            />
        </mesh>
    );
}
