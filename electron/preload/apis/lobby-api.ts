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
    PlayerId,
    PlayerConnectionEvent,
    ProfileRejection,
    Unsubscribe,
} from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { subscribePush } from '../shared/listener.js';
import {
    LobbyInfoSchema,
    LocalPlayerIdSchema,
    NullableLobbyStateSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.host}. */
export const LOBBY_HOST_CHANNEL = 'chimera:lobby:host';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.join}. */
export const LOBBY_JOIN_CHANNEL = 'chimera:lobby:join';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.leave}. */
export const LOBBY_LEAVE_CHANNEL = 'chimera:lobby:leave';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.startGame}. */
export const LOBBY_START_GAME_CHANNEL = 'chimera:lobby:start-game';

/**
 * `ipcRenderer.invoke` target for {@link LobbyAPI.returnToLobby}. Host-only: the
 * main-side handler rejects calls from a joined (non-host) session and abandons
 * the active match back to the lobby phase — the reverse of
 * {@link LobbyAPI.startGame} (#736). No payload; host identity is derived
 * main-side.
 */
export const LOBBY_RETURN_TO_LOBBY_CHANNEL = 'chimera:lobby:return-to-lobby';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.getLocalPlayerId}. */
export const LOBBY_GET_LOCAL_PLAYER_ID_CHANNEL = 'chimera:lobby:get-local-player-id';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.getCurrentState}. */
export const LOBBY_GET_CURRENT_STATE_CHANNEL = 'chimera:lobby:get-current-state';

/** `ipcRenderer.invoke` target for {@link LobbyAPI.updatePlayerReadyState}. */
export const LOBBY_UPDATE_READY_STATE_CHANNEL = 'chimera:lobby:update-ready-state';

/**
 * `ipcRenderer.invoke` target for {@link LobbyAPI.setMatchSetting}. Host-only:
 * the main-side handler rejects writes from a joined (non-host) session (#706).
 */
export const LOBBY_SET_MATCH_SETTING_CHANNEL = 'chimera:lobby:set-match-setting';

/**
 * `ipcRenderer.invoke` target for {@link LobbyAPI.setPlayerAttribute}.
 * Owner-authored (F53): the main-side handler accepts a write only for the
 * caller's OWN seat; a joined client's own-seat write is forwarded to the
 * authoritative host, which applies it and rebroadcasts (#706).
 */
export const LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL = 'chimera:lobby:set-player-attribute';

/**
 * `ipcRenderer.invoke` target for {@link LobbyAPI.addAi}. Host-only: the
 * main-side handler rejects writes from a joined (non-host) session and a full
 * lobby, then rebroadcasts the synced {@link LobbyState} (#724).
 */
export const LOBBY_ADD_AI_CHANNEL = 'chimera:lobby:add-ai';

/**
 * `ipcRenderer.invoke` target for {@link LobbyAPI.removeAi}. Host-only: the
 * main-side handler rejects writes from a joined (non-host) session, then
 * rebroadcasts the synced {@link LobbyState} (#724).
 */
export const LOBBY_REMOVE_AI_CHANNEL = 'chimera:lobby:remove-ai';

/**
 * `ipcRenderer.on` target for {@link LobbyAPI.onUpdate}. Main pushes the
 * full {@link LobbyState} via `webContents.send` whenever the roster,
 * readiness, or lobby metadata changes.
 */
export const LOBBY_UPDATE_CHANNEL = 'chimera:lobby:update';

/**
 * `ipcRenderer.on` target for {@link LobbyAPI.onPlayerConnectionChanged}. Main
 * pushes a {@link PlayerConnectionEvent} when an opponent transiently drops or
 * reconnects, driving the §4.30 presence toasts (#687).
 */
export const LOBBY_PLAYER_CONNECTION_CHANNEL = 'chimera:lobby:player-connection';

/**
 * `ipcRenderer.on` target for {@link LobbyAPI.onProfileRejected}. Main pushes a
 * {@link ProfileRejection} when this client's profile is rejected at JOIN or for
 * a mid-session PROFILE_UPDATE, driving the §4.30 "Profile rejected" toast (#688).
 */
export const LOBBY_PROFILE_REJECTED_CHANNEL = 'chimera:lobby:profile-rejected';

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
        startGame: (): Promise<void> => ipc.invoke(LOBBY_START_GAME_CHANNEL).then(() => undefined),
        returnToLobby: (): Promise<void> =>
            ipc.invoke(LOBBY_RETURN_TO_LOBBY_CHANNEL).then(() => undefined),

        getCurrentState: (): Promise<LobbyState | null> =>
            ipc
                .invoke(LOBBY_GET_CURRENT_STATE_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(
                        NullableLobbyStateSchema,
                        LOBBY_GET_CURRENT_STATE_CHANNEL,
                        value,
                    ),
                ),

        getLocalPlayerId: (): Promise<PlayerId | null> =>
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
        setMatchSetting: (key: string, value: string): Promise<void> =>
            ipc.invoke(LOBBY_SET_MATCH_SETTING_CHANNEL, { key, value }).then(() => undefined),
        setPlayerAttribute: (playerId: PlayerId, key: string, value: string): Promise<void> =>
            ipc
                .invoke(LOBBY_SET_PLAYER_ATTRIBUTE_CHANNEL, { playerId, key, value })
                .then(() => undefined),
        addAi: (): Promise<void> => ipc.invoke(LOBBY_ADD_AI_CHANNEL).then(() => undefined),
        removeAi: (slotIndex: number): Promise<void> =>
            ipc.invoke(LOBBY_REMOVE_AI_CHANNEL, { slotIndex }).then(() => undefined),
        onUpdate: (cb: (lobby: LobbyState) => void): Unsubscribe =>
            subscribePush<LobbyState>(ipc, LOBBY_UPDATE_CHANNEL, cb),
        onPlayerConnectionChanged: (cb: (event: PlayerConnectionEvent) => void): Unsubscribe =>
            subscribePush<PlayerConnectionEvent>(ipc, LOBBY_PLAYER_CONNECTION_CHANNEL, cb),
        onProfileRejected: (cb: (rejection: ProfileRejection) => void): Unsubscribe =>
            subscribePush<ProfileRejection>(ipc, LOBBY_PROFILE_REJECTED_CHANNEL, cb),
    };
}
