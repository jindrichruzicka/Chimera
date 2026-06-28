import type { SettingsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { loadRendererGame } from '../game/rendererGameRegistry';
import type { InputAction } from '../input/InputAction.js';
import type { InputActionRegistry } from '../input/InputActionRegistry.js';
import { useSettingsStore } from '../state/settingsStore';

export function getSettingsApi(): SettingsAPI | null {
    const chimera = (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera;
    return chimera?.settings ?? null;
}

export async function hydrateActiveGameSettings(
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

export async function registerActiveGameInputActions(
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
