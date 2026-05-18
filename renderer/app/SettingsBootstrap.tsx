'use client';

/**
 * renderer/app/SettingsBootstrap.tsx
 *
 * Thin client component that wires the chimera:settings:change push channel
 * into the settingsStore on mount, then hydrates the active lobby game's
 * settings and input actions when a game session is active. Renders nothing.
 *
 * Architecture reference: §F07 hardening #157 (BLOCK-2, WARN-4)
 */

import { useEffect } from 'react';
import { bootstrapSettingsStore } from '../state/settingsStoreBootstrap';
import { useLobbyStore } from '../state/lobbyStore';
import { useSettingsStore } from '../state/settingsStore';
import { loadRendererGame } from '../game/rendererGameRegistry';
import { useOptionalInputActionRegistry } from '../input/InputActionRegistryContext.js';
import type { InputAction } from '../input/InputAction.js';
import type { InputActionRegistry } from '../input/InputActionRegistry.js';
import type { SettingsAPI } from '@chimera/electron/preload/api-types.js';

function selectActiveLobbyGameId(state: {
    readonly lobbyState: { readonly info: { readonly gameId: string } } | null;
}): string | null {
    return state.lobbyState?.info.gameId ?? null;
}

function getSettingsApi(): SettingsAPI | null {
    const chimera = (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera;
    return chimera?.settings ?? null;
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

async function hydrateActiveGameSettings(
    settingsApi: SettingsAPI | null,
    activeGameId: string,
    isDisposed: () => boolean,
): Promise<void> {
    if (settingsApi === null) {
        return;
    }

    try {
        const settings = await settingsApi.get(activeGameId);
        if (!isDisposed()) {
            useSettingsStore.getState()._applySettings(activeGameId, settings);
        }
    } catch (error: unknown) {
        if (!isDisposed()) {
            console.warn(
                `[SettingsBootstrap] Failed to hydrate settings for '${activeGameId}':`,
                error,
            );
        }
    }
}

async function registerActiveGameInputActions(
    inputActionRegistry: InputActionRegistry | null,
    activeGameId: string,
    isDisposed: () => boolean,
): Promise<void> {
    if (inputActionRegistry === null) {
        return;
    }

    try {
        const game = await loadRendererGame(activeGameId);
        if (isDisposed()) {
            return;
        }

        for (const action of game.inputActions ?? []) {
            registerInputAction(inputActionRegistry, action);
        }
    } catch (error: unknown) {
        if (!isDisposed()) {
            console.warn(
                `[SettingsBootstrap] Failed to register input actions for '${activeGameId}':`,
                error,
            );
        }
    }
}

function registerInputAction(registry: InputActionRegistry, action: InputAction): void {
    if (registry.has(action.id)) {
        assertSameInputAction(registry.get(action.id), action);
        return;
    }

    registry.register(action);
}

function assertSameInputAction(existing: InputAction, next: InputAction): void {
    if (
        existing.description !== next.description ||
        existing.category !== next.category ||
        existing.oneShot !== next.oneShot
    ) {
        throw new Error(`Input action '${next.id}' is already registered with different metadata.`);
    }
}
