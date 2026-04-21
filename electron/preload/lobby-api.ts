// electron/preload/lobby-api.ts
//
// Implements the `window.__chimera.lobby` namespace exposed to the renderer
// (§4.1). Only depends on a narrow `LobbyApiIpcPort` so the factory is
// trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (invariant 5).
//
// `chimera:lobby:list` (LobbyDiscoveryAPI) is deliberately NOT declared here
// — discovery is an optional capability surfaced only when the active
// MultiplayerProvider implements `BrowsableProvider` (§4.1, §4.14). It lands
// in F09/F10.

import type {
    HostLobbyParams,
    JoinLobbyParams,
    LobbyAPI,
    LobbyInfo,
    LobbyState,
    Unsubscribe,
} from './api.js';
import { LobbyInfoSchema, parseInvokeResponse } from './schemas.js';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.host}. */
export const LOBBY_HOST_CHANNEL = 'chimera:lobby:host';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.join}. */
export const LOBBY_JOIN_CHANNEL = 'chimera:lobby:join';

/** `ipcRenderer.send` target for {@link LobbyAPI.leave}. */
export const LOBBY_LEAVE_CHANNEL = 'chimera:lobby:leave';

/**
 * `ipcRenderer.on` target for {@link LobbyAPI.onUpdate}. Main pushes the
 * full {@link LobbyState} via `webContents.send` whenever the roster,
 * readiness, or lobby metadata changes.
 */
export const LOBBY_UPDATE_CHANNEL = 'chimera:lobby:update';

/**
 * Shape of an `ipcRenderer` listener. Electron's real signature is
 * `(event: IpcRendererEvent, ...args: unknown[]) => void`; permissive here
 * so a test stub can invoke it with any payload.
 */
export type LobbyApiListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port over `ipcRenderer`. Exposing only the four methods the lobby
 * namespace uses keeps the API surface auditable and lets unit tests inject
 * a pure in-memory stub instead of mocking the real Electron module.
 */
export interface LobbyApiIpcPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
    send(channel: string): void;
    on(channel: string, listener: LobbyApiListener): void;
    removeListener(channel: string, listener: LobbyApiListener): void;
}

/**
 * Build the `window.__chimera.lobby` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 */
export function createLobbyApi(ipc: LobbyApiIpcPort): LobbyAPI {
    return {
        host: (params: HostLobbyParams): Promise<LobbyInfo> =>
            ipc
                .invoke(LOBBY_HOST_CHANNEL, params)
                .then((value) => parseInvokeResponse(LobbyInfoSchema, LOBBY_HOST_CHANNEL, value)),
        join: (params: JoinLobbyParams): Promise<LobbyInfo> =>
            ipc
                .invoke(LOBBY_JOIN_CHANNEL, params)
                .then((value) => parseInvokeResponse(LobbyInfoSchema, LOBBY_JOIN_CHANNEL, value)),
        leave: (): void => {
            ipc.send(LOBBY_LEAVE_CHANNEL);
        },
        onUpdate: (cb: (lobby: LobbyState) => void): Unsubscribe => {
            const listener: LobbyApiListener = (_event, ...args) => {
                // Main emits via `webContents.send(channel, state)`; the
                // first positional argument (after the Electron event) is
                // the payload. Coerce via the declared LobbyState type.
                cb(args[0] as LobbyState);
            };
            ipc.on(LOBBY_UPDATE_CHANNEL, listener);
            return () => {
                ipc.removeListener(LOBBY_UPDATE_CHANNEL, listener);
            };
        },
    };
}
