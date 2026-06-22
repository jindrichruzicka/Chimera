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
} from '../MultiplayerProvider.js';
import { playerId as toPlayerId } from '../MultiplayerProvider.js';
import type { ServerConnectionOptions } from './client/ServerConnection.js';
import { LobbyServer } from './server/LobbyServer.js';
import { MessageRouter } from './server/MessageRouter.js';
import { WsHostTransport } from './server/WsHostTransport.js';
import { ServerConnection } from './client/ServerConnection.js';
import { WsClientTransport } from './client/WsClientTransport.js';

// ─── Options ──────────────────────────────────────────────────────────────────

/** Options for LocalWebSocketProvider. All fields optional. */
export type LocalWebSocketProviderOptions = ServerConnectionOptions;

// ─── LocalWebSocketProvider ───────────────────────────────────────────────────

/**
 * Default MultiplayerProvider for local LAN / localhost play.
 * Injected into LobbyManager at application start by electron/main/index.ts.
 */
export class LocalWebSocketProvider implements MultiplayerProvider {
    private readonly openServers = new Set<LobbyServer>();
    private readonly openConnections = new Set<ServerConnection>();
    private readonly opts: LocalWebSocketProviderOptions;

    constructor(opts: LocalWebSocketProviderOptions = {}) {
        this.opts = opts;
    }

    // ─── MultiplayerProvider API ──────────────────────────────────────────────

    async hostLobby(params: HostLobbyParams): Promise<HostedSession> {
        const server = new LobbyServer({
            port: 0,
            gameId: params.gameId,
            maxPlayers: params.maxPlayers,
            // F56: an empty/whitespace host password leaves the lobby open.
            ...(params.password !== undefined ? { password: params.password } : {}),
        });

        // Add to openServers only AFTER ready() succeeds to avoid resource leaks (W-1)
        await server.ready();
        this.openServers.add(server);

        const router = new MessageRouter(server);
        const transport = new WsHostTransport(server, router);
        const lobbyCode = `127.0.0.1:${server.port}:${server.token}`;
        const lobbyInfo: LobbyInfo = {
            sessionId: lobbyCode,
            hostId: toPlayerId(`host-${server.token.slice(0, 8)}`),
            gameId: params.gameId,
        };

        const close = async (): Promise<void> => {
            router.dispose();
            await server.close();
            this.openServers.delete(server);
        };

        return { lobbyCode, lobbyInfo, transport, close };
    }

    async joinLobby(params: JoinLobbyParams): Promise<JoinedSession> {
        const [host, portStr, token] = params.address.split(':');
        if (!host || !portStr || !token) {
            throw new Error(
                `LocalWebSocketProvider: invalid address format "${params.address}". Expected "host:port:token".`,
            );
        }

        const conn = new ServerConnection(this.opts);
        this.openConnections.add(conn);

        const { playerId: assignedPlayerId, lobbyState } = await conn.connect(
            `ws://${host}:${portStr}`,
            token,
            // Use the caller-provided profile if present; fall back to a minimal
            // placeholder so existing tests (which don't pass a profile) keep working.
            // The host's profile gate will validate the actual content.
            params.profile ?? {
                playerId: toPlayerId('pending'),
                displayName: 'Player',
            },
            params.reconnectPlayerId,
            params.password,
        );

        const transport = new WsClientTransport(conn, assignedPlayerId);

        const lobbyInfo: LobbyInfo = {
            sessionId: lobbyState.info.sessionId,
            hostId: lobbyState.info.hostId,
            gameId: lobbyState.info.gameId,
        };

        const disconnect = async (): Promise<void> => {
            await conn.close();
            this.openConnections.delete(conn);
        };

        return {
            lobbyInfo,
            localPlayerId: assignedPlayerId,
            initialLobbyState: lobbyState,
            transport,
            disconnect,
        };
    }

    dispose(): void {
        const servers = [...this.openServers];
        const conns = [...this.openConnections];
        this.openServers.clear();
        this.openConnections.clear();
        for (const server of servers) {
            void server.close();
        }
        for (const conn of conns) {
            void conn.close();
        }
    }
}
