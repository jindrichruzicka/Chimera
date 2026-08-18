'use client';

// renderer/components/scene/RouteEntryLoadingCover.tsx
//
// The ROUTE-ENTRY site of the loading cover (§4.36): what a route shows over
// the scene it has mounted but not revealed yet, while the critical asset
// preload settles.
//
// The second site of the same cover, after `SceneRouter`'s screen boundary, and
// the difference between them is what they stand in for. That one covers a
// screen React has suspended; this one covers a screen that mounted fine and
// would draw with half its textures missing. So this is NOT a Suspense
// fallback — it is a sibling layer, rendered ALONGSIDE the mounted shell,
// because a route that withheld the shell would orphan the `AssetManager` whose
// unique disposer that shell is (Invariant #21).
//
// The screen key is the one the ROUTE owns — `snapshot.sceneDefaultScreen ??
// registry.sceneDefaultScreens[sceneId] ?? 'playfield'`, the same cascade
// `SceneRouter` commits — and never `useActiveScreen()`. `uiStore` is a module
// singleton that `/game` never resets, and `setActiveSceneId` early-returns on
// an unchanged `sceneId`, so a second match would resolve the PREVIOUS match's
// key while its own scene is still loading.
//
// Architecture reference: §4.36 — scene loading covers.

import React from 'react';
import type { CSSProperties } from 'react';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { resolveLoadingScreen } from './resolveLoadingScreen.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';

export interface RouteEntryLoadingCoverProps {
    /** The active game's screen registry — the sole coupling point (Invariant #80). */
    readonly registry: GameScreenRegistry;
    /** The snapshot the route mounted its shell with; the scene being entered. */
    readonly snapshot: PlayerSnapshot;
    /**
     * Fade this cover out rather than showing it: set while its exit ramp runs
     * (§4.36). The caller unmounts the cover when the ramp ends.
     */
    readonly exiting?: boolean;
    /**
     * How long that ramp lasts, in milliseconds — `screenFadeMs()` at the call
     * sites, so it is `0` under the e2e flag and under reduced motion.
     *
     * Supplied for the cover's whole life, not only while `exiting`, so the
     * ramp is one property change against a declaration already in the
     * rendered style. `exiting` then moves opacity and nothing else.
     */
    readonly exitMs?: number;
}

/** The scene and screen key this cover stands in for — the route's own cascade. */
export interface RouteCoverTarget {
    readonly sceneId: string;
    readonly screenKey: string;
}

/**
 * The route-owned screen-key chain the header above states — hoisted so the
 * route pages can ask about the cover this component would resolve without
 * duplicating the cascade.
 */
export function resolveRouteCoverTarget(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
): RouteCoverTarget {
    const sceneId = String(snapshot.sceneId ?? 'engine:game');
    const screenKey =
        snapshot.sceneDefaultScreen ?? registry.sceneDefaultScreens?.[sceneId] ?? 'playfield';
    return { sceneId, screenKey };
}

/**
 * Whether this route's cover resolves a GAME-DECLARED form (§4.36): anything
 * the cascade yields except `undefined` (the engine's empty placeholder) and
 * the `'none'` opt-out. The minimum-visible hold arms only for a cover the
 * game chose to show — an empty placeholder held on screen is a wait with no
 * explanation.
 */
export function isRouteCoverGameDeclared(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
): boolean {
    const { screenKey } = resolveRouteCoverTarget(registry, snapshot);
    const cover = resolveLoadingScreen(registry, screenKey);
    return cover !== undefined && cover !== 'none';
}

// A layer, so each axis earns its place: `absolute`/`inset` fill the route's own
// positioned container rather than the viewport (on `/replays/player` that is
// the playfield wrapper, which sits under the transport controls);
// `--ch-z-loading-hud` puts it above the scene it covers; and `pointerEvents`
// keeps it a picture — a cover is handed no `sendAction` (§4.36), so it must
// not swallow a click aimed at whatever is underneath.
const coverLayerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 'var(--ch-z-loading-hud)',
    pointerEvents: 'none',
};

export function RouteEntryLoadingCover({
    registry,
    snapshot,
    exiting,
    exitMs,
}: RouteEntryLoadingCoverProps): React.ReactElement {
    const { sceneId, screenKey } = resolveRouteCoverTarget(registry, snapshot);
    // Composed rather than mutated: with neither exit prop supplied it carries
    // exactly the layer object's properties and nothing more, so a caller that
    // never fades renders what it rendered before these props existed.
    const layerStyle: CSSProperties = {
        ...coverLayerStyle,
        ...(exitMs === undefined || !(exitMs > 0)
            ? {}
            : { transition: `opacity ${exitMs}ms var(--ch-easing-standard)` }),
        ...(exiting === true ? { opacity: 0 } : {}),
    };

    return (
        <div data-testid="route-entry-loading-cover" style={layerStyle}>
            <SceneLoadingFallback
                registry={registry}
                screenKey={screenKey}
                sceneId={sceneId}
                reason="assets"
                progress={null}
            />
        </div>
    );
}
