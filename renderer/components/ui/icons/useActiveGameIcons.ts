'use client';

// renderer/components/ui/icons/useActiveGameIcons.ts
//
// Resolves the active game's contributed icon glyphs for the app-wide
// <IconProvider>. The set reaches the provider ONLY through the registry shell
// seam (`icons` — never a direct `apps/*` import, Invariants #80/#94/#113),
// mirroring how useActiveGameTranslations resolves the game's bundles.
//
// A game-context change (new gameId) reloads the shell; a failed load or absent
// game resolves to `undefined` (engine icons only). Unlike i18n there is no
// locale dimension, so this is a plain gameId → set resolution.

import { useEffect, useState } from 'react';

import { loadRendererGameShell } from '../../../game/rendererGameRegistry';
import { useActiveShellGameId } from '../../../shell/useActiveShellGameId';
import type { GameIconSet } from './registry';

type LoadedIcons = Readonly<{
    gameId: string | null;
    icons: GameIconSet | undefined;
}>;

const EMPTY_LOADED: LoadedIcons = { gameId: null, icons: undefined };

/**
 * The active game's contributed icon set, loaded lazily from the registry shell
 * seam, or `undefined` when there is no game context or the game contributes
 * none (⇒ engine icons only).
 */
export function useActiveGameIcons(): GameIconSet | undefined {
    const gameId = useActiveShellGameId();
    const [loaded, setLoaded] = useState<LoadedIcons>(EMPTY_LOADED);

    useEffect(() => {
        if (gameId === null) {
            setLoaded(EMPTY_LOADED);
            return;
        }
        // Clear immediately so a gameId change never applies the previous game's
        // icons while the new shell load is still in flight.
        setLoaded(EMPTY_LOADED);
        let disposed = false;
        loadRendererGameShell(gameId)
            .then((shell) => {
                if (!disposed) {
                    setLoaded({ gameId, icons: shell.icons });
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLoaded({ gameId, icons: undefined });
                }
            });
        return () => {
            disposed = true;
        };
    }, [gameId]);

    // Ignore a stale in-flight result for a previous gameId.
    return loaded.gameId === gameId ? loaded.icons : undefined;
}
