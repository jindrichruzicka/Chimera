'use client';

// renderer/shell/useActiveShellGameId.ts
//
// Resolves the active shell game id for renderer-wide providers (i18n, icons):
// the URL `?gameId=` wins everywhere, falling back to the store's `activeGameId`
// (set on lobby/game entry) so a direct-game boot that lands bare on `/game` or
// `/settings` still gets its game's translations and branding. `null` ⇒ no game
// context at all.
//
// EXCEPT on the lobby, which is URL-context-only. A session can be established
// with no `?gameId=` in the URL (Join needs none — the host's response carries
// the game), and that session's id alone must NOT pull the game's branding into
// an engine-default lobby. The branding a screen shows has to follow the context
// its URL declares, or the engine-default lobby silently becomes a game's.
//
// The URL is read from `window.location.search` in an effect keyed on the
// pathname (re-read on every navigation), NOT via `useSearchParams()`: that hook
// forces a Suspense boundary under `output: 'export'`, and these providers mount
// ABOVE any boundary. `usePathname()` carries no such constraint. This is the
// shared extraction of the resolver that useActiveGameTranslations once held
// privately; keep the `usePathname` (not `useSearchParams`) contract intact.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { resolveShellGameId } from './resolveMainMenuGameId';
import { useSettingsStore } from '../state/settingsStore';

/** The lobby route (the static export serves it with a trailing slash, so both
 *  spellings match): the one screen whose game branding follows the explicit
 *  `?gameId=` alone. */
function isLobbyPathname(pathname: string | null): boolean {
    return pathname === '/lobby' || pathname?.startsWith('/lobby/') === true;
}

export function useActiveShellGameId(): string | null {
    const pathname = usePathname();
    const activeGameId = useSettingsStore((state) => state.activeGameId);
    const [urlGameId, setUrlGameId] = useState<string | null>(null);

    useEffect(() => {
        setUrlGameId(resolveShellGameId(new URLSearchParams(window.location.search)));
    }, [pathname]);

    return urlGameId ?? (isLobbyPathname(pathname) ? null : activeGameId);
}
