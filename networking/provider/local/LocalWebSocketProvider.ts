/**
 * networking/provider/local/LocalWebSocketProvider.ts
 *
 * Entry point for the LocalWebSocketProvider — implements MultiplayerProvider
 * by wiring LobbyServer, MessageRouter, WsHostTransport, ServerConnection, and
 * WsClientTransport into the HostedSession / JoinedSession API.
 *
 * Lobby code format: "127.0.0.1:PORT:TOKEN"
 *   - 127.0.0.1 — localhost only (LAN play is a future extension)
 *   - PORT      — OS-assigned TCP port of the LobbyServer
 *   - TOKEN     — 32-hex random token from LobbyServer.token
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T06 (issue #221)
 */

import type {
    MultiplayerProvider,
    HostLobbyParams,
    JoinLobbyParams,
    HostedSession,
    JoinedSession,
    LobbyInfo,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import { LobbyServer } from './server/LobbyServer.js';
import { MessageRouter } from './server/MessageRouter.js';
import { WsHostTransport } from './server/WsHostTransport.js';
import { ServerConnection } from './client/ServerConnection.js';
import { WsClientTransport } from './client/WsClientTransport.js';

// ─── LocalWebSocketProvider ───────────────────────────────────────────────────

/**
 * Default MultiplayerProvider for local LAN / localhost play.
 * Injected into LobbyManager at application start by electron/main/index.ts.
 */
export class LocalWebSocketProvider implements MultiplayerProvider {
    private readonly openServers = new Set<LobbyServer>();
    private readonly openConnections = new Set<ServerConnection>();

    // ─── MultiplayerProvider API ──────────────────────────────────────────────

    async hostLobby(params: HostLobbyParams): Promise<HostedSession> {
        const server = new LobbyServer({
            port: 0,
            gameId: params.gameId,
            maxPlayers: params.maxPlayers,
        });
        this.openServers.add(server);

        await server.ready();

        const router = new MessageRouter(server);
        const transport = new WsHostTransport(server, router);
        const lobbyCode = `127.0.0.1:${server.port}:${server.token}`;

        const close = async (): Promise<void> => {
            router.dispose();
            await server.close();
            this.openServers.delete(server);
        };

        return { lobbyCode, transport, close };
    }

    async joinLobby(params: JoinLobbyParams): Promise<JoinedSession> {
        const [host, portStr, token] = params.address.split(':');
        if (!host || !portStr || !token) {
            throw new Error(
                `LocalWebSocketProvider: invalid address format "${params.address}". Expected "host:port:token".`,
            );
        }

        const conn = new ServerConnection();
        this.openConnections.add(conn);

        const { playerId, lobbyState } = await conn.connect(`ws://${host}:${portStr}`, token, {
            playerId: 'pending' as PlayerId,
            displayName: 'Player',
        });

        const transport = new WsClientTransport(conn, playerId);

        const lobbyInfo: LobbyInfo = {
            sessionId: lobbyState.info.sessionId,
            hostId: lobbyState.info.hostId,
            gameId: lobbyState.info.gameId,
        };

        const disconnect = async (): Promise<void> => {
            await conn.close();
            this.openConnections.delete(conn);
        };

        return { lobbyInfo, transport, disconnect };
    }

    dispose(): void {
        for (const server of this.openServers) {
            void server.close();
        }
        for (const conn of this.openConnections) {
            void conn.close();
        }
        this.openServers.clear();
        this.openConnections.clear();
    }
}
