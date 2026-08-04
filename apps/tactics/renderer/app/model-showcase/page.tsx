import { notFound } from 'next/navigation';
import React from 'react';
import { GameAssetSession } from '@chimera-engine/renderer/shell/gameAssetSession';

import { tacticsAssetManifest } from '@chimera-engine/tactics/asset-manifest.js';
import { TacticsModelShowcaseScreen } from '@chimera-engine/tactics/screens/TacticsModelShowcaseScreen.js';
import { isModelShowcaseEnabled } from './showcaseRouteGate.js';

/**
 * Model showcase — the tactics app's own test-only route (§4.10).
 *
 * Unlike every sibling route here, this is NOT a re-export of an engine shell
 * page: the screen it mounts is this game's, built on this game's asset
 * manifest, so the engine has nothing to contribute. Why the screen is
 * isolated on its own route: see `TacticsModelShowcaseScreen`. Why it 404s
 * when packaged: see `showcaseRouteGate.ts`.
 *
 * `<GameAssetSession>` is what makes this work outside a match. `useModelInstance`
 * needs a game `AssetManager`, and the app-level provider holds a delegating
 * manager whose delegate only `GameShell` sets — so on a bare route every load
 * would reject `NoActiveGameSessionError`. The session builds, publishes and
 * disposes a real game-asset manager for the manifest below (Invariant #21).
 */
export default function TacticsModelShowcasePage(): React.ReactElement {
    if (!isModelShowcaseEnabled()) {
        notFound();
    }

    return (
        <GameAssetSession assetManifest={tacticsAssetManifest}>
            <TacticsModelShowcaseScreen />
        </GameAssetSession>
    );
}
