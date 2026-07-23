import type { SettingsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { loadRendererGame } from '../game/rendererGameRegistry';
import type { InputAction } from '../input/InputAction.js';
import type { InputActionRegistry } from '../input/InputActionRegistry.js';
import { useSettingsStore } from '../state/settingsStore';
import { emitRendererError } from '../logging/rendererLogger';

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
            // Invariant #67: forward with stack + named module (not 'global').
            // emitRendererError alone — console.* is forwarded too, so a console.*
            // call would double it.
            const logsApi = (
                globalThis as Record<string, unknown> & {
                    __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                }
            ).__chimera?.logs;
            emitRendererError(
                logsApi,
                `[SettingsBootstrap] Failed to hydrate settings for '${activeGameId}'`,
                error instanceof Error ? error : new Error(String(error)),
                undefined,
                'settings-bootstrap',
            );
        }
    }
}

export async function registerActiveGameInputActions(
    inputActionRegistry: InputActionRegistry,
    activeGameId: string,
    isDisposed: () => boolean,
): Promise<void> {
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
            // Invariant #67: forward with stack + named module (not 'global').
            // emitRendererError alone — console.* is forwarded too, so a console.*
            // call would double it.
            const logsApi = (
                globalThis as Record<string, unknown> & {
                    __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                }
            ).__chimera?.logs;
            emitRendererError(
                logsApi,
                `[SettingsBootstrap] Failed to register input actions for '${activeGameId}'`,
                error instanceof Error ? error : new Error(String(error)),
                undefined,
                'settings-bootstrap',
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
