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
import { SceneLoadingFallback } from './SceneLoadingFallback.js';

export interface RouteEntryLoadingCoverProps {
    /** The active game's screen registry — the sole coupling point (Invariant #80). */
    readonly registry: GameScreenRegistry;
    /** The snapshot the route mounted its shell with; the scene being entered. */
    readonly snapshot: PlayerSnapshot;
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
}: RouteEntryLoadingCoverProps): React.ReactElement {
    const sceneId = String(snapshot.sceneId ?? 'engine:game');
    const screenKey =
        snapshot.sceneDefaultScreen ?? registry.sceneDefaultScreens?.[sceneId] ?? 'playfield';

    return (
        <div data-testid="route-entry-loading-cover" style={coverLayerStyle}>
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
