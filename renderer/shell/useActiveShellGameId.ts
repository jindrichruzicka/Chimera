'use client';

// renderer/shell/useActiveShellGameId.ts
//
// Resolves the active shell game id for renderer-wide providers (i18n, icons):
// the URL `?gameId=` (present on the menu/settings routes) wins, falling back to
// the store's `activeGameId` (set on lobby/game entry). `null` ⇒ no game context.
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

export function useActiveShellGameId(): string | null {
    const pathname = usePathname();
    const activeGameId = useSettingsStore((state) => state.activeGameId);
    const [urlGameId, setUrlGameId] = useState<string | null>(null);

    useEffect(() => {
        setUrlGameId(resolveShellGameId(new URLSearchParams(window.location.search)));
    }, [pathname]);

    return urlGameId ?? activeGameId;
}
