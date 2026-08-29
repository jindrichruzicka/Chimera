'use client';

/**
 * Thin client component that wires the chimera:settings:change push channel
 * into the settingsStore on mount, hydrates the persisted settings of both game
 * contexts a screen can be under — the lobby's game and the URL `?gameId=`
 * shell game — and publishes ONE of them as the store's `activeGameId`.
 * Renders nothing.
 *
 * The active-game slot is the lobby's game when a session is live, else the
 * shell route's. It is not a label — it is the settings NAMESPACE, so which
 * game holds it decides what every store-reading consumer resolves, and a slot
 * left null resolves `__engine__` instead of the namespace the settings page
 * wrote the player's choice into. Who those consumers are is a live set, read
 * off `state.activeGameId`; the one that made this a defect rather than a
 * preference is `KeyBindingRepository` (§4.26, Invariant #66), because a game's
 * `game:*` default binding lives in the GAME's schema and nowhere else, so
 * under `__engine__` the action has no key at all.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bootstrapSettingsStore } from '../state/settingsStoreBootstrap';
import { useLobbyStore } from '../state/lobbyStore';
import { useSettingsStore } from '../state/settingsStore';
import { resolveShellGameId } from '../shell/resolveMainMenuGameId';
import { getSettingsApi, hydrateActiveGameSettings } from './settingsGameContext';

function selectActiveLobbyGameId(state: {
    readonly lobbyState: { readonly info: { readonly gameId: string } } | null;
}): string | null {
    return state.lobbyState?.info.gameId ?? null;
}

export function SettingsBootstrap(): null {
    const lobbyGameId = useLobbyStore(selectActiveLobbyGameId);
    const urlGameId = useUrlShellGameId();
    // The active-game slot: the lobby's game while a session is live, the shell
    // route's `?gameId=` otherwise. A lobby for game A opened from game B's menu
    // is the case that keeps this an ordering and not a merge.
    const activeGameId = lobbyGameId ?? urlGameId;

    useEffect(() => {
        const settingsApi = getSettingsApi();
        if (settingsApi === null) return;
        const unsubscribe = bootstrapSettingsStore(settingsApi);
        return unsubscribe;
    }, []);

    // The OTHER context, hydrated for its settings alone. A menu still showing
    // game A's branding while a lobby for game B holds the slot has to read A's
    // persisted `gameplay.language` from somewhere, and the effect below only
    // ever fetches the slot holder. Skipped when the two coincide, which is the
    // ordinary case.
    useEffect(() => {
        if (urlGameId === null || urlGameId === activeGameId) {
            return;
        }

        let disposed = false;
        void hydrateActiveGameSettings(getSettingsApi(), urlGameId, () => disposed);
        return () => {
            disposed = true;
        };
    }, [urlGameId, activeGameId]);

    useEffect(() => {
        if (activeGameId === null) {
            useSettingsStore.getState().setActiveGameId(null);
            return;
        }

        let disposed = false;
        // Published only once the settings are IN the store: the slot is what
        // `KeyBindingRepository` resolves against, so claiming it first would
        // publish a game context whose binding map is still empty.
        // `hydrateActiveGameSettings` logs and swallows its own failures, so
        // this continuation runs on the degraded path too — an unhydrated game
        // still owns the slot, exactly as it did before.
        void hydrateActiveGameSettings(getSettingsApi(), activeGameId, () => disposed).then(() => {
            if (!disposed) {
                useSettingsStore.getState().setActiveGameId(activeGameId);
            }
        });

        return () => {
            disposed = true;
        };
    }, [activeGameId]);

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
