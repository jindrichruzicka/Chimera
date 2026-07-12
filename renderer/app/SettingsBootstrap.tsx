'use client';

/**
 * Thin client component that wires the chimera:settings:change push channel
 * into the settingsStore on mount, then hydrates the active lobby game's
 * settings and input actions when a game session is active. Renders nothing.
 */

import { useEffect } from 'react';
import { bootstrapSettingsStore } from '../state/settingsStoreBootstrap';
import { useLobbyStore } from '../state/lobbyStore';
import { useSettingsStore } from '../state/settingsStore';
import { useOptionalInputActionRegistry } from '../input/InputActionRegistryContext.js';
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
    const inputActionRegistry = useOptionalInputActionRegistry();

    useEffect(() => {
        const settingsApi = getSettingsApi();
        if (settingsApi === null) return;
        const unsubscribe = bootstrapSettingsStore(settingsApi);
        return unsubscribe;
    }, []);

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
