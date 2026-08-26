'use client';

/**
 * renderer/components/shell/ShellStateBridge.tsx
 *
 * The SINGLE route-classification site (§4.37.18). It resolves the active
 * game's declared shell routes, turns the live route into a `ShellSurface`, and
 * publishes that — with the normalized pathname and the `?gameId=` context —
 * onto the shell-state store, where the background mount, the snapshot
 * navigation gate and a game's own pages read it.
 *
 * Nothing else in `renderer/` may derive either fact: a second pathname
 * source, gameId read or route-set membership test would agree with this one by
 * review rather than by construction, and the surface a background mounts on
 * and the surface a navigation gate admits have to be the same answer.
 * `renderer/shell/__tests__/route-classification-census.test.ts` holds both the
 * classifier and the store's route writer to one site.
 *
 * Two source choices are deliberate:
 *
 *   - The PATHNAME comes from `usePathname()` and NOT from `window.location`.
 *     Next updates the history entry in a passive effect after the navigation
 *     commits, so during the render that first sees the new pathname
 *     `window.location` still holds the OLD one — and since nothing re-renders
 *     this component afterwards, a `window.location` read would publish the
 *     route the player just left and stay there. Measured, not assumed: reading
 *     it there left the surface on `lobby` across the hop into `/game` and
 *     failed five e2e specs. Normalization handles the export spellings
 *     (`/game/`, `/game/index.html`) that a direct load reports.
 *   - The GAME CONTEXT comes from `useSearchParams()`, so a query-only change
 *     (`/main-menu` → `/main-menu?gameId=tactics`) is observed. That hook forces
 *     a Suspense boundary under `output: 'export'`, which is why `AppShell`
 *     mounts this component inside the same boundary as `ShellBackgroundHost`.
 *
 * Invariant #82 discipline: this component reads the router and the registry
 * shell seam. It opens no IPC channel, advances no tick and dispatches no
 * `EngineAction`.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { resolveShellGameId } from '../../shell/resolveMainMenuGameId';
import { setShellRoute } from '../../shell/shellStateStore';
import {
    classifyShellSurface,
    isEngineOwnedRoute,
    normalizeRoutePath,
    SHELL_BACKGROUND_SURFACES,
} from '../../shell/shellRoutes';

/**
 * The shared "nothing declared" value. A module-level constant rather than a
 * fresh `[]`, so the classification below compares equal across renders and the
 * publish stays a no-op while nothing has changed.
 */
const NO_SHELL_ROUTES: readonly string[] = Object.freeze([]);

/**
 * A resolved declaration, tagged with the game it was resolved FOR. Reading it
 * through that tag is what keeps a stale payload — a context change whose load
 * is still in flight — from classifying the next game's routes: it answers
 * NOTHING rather than the previous game's answer.
 */
interface ShellRouteDeclaration {
    readonly gameId: string | null;
    readonly routes: readonly string[];
}

const UNRESOLVED_DECLARATION: ShellRouteDeclaration = Object.freeze({
    gameId: null,
    routes: NO_SHELL_ROUTES,
});

export function ShellStateBridge(): null {
    const routerPathname = usePathname();
    const searchParams = useSearchParams();
    const search = searchParams.toString();
    const routePath = normalizeRoutePath(routerPathname);
    const gameId = React.useMemo(() => resolveShellGameId(new URLSearchParams(search)), [search]);

    // Where the declaration is worth fetching, decided WITHOUT it (it cannot
    // depend on itself): the routes the background already mounts on, plus
    // every route the engine does not ship — a candidate game page. Fetching on
    // the background routes is not eagerness: it is what makes the hop from
    // `/main-menu` onto a declared page classify on its FIRST commit, and a
    // classification that arrived a commit later would unmount the pinned
    // background instance and remount it (§4.37.17). Nothing is fetched on
    // `/game`, `/saves` or the replay routes, where no declaration can change
    // the answer.
    const baseSurface = classifyShellSurface(routePath, NO_SHELL_ROUTES);
    const shouldResolveDeclaration =
        gameId !== null &&
        (SHELL_BACKGROUND_SURFACES.has(baseSurface) || !isEngineOwnedRoute(routePath));
    const [declaration, setDeclaration] =
        React.useState<ShellRouteDeclaration>(UNRESOLVED_DECLARATION);

    React.useEffect(() => {
        if (!shouldResolveDeclaration || gameId === null) {
            return;
        }

        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setDeclaration({ gameId, routes: shell.shellRoutes ?? NO_SHELL_ROUTES });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setDeclaration({ gameId, routes: NO_SHELL_ROUTES });
                }
            });

        return () => {
            disposed = true;
        };
    }, [shouldResolveDeclaration, gameId]);

    // Read through the tag, never off the raw state: a declaration resolved for
    // another game declares nothing here.
    const declaredRoutes = declaration.gameId === gameId ? declaration.routes : NO_SHELL_ROUTES;
    const surface = classifyShellSurface(routePath, declaredRoutes);

    // A LAYOUT effect: React runs these synchronously after the commit. The
    // store publishes nothing when the route is unchanged, so running this on
    // every commit costs one comparison.
    React.useLayoutEffect(() => {
        setShellRoute({ surface, pathname: routePath, gameId });
    }, [surface, routePath, gameId]);

    return null;
}
