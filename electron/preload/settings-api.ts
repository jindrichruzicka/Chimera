// electron/preload/settings-api.ts
//
// Implements the `window.__chimera.settings` namespace exposed to the
// renderer (§4.1). Only depends on a narrow `SettingsApiIpcPort` so the
// factory is trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and
// the main-process handler module imports these same constants to
// guarantee the channel strings match on both sides (invariant 5).

import type { ResolvedSettings, SettingsAPI, Unsubscribe, UserSettings } from './api.js';

/** `ipcRenderer.invoke` target for {@link SettingsAPI.get}. */
export const SETTINGS_GET_CHANNEL = 'chimera:settings:get';

/** `ipcRenderer.invoke` target for {@link SettingsAPI.update}. */
export const SETTINGS_UPDATE_CHANNEL = 'chimera:settings:update';

/** `ipcRenderer.invoke` target for {@link SettingsAPI.reset}. */
export const SETTINGS_RESET_CHANNEL = 'chimera:settings:reset';

/**
 * `ipcRenderer.on` target for {@link SettingsAPI.onChange}. Main pushes
 * `(gameId, ResolvedSettings)` via `webContents.send` whenever settings
 * change (external update, reset, or migration).
 */
export const SETTINGS_CHANGE_CHANNEL = 'chimera:settings:change';

/**
 * Shape of an `ipcRenderer` listener. Electron's real signature is
 * `(event: IpcRendererEvent, ...args: unknown[]) => void`; permissive here
 * so a test stub can invoke it with any payload.
 */
export type SettingsApiListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port over `ipcRenderer`. The settings namespace never `send`s —
 * every mutation is a round-trip invoke so the renderer can surface
 * failures and receive the newly-resolved settings tree.
 */
export interface SettingsApiIpcPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: SettingsApiListener): void;
    removeListener(channel: string, listener: SettingsApiListener): void;
}

/**
 * Build the `window.__chimera.settings` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 */
export function createSettingsApi(ipc: SettingsApiIpcPort): SettingsAPI {
    return {
        get: (gameId: string): Promise<ResolvedSettings> =>
            ipc.invoke(SETTINGS_GET_CHANNEL, gameId) as Promise<ResolvedSettings>,
        update: (gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings> =>
            ipc.invoke(SETTINGS_UPDATE_CHANNEL, gameId, patch) as Promise<ResolvedSettings>,
        reset: (gameId: string): Promise<ResolvedSettings> =>
            ipc.invoke(SETTINGS_RESET_CHANNEL, gameId) as Promise<ResolvedSettings>,
        onChange: (cb: (gameId: string, settings: ResolvedSettings) => void): Unsubscribe => {
            const listener: SettingsApiListener = (_event, ...args) => {
                // Main emits via
                //   webContents.send(channel, gameId, settings)
                // so after the Electron event the positional arguments are
                // `gameId` (string) then `settings` (ResolvedSettings).
                cb(args[0] as string, args[1] as ResolvedSettings);
            };
            ipc.on(SETTINGS_CHANGE_CHANNEL, listener);
            return () => {
                ipc.removeListener(SETTINGS_CHANGE_CHANNEL, listener);
            };
        },
    };
}
