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

import type { ResolvedSettings, SettingsAPI, Unsubscribe, UserSettings } from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { ResolvedSettingsSchema, parseInvokeResponse } from '../shared/schemas.js';

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
 * Back-compat alias for {@link IpcListener}, kept so callers of the old
 * `SettingsApiListener` name still compile. New code should use
 * {@link IpcListener} directly.
 */
export type SettingsApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds `invoke`. The settings namespace never
 * `send`s — every mutation is a round-trip invoke so the renderer can
 * surface failures and receive the newly-resolved settings tree.
 */
export interface SettingsApiIpcPort extends PushListenerPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Build the `window.__chimera.settings` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 */
export function createSettingsApi(ipc: SettingsApiIpcPort): SettingsAPI {
    return {
        get: (gameId: string): Promise<ResolvedSettings> =>
            ipc
                .invoke(SETTINGS_GET_CHANNEL, gameId)
                .then((value) =>
                    parseInvokeResponse(ResolvedSettingsSchema, SETTINGS_GET_CHANNEL, value),
                ),
        update: (gameId: string, patch: Partial<UserSettings>): Promise<ResolvedSettings> =>
            ipc
                .invoke(SETTINGS_UPDATE_CHANNEL, gameId, patch)
                .then((value) =>
                    parseInvokeResponse(ResolvedSettingsSchema, SETTINGS_UPDATE_CHANNEL, value),
                ),
        reset: (gameId: string): Promise<ResolvedSettings> =>
            ipc
                .invoke(SETTINGS_RESET_CHANNEL, gameId)
                .then((value) =>
                    parseInvokeResponse(ResolvedSettingsSchema, SETTINGS_RESET_CHANNEL, value),
                ),
        onChange: (cb: (gameId: string, settings: ResolvedSettings) => void): Unsubscribe => {
            // Two-argument push channel (`gameId`, `settings`) — the shared
            // `subscribePush<T>` helper only covers the single-payload case,
            // so this namespace keeps a minimal bespoke listener. The
            // `IpcListener` type is the same one used by every other
            // namespace (see electron/preload/listener.ts).
            const listener: IpcListener = (_event, ...args) => {
                cb(args[0] as string, args[1] as ResolvedSettings);
            };
            ipc.on(SETTINGS_CHANGE_CHANNEL, listener);
            return () => {
                ipc.removeListener(SETTINGS_CHANGE_CHANNEL, listener);
            };
        },
    };
}
