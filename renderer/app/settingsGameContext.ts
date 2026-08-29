import type { SettingsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSettingsStore } from '../state/settingsStore';
import { emitRendererError, readRendererLogsApi } from '../logging/rendererLogger';

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
            const logsApi = readRendererLogsApi();
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
