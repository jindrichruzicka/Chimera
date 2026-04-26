/**
 * networking/provider/SteamNetworkProvider.ts
 *
 * Stub implementation of MultiplayerProvider for Steamworks P2P integration.
 *
 * All methods throw 'not yet implemented'. This stub exists to:
 *   1. Prove the MultiplayerProvider interface is implementable by a non-WebSocket provider
 *   2. Reserve the class name and file location for the future Steamworks integration
 *   3. Validate that zero simulation or IPC changes are required to add a new provider
 *
 * No imports from networking/provider/local/ — this is an independent provider.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T3 (issue #203)
 *
 * Invariants upheld:
 *   #2 — networking/provider/ has zero imports from renderer/ or electron/
 *   Module boundary — networking/provider/local/ must not be imported from here
 */

import type {
    MultiplayerProvider,
    BrowsableProvider,
    HostedSession,
    JoinedSession,
    LobbyListEntry,
    HostLobbyParams,
    JoinLobbyParams,
} from '../MultiplayerProvider.js';

export class SteamNetworkProvider implements MultiplayerProvider, BrowsableProvider {
    hostLobby(_params: HostLobbyParams): Promise<HostedSession> {
        return Promise.reject(new Error('not yet implemented'));
    }

    joinLobby(_params: JoinLobbyParams): Promise<JoinedSession> {
        return Promise.reject(new Error('not yet implemented'));
    }

    listLobbies(): Promise<LobbyListEntry[]> {
        // SteamMatchmaking.RequestLobbyList() filtered by app ID + gameId metadata
        return Promise.reject(new Error('not yet implemented'));
    }

    dispose(): void {
        // no resources to release in the stub
    }
}
