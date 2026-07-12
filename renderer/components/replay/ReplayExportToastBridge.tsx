'use client';

/**
 * App-wide listener (§4.30) that turns a main-process replay-export-completed push into
 * a "Replay saved" toast. The save affordance is the replay player's compact save
 * icon (a `'save'`-intent `export-current-match`); main pushes
 * `chimera:replay:exported` once that export resolves, and this bridge — a
 * renderer module that *is* allowed to use `toastStore` — raises the toast. The
 * toast is engine-wired this way (rather than fired optimistically by the player)
 * so it confirms the authoritative on-disk save, not just the click (§4.30).
 *
 * Mounted once in `AppShell` (sibling of `ReplayNavigationBridge`) so the push
 * is never missed. Renders nothing.
 */

import { useEffect } from 'react';
import { getReplayBridge, useReplayApi } from '../../hooks/useReplayApi';
import { useToastStore } from '../../state/toastStore';

export function ReplayExportToastBridge(): null {
    const replayApi = useReplayApi();

    useEffect(() => {
        // Guard: in a non-Electron context (or before preload wiring) there is
        // no bridge to subscribe to — do nothing rather than throw.
        if (getReplayBridge() === null) {
            return;
        }
        return replayApi.onExported(() => {
            // §4.30 engine-wired source. Static title, no body — toast content is
            // not derived from the pushed path (Invariant #74); duration is the
            // severity default.
            useToastStore.getState().push({ severity: 'success', title: 'Replay saved' });
        });
    }, [replayApi]);

    return null;
}
