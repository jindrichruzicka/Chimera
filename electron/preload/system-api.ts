// electron/preload/system-api.ts
//
// Implements the `window.__chimera.system` namespace exposed to the renderer.
// Only depends on a narrow `SystemApiIpcPort` so the factory is trivially
// testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides.

import type { ConnectionStatus, SystemAPI, Unsubscribe } from './api.js';

/** `ipcRenderer.invoke` target for {@link SystemAPI.platform}. */
export const SYSTEM_PLATFORM_CHANNEL = 'chimera:system:platform';

/** `ipcRenderer.send` target for {@link SystemAPI.quit}. */
export const SYSTEM_QUIT_CHANNEL = 'chimera:system:quit';

/**
 * `ipcRenderer.on` target for {@link SystemAPI.onConnectionStatus}. The main
 * process pushes status updates via `webContents.send` on this channel.
 */
export const SYSTEM_CONNECTION_STATUS_CHANNEL = 'chimera:system:connection-status';

/**
 * Full response shape for the {@link SYSTEM_PLATFORM_CHANNEL} channel.
 * Intentionally matches the return type of {@link SystemAPI.platform}.
 */
export type PlatformInfo = Awaited<ReturnType<SystemAPI['platform']>>;

/**
 * Shape of an `ipcRenderer` listener. Electron's real signature is
 * `(event: IpcRendererEvent, ...args: unknown[]) => void`; we keep it
 * permissively typed here so a test stub can invoke it with any payload.
 */
export type SystemApiListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port over `ipcRenderer`. Exposing only the four methods the system
 * namespace uses keeps the API surface auditable and lets unit tests inject a
 * pure in-memory stub instead of mocking the real Electron module.
 */
export interface SystemApiIpcPort {
    invoke(channel: string): Promise<unknown>;
    send(channel: string): void;
    on(channel: string, listener: SystemApiListener): void;
    removeListener(channel: string, listener: SystemApiListener): void;
}

/**
 * Build the `window.__chimera.system` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 *
 * Invariant 5: this is the only place the `chimera:system:*` channels are
 * referenced on the renderer side. `electron/main/ipc-handlers.ts` imports the
 * same channel constants to wire the main-side handlers.
 */
export function createSystemApi(ipc: SystemApiIpcPort): SystemAPI {
    return {
        platform: () => ipc.invoke(SYSTEM_PLATFORM_CHANNEL) as Promise<PlatformInfo>,
        quit: () => {
            ipc.send(SYSTEM_QUIT_CHANNEL);
        },
        onConnectionStatus: (cb: (status: ConnectionStatus) => void): Unsubscribe => {
            const listener: SystemApiListener = (_event, ...args) => {
                // Main emits via `webContents.send(channel, status)`; the
                // first positional argument (after the Electron event) is the
                // payload. Coerce via the declared ConnectionStatus type.
                cb(args[0] as ConnectionStatus);
            };
            ipc.on(SYSTEM_CONNECTION_STATUS_CHANNEL, listener);
            return () => {
                ipc.removeListener(SYSTEM_CONNECTION_STATUS_CHANNEL, listener);
            };
        },
    };
}
