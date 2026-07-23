'use client';

/**
 * Thin client component that wires the chimera:settings:change push channel
 * into the settingsStore on mount, hydrates the active lobby game's settings
 * and input actions when a game session is active, and hydrates the URL
 * `?gameId=` shell game's persisted settings on menu routes. Renders nothing.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bootstrapSettingsStore } from '../state/settingsStoreBootstrap';
import { useLobbyStore } from '../state/lobbyStore';
import { useSettingsStore } from '../state/settingsStore';
import { useInputActionRegistry } from '../input/InputActionRegistryContext.js';
import { resolveShellGameId } from '../shell/resolveMainMenuGameId';
import {
    getSettingsApi,
    hydrateActiveGameSettings,
    registerActiveGameInputActions,
} from './settingsGameContext';

function selectActiveLobbyGameId(state: {
    readonly lobbyState: { readonly info: { readonly gameId: string } } | null;
}): string | null {
    return state.lobbyState?.info.gameId ?? null;
}

export function SettingsBootstrap(): null {
    const activeGameId = useLobbyStore(selectActiveLobbyGameId);
    const inputActionRegistry = useInputActionRegistry();
    const urlGameId = useUrlShellGameId();

    useEffect(() => {
        const settingsApi = getSettingsApi();
        if (settingsApi === null) return;
        const unsubscribe = bootstrapSettingsStore(settingsApi);
        return unsubscribe;
    }, []);

    // Cold-boot locale fix: menu routes carry only a URL `?gameId=` (no lobby),
    // so nothing else hydrates that game's persisted settings — leaving
    // `useActiveGameTranslations` on the default locale until the settings page
    // is opened. Hydrating here applies the persisted `gameplay.language` (and
    // the rest of the resolved settings) as soon as the shell game context is
    // known. URL-only context is hydration ONLY: the lobby effect below stays
    // the sole owner of `activeGameId` and input-action registration.
    useEffect(() => {
        if (urlGameId === null) {
            return;
        }

        let disposed = false;
        void hydrateActiveGameSettings(getSettingsApi(), urlGameId, () => disposed);
        return () => {
            disposed = true;
        };
    }, [urlGameId]);

    useEffect(() => {
        const settingsApi = getSettingsApi();
        if (activeGameId === null) {
            useSettingsStore.getState().setActiveGameId(null);
            return;
        }

        let disposed = false;
        const settingsPromise = hydrateActiveGameSettings(
            settingsApi,
            activeGameId,
            () => disposed,
        );
        const inputActionsPromise = registerActiveGameInputActions(
            inputActionRegistry,
            activeGameId,
            () => disposed,
        );

        void Promise.allSettled([settingsPromise, inputActionsPromise]).then(() => {
            if (!disposed) {
                useSettingsStore.getState().setActiveGameId(activeGameId);
            }
        });

        return () => {
            disposed = true;
        };
    }, [activeGameId, inputActionRegistry]);

    return null;
}

/**
 * The URL `?gameId=` shell game context, re-read on every navigation. Mirrors
 * `useActiveGameId` in `renderer/i18n/useActiveGameTranslations.ts`: the search
 * string is read in an effect keyed on the pathname — NOT via
 * `useSearchParams()`, which forces a Suspense boundary under
 * `output: 'export'` while this bootstrap mounts above any boundary.
 */
function useUrlShellGameId(): string | null {
    const pathname = usePathname();
    const [urlGameId, setUrlGameId] = useState<string | null>(null);

    useEffect(() => {
        setUrlGameId(resolveShellGameId(new URLSearchParams(window.location.search)));
    }, [pathname]);

    return urlGameId;
}
