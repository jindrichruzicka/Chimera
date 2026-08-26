'use client';

// renderer/shell/useGameShellRoutes.ts
//
// The active game's declared shell routes (`LoadedRendererGameShell.shellRoutes`,
// §4.37.17), resolved from the registry shell seam — never from an `apps/*`
// import (Invariants #80/#94).
//
// The game context is the URL's `?gameId=` and nothing else, the same contract
// `ShellBackgroundHost` reads shell background context on: a page reached
// without it has no game context, so nothing is declared and nothing matches.
//
// The declaration arrives ASYNCHRONOUSLY. Every consumer therefore sees the
// empty set first and the resolved set later, and must re-evaluate on the
// change: a reload straight onto a game page can deliver a live match snapshot
// before the shell payload is known, and a gate that read this once would leave
// the player stranded on a custom page with a match running.
//
// Two things this hook deliberately does NOT do:
//
//   * It never loads on a route the ENGINE ships. No declaration can turn
//     `/game` into a game page, so the answer there is the empty set without a
//     payload — which keeps the match route's shell load exactly as it was.
//   * It reads the URL from `window.location.search` inside an effect keyed on
//     the pathname rather than through `useSearchParams()`, the same contract
//     `useActiveShellGameId` documents: that hook forces a Suspense boundary
//     under `output: 'export'`.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { loadRendererGameShell } from '../game/rendererGameRegistry';
import { resolveShellGameId } from './resolveMainMenuGameId';
import { isEngineOwnedRoute } from './shellRoutes';

/**
 * The shared "nothing declared" value. A module-level constant rather than a
 * fresh `[]`, so a consumer that lists the result in an effect dependency list
 * does not re-run its effect on every render.
 */
const NO_SHELL_ROUTES: readonly string[] = Object.freeze([]);

/**
 * The active game's declared shell routes, or the empty set while the shell
 * payload is unresolved, the game declares none, the load fails, or the route
 * is one the engine itself ships.
 */
export function useGameShellRoutes(): readonly string[] {
    const pathname = usePathname();
    const [shellRoutes, setShellRoutes] = useState<readonly string[]>(NO_SHELL_ROUTES);

    useEffect(() => {
        const gameId = resolveShellGameId(new URLSearchParams(window.location.search));
        if (gameId === null || isEngineOwnedRoute(pathname)) {
            setShellRoutes(NO_SHELL_ROUTES);
            return;
        }

        // Cleared up front so a game-context change never reports the PREVIOUS
        // game's routes while the new payload is still in flight.
        setShellRoutes(NO_SHELL_ROUTES);
        let disposed = false;

        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setShellRoutes(shell.shellRoutes ?? NO_SHELL_ROUTES);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setShellRoutes(NO_SHELL_ROUTES);
                }
            });

        return () => {
            disposed = true;
        };
    }, [pathname]);

    return shellRoutes;
}
