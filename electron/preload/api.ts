// electron/preload/api.ts
//
// Preload runtime entry point.
//
// Electron loads this file (after compilation to `electron/preload/api.js`)
// as the `BrowserWindow` preload script. The side effect at the bottom is
// the one and only call to `contextBridge.exposeInMainWorld` for the game
// renderer. Invariant 28: no `__chimeraDebug` key is exposed here.
//
// The full type surface of `window.__chimera` lives in
// `electron/preload/api-types.ts`; this module owns only the runtime wiring.
//
// Every namespace factory accepts a narrow port interface so they remain
// unit-testable without a real Electron module. Electron's real
// `ipcRenderer` has a wider, historically-typed signature (event arg,
// `any[]` rest) than our ports declare. We adapt it once, here, via a
// small universal `IpcRendererPort` shape that is structurally assignable
// to each namespace's port type.

import { contextBridge, ipcRenderer } from 'electron';
import type { ChimeraAPI } from './api-types.js';
import { buildExtensionsApi } from './apis/extensions-api.js';
import { createGameApi } from './apis/game-api.js';
import { createLobbyApi } from './apis/lobby-api.js';
import { createProfileApi } from './apis/profile-api.js';
import { createSavesApi } from './apis/saves-api.js';
import { createSettingsApi } from './apis/settings-api.js';
import { createSystemApi } from './apis/system-api.js';
import { buildLogsApi } from './apis/logs-api.js';

/**
 * Shape of an `ipcRenderer` listener as seen by our narrow port interfaces.
 * Electron's real listener signature uses `IpcRendererEvent` for the first
 * argument; `unknown` is broader, so a listener declared against this type
 * is safely callable with any event payload.
 */
type IpcRendererListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Universal renderer-side IPC port. Structurally assignable to every
 * `*ApiIpcPort` in the namespace modules — each of them asks for a subset
 * of these four methods. Declared locally so the adapter is the only place
 * the real `ipcRenderer` leaks into the namespace composition.
 */
interface IpcRendererPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: IpcRendererListener): void;
    removeListener(channel: string, listener: IpcRendererListener): void;
}

const port: IpcRendererPort = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => {
        ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
        ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
        ipcRenderer.removeListener(channel, listener);
    },
};

/**
 * Compose the full {@link ChimeraAPI} from the five namespace factories. Each
 * factory owns its own channel constants (invariant 5); this file's only job
 * is to wire them onto the single shared port and hand the result to
 * `contextBridge`.
 */
const api: ChimeraAPI = {
    game: createGameApi(port),
    lobby: createLobbyApi(port),
    saves: createSavesApi(port),
    settings: createSettingsApi(port),
    system: createSystemApi(port),
    // Deferred namespaces — the interfaces are empty stubs today (see the
    // `*API` declarations in `api-types.ts`) and will gain concrete methods
    // in their respective milestones (F44, F45, F43). Exposing empty
    // objects now keeps `window.__chimera` shape-stable for the renderer.
    profile: createProfileApi(port),
    replay: {},
    chat: {},
    logs: buildLogsApi(port),
    extensions: buildExtensionsApi(),
};

contextBridge.exposeInMainWorld('__chimera', api);
