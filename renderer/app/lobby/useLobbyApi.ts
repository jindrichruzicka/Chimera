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
const STUB_SECONDARY_SEAT_SUFFIX = '-local-seat-2';

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
                useLobbyUiStore
                    .getState()
                    .setLocalLobbyContext(hostId, [
                        hostId,
                        `${hostId}${STUB_SECONDARY_SEAT_SUFFIX}`,
                    ]);
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
                useLobbyUiStore.getState().setLocalLobbyContext(localPlayerId, [localPlayerId]);
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
