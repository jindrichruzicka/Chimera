'use client';

// renderer/app/gameAssetSession.tsx
//
// Where a game-asset `AssetManager` is built for a renderer subtree.
//
// Every route that shows a game's assets needs the same manager: the default
// implementation, pointed at the `chimera://renderer/game-assets` protocol
// root, with the game's manifest registered at CONSTRUCTION (see
// `createAssetManager`'s JSDoc for why a passive-effect registration is
// provably too late for a child's first `load()`). `/game` and
// `/replays/player` each open-coded that triple; this module owns it.
//
// Two entry points, split by who disposes:
//
//   * `useRendererGameAssetManager` builds and memoises, and disposes
//     NOTHING. Its callers hand the manager to `<GameShell assetManager>`,
//     and GameShell is the unique disposer of a match-level manager
//     (Invariant #21). A dispose here would race that owner.
//   * `GameAssetSession` is for a subtree with no GameShell above it — a
//     game-owned page that renders assets outside a match, and the shell
//     background `ShellBackgroundHost` mounts on the shell surfaces. It
//     builds, publishes and DISPOSES, because nothing else will.
//
// Architecture reference: §4.10 Asset Reference System.

import React, { type ReactNode } from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { createAssetManager, type AssetManager } from '../assets/AssetManager';
import { AssetManagerContext } from '../assets/AssetManagerContext.js';
import { createRendererGameAssetResolver } from '../assets/AssetResolver';
import { startCriticalAssetPreload } from '../assets/criticalAssetPreload.js';
import type { LoadedRendererGame } from '../game/rendererGameRegistry';

/**
 * Builds a game-asset `AssetManager`, registering `assetManifest` when the
 * game declares one.
 *
 * `assetManifest` is optional because `LoadedRendererGame.assetManifest` is:
 * a game that declares no manifest still gets a manager, and every `load()`
 * through it rejects `UnknownAssetManifestEntryError` — which is the correct
 * outcome, and NOT the same as having no manager at all.
 *
 * Not memoised and not disposed — every caller is a React surface that owns
 * one or both of those, so keeping this a plain function leaves the lifetime
 * decision where it belongs.
 */
function createRendererGameAssetManager(assetManifest: AssetManifest | undefined): AssetManager {
    // Manifest at construction — see createAssetManager's JSDoc.
    return createAssetManager(createRendererGameAssetResolver(), assetManifest);
}

/**
 * Memoises one game-asset `AssetManager` per loaded renderer game, for a route
 * that passes it to `<GameShell assetManager>`.
 *
 * Keyed on the loaded GAME, not on its manifest: a game whose `assetManifest`
 * is absent must still get a manager (see
 * {@link createRendererGameAssetManager}), so a manifest-shaped `null` could
 * not tell "no game yet" from "game with no manifest" — collapsing the two
 * blanks the route.
 *
 * **Disposal is the injectee's**: GameShell disposes whatever manager it is
 * handed (Invariant #21), so this hook must not — a surface with no GameShell
 * wants {@link GameAssetSession} instead.
 *
 * This allocates in `useMemo`, which {@link GameAssetSession} deliberately does
 * not, and the difference is ownership. StrictMode double-invokes the factory
 * and discards one manager here too, and the allocate-and-dispose-in-effect
 * shape that removes that orphan is technically open to this hook — but taking
 * it would make the hook a disposer of the match-level manager, which
 * Invariant #21 reserves to `GameShell`. The orphan is accepted instead, and it
 * is inert: the discarded manager is never returned to the caller, so nothing
 * can `load()` through it — it holds manifest entries and no asset, its
 * `dispose()` would free nothing, and it is unreachable (hence collectable) the
 * moment the factory returns.
 */
export function useRendererGameAssetManager(
    loadedGame: Pick<LoadedRendererGame, 'assetManifest'> | null,
): AssetManager | null {
    return React.useMemo(
        () =>
            loadedGame === null ? null : createRendererGameAssetManager(loadedGame.assetManifest),
        [loadedGame],
    );
}

export interface GameAssetSessionProps {
    readonly assetManifest: AssetManifest;
    readonly children: ReactNode;
}

/**
 * Opens a self-contained game-asset session for a subtree that has no
 * `GameShell` above it, and publishes its manager to `useAssetManager()` /
 * `useAsset()` / `useModelInstance()` consumers in it. Mounted by a game-owned
 * Next page (through the `@chimera-engine/renderer/shell/gameAssetSession`
 * export), and by `ShellBackgroundHost` around a background whose game declared
 * `shellBackgroundAssets`.
 *
 * This is the second owner Invariant #21 names: it builds the manager AND
 * disposes it, on unmount and whenever the manifest identity changes, because
 * no GameShell exists to do either. It does **not** register itself as the
 * app-level `DelegatingAssetManager` delegate: publishing to a subtree and
 * binding the app-level manager are different reaches, and this component
 * performs only the first.
 *
 * The manager is allocated in a commit-phase effect, never during render:
 * StrictMode double-invokes render-phase factories and discards one result,
 * and a discarded render runs no cleanup — so a `useMemo`/`useState`-allocated
 * manager would leave an orphan that no dispose path can reach (the same
 * reason `useModelInstance` clones in an effect). The cost is that this
 * renders `null` until that effect commits, so `children` — and any DOM they
 * carry — appear one commit late.
 */
export function GameAssetSession({
    assetManifest,
    children,
}: GameAssetSessionProps): React.ReactElement | null {
    const [assetManager, setAssetManager] = React.useState<AssetManager | null>(null);

    React.useEffect(() => {
        const manager = createRendererGameAssetManager(assetManifest);
        setAssetManager(manager);
        // The §4.10 critical preload for a session with no `GameShell` above
        // it. GameShell runs the same warm-up for a match; nothing else would
        // run it here, so a game marking a ref critical for a route like this
        // would otherwise get the deferred behaviour it declared against.
        //
        // Started HERE, in the effect that owns the manager, rather than from
        // `useCriticalAssetPreload` beside it: React runs every cleanup before
        // every setup, so a separate effect's setup would read the PREVIOUS
        // manager out of state — the one this cleanup just disposed — and cache
        // the new manifest's critical assets into it, where no dispose path can
        // reach them (Invariant #21). Abandoning in this same cleanup is what
        // keeps the dispose's rejections out of the log; the two statements'
        // relative order does not matter, since the rejection lands a microtask
        // later than both.
        const abandonPreload = startCriticalAssetPreload(manager, assetManifest);

        return () => {
            abandonPreload();
            manager.dispose();
        };
    }, [assetManifest]);

    if (assetManager === null) {
        return null;
    }

    return (
        <AssetManagerContext.Provider value={assetManager}>{children}</AssetManagerContext.Provider>
    );
}
