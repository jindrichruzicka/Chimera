'use client';

/**
 * renderer/shell/useShellNavigate.ts
 *
 * The game-facing navigation hook (§4.37.18), published on
 * `@chimera-engine/renderer/game`.
 *
 * It is the imperative twin of a menu declaration's `navigate` action: an
 * INSTANT hop that carries the active `?gameId=` context onto the target, which
 * is what keeps the game's shell — its background, its menu override, its
 * fonts and icons — resolving after the hop. A target that already names a
 * `gameId` is left alone, so a page can address another game deliberately.
 *
 * Deliberately no fade, and no per-target special case: the one route a fade
 * belongs on is the hop into a match, and no page pushes that itself —
 * `GameStoreBootstrap`'s snapshot gate owns it, fade included (§4.37.17). A
 * target check here would also make this a second route-classification site,
 * which §4.37.18 exists to prevent.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { withShellGameId } from './resolveMainMenuGameId';
import { useShellState } from './shellStateStore';

/** Navigate to a shell route, preserving the active game context. */
export type ShellNavigate = (target: string) => void;

export function useShellNavigate(): ShellNavigate {
    const router = useRouter();
    const gameId = useShellState((state) => state.gameId);

    return useCallback(
        (target: string): void => {
            router.push(withShellGameId(target, gameId));
        },
        [router, gameId],
    );
}
