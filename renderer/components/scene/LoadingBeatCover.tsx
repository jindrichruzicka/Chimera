'use client';

// renderer/components/scene/LoadingBeatCover.tsx
//
// The loading beat's cover (§4.36): the opaque surface a player looks at while
// a wait runs, and the only thing they look at.
//
// OPAQUE is the whole point. The cover this replaces declared no background, so
// it was a glyph over whatever stood behind it — which meant the only way to
// make it visible was to stop hiding the scene, and the spinner ended up over a
// live board. Painting its own backdrop makes "only the loading screen is
// visible" a property of this layer rather than of whatever happens to be
// beneath it.
//
// The screen key is the one the ROUTE owns — `snapshot.sceneDefaultScreen ??
// registry.sceneDefaultScreens[sceneId] ?? 'playfield'` — and never
// `useActiveScreen()`: `uiStore` is a module singleton the routes never reset,
// so a second match would resolve the previous match's key.
//
// Architecture reference: §4.36 — scene loading covers.

import React from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { resolveRouteCoverTarget } from './resolveLoadingScreen.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';

/**
 * Which surface this cover belongs to.
 *
 * `route` covers a route entry and is PORTALED to the document body: `AppShell`
 * wraps every route in its own stacking context, so a cover rendered inside it
 * carries a local z-index while the app scrim is a sibling above that context —
 * the scrim would paint over the cover. The beat needs the cover above the
 * curtain it holds, so the layer has to leave that context.
 *
 * `scene` covers an in-game transition and stays in the tree, below the app
 * curtain, which is correct: a route-level fade must still be able to cover a
 * scene hop already in progress.
 */
export type LoadingBeatSurface = 'route' | 'scene';

export interface LoadingBeatCoverProps {
    /** The active game's screen registry — the sole coupling point (Invariant #80). */
    readonly registry: GameScreenRegistry;
    /** The snapshot the surface mounted with; the scene being entered. */
    readonly snapshot: PlayerSnapshot;
    /** See {@link LoadingBeatSurface}. */
    readonly surface: LoadingBeatSurface;
    /** Whether the beat wants this cover at full opacity. */
    readonly visible: boolean;
    /**
     * How long the opacity ramp runs, in milliseconds — `screenFadeMs()` at the
     * call sites, so it is `0` under the e2e flag and under reduced motion.
     */
    readonly fadeMs: number;
}

/** The testid each surface keeps, because the recorded e2e timeline reads them. */
const SURFACE_TEST_ID: Record<LoadingBeatSurface, string> = {
    route: 'route-entry-loading-cover',
    scene: 'scene-preload-cover',
};

// `fixed`, not `absolute`: the cover stands in for the whole screen, and an
// absolute layer fills only its positioned ancestor — which on the replay route
// is the playfield wrapper, leaving the transport controls showing.
//
// It also SWALLOWS clicks, deliberately, where the transparent cover it
// replaces let them through. That rule existed because the old cover was a
// glyph over a live scene, so a click aimed at what showed through it had a
// real target. This one is opaque and covers everything: a click during the
// beat is aimed at something the player cannot see, and letting it land is the
// hazard rather than blocking it. The layer still receives no `sendAction`, so
// it does nothing with what it catches.
const coverLayerStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 'var(--ch-z-loading-hud)',
    backgroundColor: 'var(--ch-color-scrim)',
    display: 'grid',
    placeItems: 'center',
};

export function LoadingBeatCover({
    registry,
    snapshot,
    surface,
    visible,
    fadeMs,
}: LoadingBeatCoverProps): React.ReactElement {
    const ramps = fadeMs > 0;
    // Starts down when there is a ramp to run, so the browser has a value to
    // animate FROM; mounting already opaque gives it none and the cover appears
    // as a cut over the black. With no ramp there is nothing to animate and the
    // extra commit would only cost a frame.
    const [raised, setRaised] = React.useState(!ramps);

    React.useEffect(() => {
        if (!ramps) {
            return;
        }
        // Raised on the next FRAME, not in this flush. A passive effect can run
        // before the browser has painted, and a transition whose start and end
        // values land in the same paint is not animated at all — the cover
        // would appear as a cut over the black it is supposed to rise out of.
        const frame = requestAnimationFrame(() => {
            setRaised(true);
        });
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [ramps]);

    const { sceneId, screenKey } = resolveRouteCoverTarget(registry, snapshot);

    const layerStyle: CSSProperties = {
        ...coverLayerStyle,
        // Declared for the cover's whole life rather than at the moment opacity
        // moves, so each change is one property against a rendered declaration.
        ...(ramps ? { transition: `opacity ${fadeMs}ms var(--ch-easing-standard)` } : {}),
        opacity: visible && raised ? 1 : 0,
    };

    const layer = (
        <div data-testid={SURFACE_TEST_ID[surface]} style={layerStyle}>
            <SceneLoadingFallback
                registry={registry}
                screenKey={screenKey}
                sceneId={sceneId}
                reason="assets"
                progress={null}
            />
        </div>
    );

    return surface === 'route' ? createPortal(layer, document.body) : layer;
}
