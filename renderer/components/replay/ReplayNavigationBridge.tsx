'use client';

/**
 * renderer/components/replay/ReplayNavigationBridge.tsx (§4.28, F44 / T6, #660).
 *
 * App-wide listener that turns a main-process replay `navigate` push into a
 * client route change. `window.__chimera.replay.openInPlayer(path)` (called from
 * the replay browser now, and the Tactics main-menu / post-game UI in T7/T8)
 * makes main push the validated path; this bridge receives it via
 * `onNavigate` and routes to the player with the path as a query param.
 *
 * Mounted once in `AppShell` so the push is never missed by the
 * not-yet-mounted player route. Renders nothing.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getReplayBridge, useReplayApi } from '../../hooks/useReplayApi';

export function ReplayNavigationBridge(): null {
    const router = useRouter();
    const replayApi = useReplayApi();

    useEffect(() => {
        // Guard: in a non-Electron context (or before preload wiring) there is
        // no bridge to subscribe to — do nothing rather than throw.
        if (getReplayBridge() === null) {
            return;
        }
        return replayApi.onNavigate(({ path, kind }) => {
            // Push the canonical trailing-slash URL (next.config `trailingSlash:
            // true`). The player reads `?path=`/`?kind=` reactively via
            // `useSearchParams`, so it self-corrects once this soft navigation
            // commits the URL. `kind` selects the deterministic vs perspective
            // player surface — a perspective replay opened without it would load
            // through the deterministic surface and fail.
            router.push(
                `/replays/player/?path=${encodeURIComponent(path)}&kind=${encodeURIComponent(kind)}`,
            );
        });
    }, [replayApi, router]);

    return null;
}
