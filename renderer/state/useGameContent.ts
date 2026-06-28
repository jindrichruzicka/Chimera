'use client';

// renderer/state/useGameContent.ts
//
// Generic, game-agnostic renderer hook that fetches a game's content collections
// from main (`window.__chimera.content.getCollections`) and caches them by gameId
// for the lifetime of the renderer process. The renderer holds the content as
// plain data only — it never reconstructs a live `ContentDatabase` (the renderer
// may only TYPE-import `simulation/content`). A concrete game's renderer surface
// interprets the collections itself (e.g. tactics derives its colour palette).
//
// Both the lobby page and the in-match game page call this so the content
// survives the lobby → game route transition without a refetch.

import { useEffect, useState } from 'react';
import type { ContentAPI, GameContent } from '@chimera-engine/simulation/bridge/api-types.js';

interface ContentBridge {
    readonly __chimera?: {
        readonly content?: ContentAPI;
    };
}

/** Extract the content namespace from the global bridge, or `null` when absent. */
export function getContentBridge(source: unknown = globalThis): ContentAPI | null {
    const bridge = source as ContentBridge;
    return bridge.__chimera?.content ?? null;
}

// Module-level cache keyed by gameId. A `null` value means "fetched, game has no
// content"; absence means "not yet fetched".
const contentCache = new Map<string, GameContent | null>();

/** Test support: clear the per-process content cache. */
export function resetGameContentCache(): void {
    contentCache.clear();
}

/**
 * Fetch and cache `gameId`'s content collections. Returns `undefined` while the
 * fetch is pending, when the bridge is unavailable, or when the game declares no
 * content — consumers fall back to their own defaults in that case.
 */
export function useGameContent(gameId: string | null | undefined): GameContent | undefined {
    // The returned value is derived synchronously from the cache (below) so it
    // always corresponds to the current `gameId`; this state only forces a
    // re-render once an async fetch settles the cache. Without the synchronous
    // derivation a gameId switch would briefly surface the previous game's
    // content until the next game's fetch resolved.
    const [, forceRerender] = useState(0);

    useEffect(() => {
        if (typeof gameId !== 'string' || contentCache.has(gameId)) {
            return;
        }

        const bridge = getContentBridge();
        if (bridge === null) {
            return;
        }

        let active = true;
        bridge
            .getCollections(gameId)
            .then((result) => {
                contentCache.set(gameId, result);
                if (active) {
                    forceRerender((tick) => tick + 1);
                }
            })
            .catch(() => {
                // Leave the failure uncached so a later mount can retry; the
                // derived value is already `undefined` (cache miss), so no
                // re-render is needed here.
            });

        return () => {
            active = false;
        };
    }, [gameId]);

    return typeof gameId === 'string' ? (contentCache.get(gameId) ?? undefined) : undefined;
}
