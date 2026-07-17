'use client';

// renderer/shell/useActiveShellGameId.ts
//
// Resolves the active shell game id for renderer-wide providers (i18n, icons):
// the URL `?gameId=` (present on the menu/settings routes) wins everywhere,
// falling back to the store's `activeGameId` (set on lobby/game entry) — EXCEPT
// on the lobby route. The lobby is the URL-context-only screen: hosting from
// the engine-default shell creates a session whose gameId is merely the
// registry default, and that id alone must not pull the game's branding (token
// overrides, translations, icons) into the engine-default lobby. Every other
// route keeps the session fallback — a direct-game boot lands on `/game` or
// `/settings` with a bare URL and still needs its game's translations and
// branding. `null` ⇒ no game context.
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
