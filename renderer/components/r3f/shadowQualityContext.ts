'use client';

/**
 * renderer/components/r3f/shadowQualityContext.ts
 *
 * The shadow quality a `<GameCanvas>` resolved — the player's
 * `display.shadowQuality` tier under the game's `shadows` ceiling — handed
 * down to the lights inside that canvas.
 *
 * Shadow mapping has two halves: the canvas enables the map and picks its
 * type, and each light sizes its own map and decides whether it casts. The
 * canvas half is the `shadows` prop r3f is given; this context is how the light
 * half reads the SAME resolution, so a light never casts at a quality the canvas
 * did not enable. `GameCanvas` provides it inside the `<Canvas>`, around every
 * child, and `LightingRig` consumes it.
 *
 * Engine-internal: neither the context nor the hook is a barrel export.
 * Invariant #83: null default, and the consumer throws on null.
 */

import { createContext, useContext } from 'react';
import type { ShadowQuality } from './rendererConfig.js';

export const ShadowQualityContext = createContext<ShadowQuality | null>(null);

/**
 * The shadow quality the enclosing `<GameCanvas>` resolved.
 *
 * @throws if called outside a `<GameCanvas>` subtree.
 */
export function useCanvasShadowQuality(): ShadowQuality {
    const quality = useContext(ShadowQualityContext);
    if (quality === null) {
        throw new Error(
            'useCanvasShadowQuality must be called inside a <GameCanvas>. ' +
                'LightingRig sizes its shadow map from the quality the canvas resolved, ' +
                'so mount it as a child of <GameCanvas>.',
        );
    }
    return quality;
}
