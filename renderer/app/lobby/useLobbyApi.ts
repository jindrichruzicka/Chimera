import { useMemo } from 'react';
import type {
    HostLobbyParams,
    JoinLobbyParams,
    LobbyAPI,
    LobbyInfo,
    SystemAPI,
} from '@chimera/electron/preload/api-types.js';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

interface ChimeraBridge {
    readonly __chimera?: {
        readonly lobby?: LobbyAPI;
        readonly system?: SystemAPI;
    };
}

export interface LobbyBridge {
    readonly lobby: LobbyAPI;
    readonly system: SystemAPI;
}

export interface LobbyApi {
    host(params: HostLobbyParams): Promise<LobbyInfo>;
    join(params: JoinLobbyParams): Promise<LobbyInfo>;
    leave(): Promise<void>;
    updatePlayerReadyState(ready: boolean): Promise<void>;
}

const MISSING_BRIDGE_ERROR = 'Chimera API not available';
const MISSING_LOCAL_PLAYER_ID_ERROR = 'Chimera local player identity not available';

function mergeLocalSeatIds(
    localPlayerId: string,
    existingLocalSeatIds: readonly string[],
): readonly string[] {
    if (existingLocalSeatIds.length === 0) {
        return [localPlayerId];
    }

    if (existingLocalSeatIds.includes(localPlayerId)) {
        return [...existingLocalSeatIds];
    }

    return [localPlayerId, ...existingLocalSeatIds];
}

export function getLobbyBridge(source: unknown = globalThis): LobbyBridge | null {
    const bridge = source as ChimeraBridge;

    if (!bridge.__chimera?.lobby || !bridge.__chimera.system) {
        return null;
    }

    return {
        lobby: bridge.__chimera.lobby,
        system: bridge.__chimera.system,
    };
}

export function useLobbyApi(): LobbyApi {
    return useMemo(
        () => ({
            async host(params: HostLobbyParams): Promise<LobbyInfo> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                const info = await bridge.lobby.host(params);
                const hostId = info.hostId;
                const existingLocalSeatIds = useLobbyUiStore.getState().localSeatIds;
                useLobbyUiStore
                    .getState()
                    .setLocalLobbyContext(hostId, mergeLocalSeatIds(hostId, existingLocalSeatIds));
                return info;
            },
            async join(params: JoinLobbyParams): Promise<LobbyInfo> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                const info = await bridge.lobby.join(params);
                const localPlayerId = await bridge.lobby.getLocalPlayerId();
                if (localPlayerId === null) {
                    throw new Error(MISSING_LOCAL_PLAYER_ID_ERROR);
                }
                const existingLocalSeatIds = useLobbyUiStore.getState().localSeatIds;
                useLobbyUiStore
                    .getState()
                    .setLocalLobbyContext(
                        localPlayerId,
                        mergeLocalSeatIds(localPlayerId, existingLocalSeatIds),
                    );
                return info;
            },
            async leave(): Promise<void> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                await bridge.lobby.leave();
                useLobbyUiStore.getState().clearLocalLobbyContext();
            },
            async updatePlayerReadyState(ready: boolean): Promise<void> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                await bridge.lobby.updatePlayerReadyState(ready);
            },
        }),
        [],
    );
}
