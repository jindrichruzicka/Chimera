// electron/preload/system-api.ts
//
// Implements the `window.__chimera.system` namespace exposed to the renderer.
// Only depends on a narrow `SystemApiIpcPort` so the factory is trivially
// testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides. Exception: the debug toggle channel
// is imported from `shared/constants.ts` — the documented home of the
// `chimera:debug*` channels (§4.12), shared with `debug-bridge.ts` so the
// debug module graph never leaks into this preload (Invariant #27).

import { DEBUG_TOGGLE_INSPECTOR_CHANNEL } from '@chimera/shared/constants.js';
import type { ConnectionStatus, DeviceInfo, SystemAPI, Unsubscribe } from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { subscribePush, subscribeValidatedPush } from '../shared/listener.js';
import { DeviceInfoSchema, PlatformInfoSchema, parseInvokeResponse } from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link SystemAPI.platform}. */
export const SYSTEM_PLATFORM_CHANNEL = 'chimera:system:platform';

/** `ipcRenderer.send` target for {@link SystemAPI.quit}. */
export const SYSTEM_QUIT_CHANNEL = 'chimera:system:quit';

/** `ipcRenderer.send` target for {@link SystemAPI.relaunch}. */
export const SYSTEM_RELAUNCH_CHANNEL = 'chimera:system:relaunch';

/**
 * `ipcRenderer.on` target for {@link SystemAPI.onConnectionStatus}. The main
 * process pushes status updates via `webContents.send` on this channel.
 */
export const SYSTEM_CONNECTION_STATUS_CHANNEL = 'chimera:system:connection-status';

/** `ipcRenderer.invoke` target for {@link SystemAPI.getDeviceInfo}. */
export const SYSTEM_DEVICE_INFO_CHANNEL = 'chimera:system:device-info';

/**
 * `ipcRenderer.on` target for {@link SystemAPI.onDeviceInfoChange}. The main
 * process pushes device-info updates via `webContents.send` on this channel.
 */
export const SYSTEM_DEVICE_INFO_CHANGE_CHANNEL = 'chimera:system:device-info-change';

/**
 * Full response shape for the {@link SYSTEM_PLATFORM_CHANNEL} channel.
 * Intentionally matches the return type of {@link SystemAPI.platform}.
 */
export type PlatformInfo = Awaited<ReturnType<SystemAPI['platform']>>;

/**
 * Back-compat alias for {@link IpcListener}. Retained so test files that
 * imported `SystemApiListener` continue to compile. New code should use
 * {@link IpcListener} directly.
 */
export type SystemApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds the `invoke` / `send` methods that the
 * system namespace uses. Keeps the API surface auditable and lets unit
 * tests inject a pure in-memory stub instead of mocking the real Electron
 * module.
 */
export interface SystemApiIpcPort extends PushListenerPort {
    invoke(channel: string): Promise<unknown>;
    send(channel: string): void;
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
/**
 * Optional callback injected at wiring time (see `api.ts`) so tests and the
 * real preload entry can supply different notification strategies without
 * coupling this factory to DOM APIs. In the real Electron preload it dispatches
 * a `CustomEvent` that crosses the `contextIsolation` boundary; unit tests
 * inject a plain spy instead.
 *
 * `contextIsolation: true` means `globalThis` in the preload is a different V8
 * context from the renderer's `window`. A `CustomEvent` dispatched via
 * `window.dispatchEvent()` in the preload world IS observable in the renderer
 * world (DOM events cross isolation boundaries), which is why this is the
 * correct mechanism for E2E detection.
 */
export type QuitNotifier = () => void;

export function createSystemApi(ipc: SystemApiIpcPort, notifyQuit?: QuitNotifier): SystemAPI {
    return {
        platform: () =>
            ipc
                .invoke(SYSTEM_PLATFORM_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(PlatformInfoSchema, SYSTEM_PLATFORM_CHANNEL, value),
                ),
        quit: () => {
            notifyQuit?.();
            ipc.send(SYSTEM_QUIT_CHANNEL);
        },
        relaunch: () => {
            ipc.send(SYSTEM_RELAUNCH_CHANNEL);
        },
        onConnectionStatus: (cb: (status: ConnectionStatus) => void): Unsubscribe =>
            subscribePush<ConnectionStatus>(ipc, SYSTEM_CONNECTION_STATUS_CHANNEL, cb),
        getDeviceInfo: () =>
            ipc
                .invoke(SYSTEM_DEVICE_INFO_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(DeviceInfoSchema, SYSTEM_DEVICE_INFO_CHANNEL, value),
                ),
        onDeviceInfoChange: (cb: (info: DeviceInfo) => void): Unsubscribe =>
            subscribeValidatedPush(ipc, SYSTEM_DEVICE_INFO_CHANGE_CHANNEL, DeviceInfoSchema, cb),
        toggleDebugInspector: () => {
            // Fire-and-forget by design: in production no listener exists on
            // this channel, and a send to an unregistered channel is a true
            // no-op — see the SystemAPI JSDoc for why this must never be an
            // `invoke`.
            ipc.send(DEBUG_TOGGLE_INSPECTOR_CHANNEL);
            return Promise.resolve();
        },
    };
}
