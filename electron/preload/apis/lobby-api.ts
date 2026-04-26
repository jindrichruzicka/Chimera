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
//
// Failure-reporting policy for `leave()`:
//   `chimera:lobby:leave` uses invoke-style IPC (`ipcRenderer.invoke`). The
//   renderer awaits teardown and surfaces failures via the returned Promise.
//   This mirrors the pattern used by `host` and `join` (§4.14).

import type {
    HostLobbyParams,
    JoinLobbyParams,
    LobbyAPI,
    LobbyInfo,
    LobbyState,
    Unsubscribe,
} from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { subscribePush } from '../shared/listener.js';
import { LobbyInfoSchema, LocalPlayerIdSchema, parseInvokeResponse } from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.host}. */
export const LOBBY_HOST_CHANNEL = 'chimera:lobby:host';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.join}. */
export const LOBBY_JOIN_CHANNEL = 'chimera:lobby:join';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.leave}. */
export const LOBBY_LEAVE_CHANNEL = 'chimera:lobby:leave';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.getLocalPlayerId}. */
export const LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL = 'chimera:lobby:get-local-player-id';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.updatePlayerReadyState}. */
export const LOBBY_UPDATE_READY_STATE_CHANNEL = 'chimera:lobby:update-ready-state';

/**
 * `ipcRenderer.on` target for {@link LobbyAPI.onUpdate}. Main pushes the
 * full {@link LobbyState} via `webContents.send` whenever the roster,
 * readiness, or lobby metadata changes.
 */
export const LOBBY_UPDATE_CHANNEL = 'chimera:lobby:update';

/**
 * Back-compat alias for {@link IpcListener}. Retained so test files that
 * imported `LobbyApiListener` continue to compile. New code should use
 * {@link IpcListener} directly.
 */
export type LobbyApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds the `invoke` method that the lobby
 * namespace uses.
 */
export interface LobbyApiIpcPort extends PushListenerPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
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
        leave: (): Promise<void> => ipc.invoke(LOBBY_LEAVE_CHANNEL).then(() => undefined),
        getLocalPlayerId: (): Promise<string | null> =>
            ipc
                .invoke(LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(
                        LocalPlayerIdSchema,
                        LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL,
                        value,
                    ),
                ),
        updatePlayerReadyState: (ready: boolean): Promise<void> =>
            ipc.invoke(LOBBY_UPDATE_READY_STATE_CHANNEL, ready).then(() => undefined),
        onUpdate: (cb: (lobby: LobbyState) => void): Unsubscribe =>
            subscribePush<LobbyState>(ipc, LOBBY_UPDATE_CHANNEL, cb),
    };
}
