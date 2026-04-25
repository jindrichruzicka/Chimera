import { useMemo } from 'react';
import type {
    HostLobbyParams,
    JoinLobbyParams,
    LobbyAPI,
    LobbyInfo,
    SystemAPI,
} from '@chimera/electron/preload/api-types.js';

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
}

const MISSING_BRIDGE_ERROR = 'Chimera API not available';

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
                return bridge.lobby.host(params);
            },
            async join(params: JoinLobbyParams): Promise<LobbyInfo> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                return bridge.lobby.join(params);
            },
            async leave(): Promise<void> {
                const bridge = getLobbyBridge();
                if (!bridge) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                await bridge.lobby.leave();
            },
        }),
        [],
    );
}
