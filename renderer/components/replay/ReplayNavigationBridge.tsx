'use client';

/**
 * App-wide listener (§4.28) that turns a main-process replay `navigate` push into a
 * client route change. `window.__chimera.replay.openInPlayer(path)` makes main
 * push the validated path; this bridge receives it via
 * `onNavigate` and routes to the player with the path as a query param.
 *
 * Mounted once in `AppShell` so the push is never missed by the
 * not-yet-mounted player route. Renders nothing.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getReplayBridge, useReplayApi } from '../../hooks/useReplayApi';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';

export function ReplayNavigationBridge(): null {
    const router = useRouter();
    const replayApi = useReplayApi();

    useEffect(() => {
        // Guard: in a non-Electron context (or before preload wiring) there is
        // no bridge to subscribe to — do nothing rather than throw.
        if (getReplayBridge() === null) {
            return;
        }
        return replayApi.onNavigate(({ path, kind, saveable }) => {
            // Push the canonical trailing-slash URL (next.config `trailingSlash:
            // true`). The player reads `?path=`/`?kind=`/`?saveable=` reactively
            // via `useSearchParams`, so it self-corrects once this soft navigation
            // commits the URL. `kind` selects the deterministic vs perspective
            // player surface — a perspective replay opened without it would load
            // through the deterministic surface and fail. `saveable=1` (only for a
            // just-finished match) tells the player to show its save icon.
            const saveableQuery = saveable ? '&saveable=1' : '';
            const target = `/replays/player/?path=${encodeURIComponent(path)}&kind=${encodeURIComponent(kind)}${saveableQuery}`;
            // Carry the active `?gameId=` from the current URL onto the player
            // route. The shell (incl. the main-menu override) resolves only from
            // this param, and leaving the replay (saveable → returnToLobby via
            // GameStoreBootstrap, or library → /replays) re-reads it from the URL —
            // dropping it here lands the eventual menu on the engine default.
            const gameId = resolveShellGameId(new URLSearchParams(window.location.search));
            router.push(withShellGameId(target, gameId));
        });
    }, [replayApi, router]);

    return null;
}
