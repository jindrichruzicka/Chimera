'use client';

import React from 'react';
import type { ComponentType } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { resolveShellGameId } from '../../shell/resolveMainMenuGameId';
import {
    isEngineOwnedRoute,
    matchesDeclaredShellRoute,
    normalizeRoutePath,
} from '../../shell/shellRoutes';

/**
 * The engine's own shell routes that carry the background (§4.37.9). A game
 * widens this set with `LoadedRendererGameShell.shellRoutes`, so the host mounts
 * on this set UNION the game's declared pages — which is what keeps ONE pinned
 * background instance alive across `/main-menu → /<game page> → /settings`.
 */
const SHELL_BACKGROUND_ROUTES = new Set(['/main-menu', '/settings', '/lobby']);

let nextShellBackgroundInstanceId = 1;

type LoadedShellBackground = Readonly<{
    gameId: string | null;
    Background: ComponentType | null;
    shellRoutes: readonly string[];
}>;

const NO_SHELL_ROUTES: readonly string[] = Object.freeze([]);

const UNRESOLVED: LoadedShellBackground = {
    gameId: null,
    Background: null,
    shellRoutes: NO_SHELL_ROUTES,
};

const hostStyle = {
    position: 'fixed',
    inset: 'var(--ch-space-none)',
    zIndex: 'var(--ch-z-base)',
    pointerEvents: 'none',
    overflow: 'hidden',
    backgroundColor: 'var(--ch-color-surface)',
} satisfies React.CSSProperties;

export function ShellBackgroundHost(): React.ReactElement | null {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const routePath = normalizeRoutePath(pathname);
    const search = searchParams.toString();
    // Whether the shell PAYLOAD is worth fetching here — decided before the
    // declaration can be read, so it cannot depend on it. An engine route
    // outside the background set (`/game`, `/saves`, …) is a page the engine
    // itself ships, so no declaration can make it a game page and the payload is
    // never fetched to ask. Every other route is a candidate.
    const shouldResolveShell =
        SHELL_BACKGROUND_ROUTES.has(routePath) || !isEngineOwnedRoute(routePath);
    const gameId = React.useMemo(
        () => (shouldResolveShell ? resolveShellGameId(new URLSearchParams(search)) : null),
        [shouldResolveShell, search],
    );
    const instanceIdRef = React.useRef(String(nextShellBackgroundInstanceId++));
    const [loadedBackground, setLoadedBackground] =
        React.useState<LoadedShellBackground>(UNRESOLVED);

    React.useEffect(() => {
        if (!shouldResolveShell || gameId === null) {
            setLoadedBackground(UNRESOLVED);
            return;
        }

        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoadedBackground({
                        gameId,
                        Background: shell.shellBackground ?? null,
                        shellRoutes: shell.shellRoutes ?? NO_SHELL_ROUTES,
                    });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoadedBackground({
                        gameId,
                        Background: null,
                        shellRoutes: NO_SHELL_ROUTES,
                    });
                }
            });

        return () => {
            disposed = true;
        };
    }, [gameId, shouldResolveShell]);

    // A payload answers only for the game context it was loaded for. Anything
    // else is stale — a context change whose load is still in flight, or a route
    // that dropped `?gameId=` before the effect above cleared the state — and a
    // stale payload answers NOTHING: neither which routes are declared nor which
    // component to paint. Read ONCE, through the destructuring below, so no later
    // line can reach past it to the raw state.
    const payloadIsForThisContext = loadedBackground.gameId === gameId;
    const { Background, shellRoutes: declaredRoutes } = payloadIsForThisContext
        ? loadedBackground
        : UNRESOLVED;

    const isShellBackgroundRoute =
        SHELL_BACKGROUND_ROUTES.has(routePath) ||
        matchesDeclaredShellRoute(routePath, declaredRoutes);

    if (!isShellBackgroundRoute) {
        return null;
    }

    // With a game in context, nothing is painted until that game's payload has
    // landed: an engine default drawn here would flash before the game's own
    // background replaced it a frame later.
    if (gameId !== null && !payloadIsForThisContext) {
        return null;
    }

    const backgroundKind = Background === null ? 'engine-default' : 'game';

    return (
        <div
            data-testid="shell-background"
            data-shell-background-kind={backgroundKind}
            data-shell-background-instance-id={instanceIdRef.current}
            data-shell-game-id={gameId ?? undefined}
            style={hostStyle}
            aria-hidden="true"
        >
            {Background === null ? null : <Background />}
        </div>
    );
}
