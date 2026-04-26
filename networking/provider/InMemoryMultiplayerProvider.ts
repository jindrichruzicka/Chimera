/**
 * networking/provider/InMemoryMultiplayerProvider.ts
 *
 * Test double implementing MultiplayerProvider using shared in-memory event
 * channels. Connects host and client sessions without WebSockets or real I/O.
 *
 * Intended for:
 *   - MultiplayerProvider contract tests (T5 / issue #205)
 *   - All subsequent M2 unit and integration tests
 *
 * Must NOT import from networking/provider/local/ — this is an independent provider.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T4 (issue #204)
 *
 * Invariants upheld:
 *   #2 — networking/provider/ has zero imports from renderer/ or electron/
 *   Module boundary — networking/provider/local/ must not be imported from here
 */

import type {
    MultiplayerProvider,
    HostedSession,
    JoinedSession,
    HostLobbyParams,
    JoinLobbyParams,
    HostTransport,
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
    LobbyInfo,
} from './MultiplayerProvider.js';
import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from './MultiplayerProvider.js';

// ─── Internal types ───────────────────────────────────────────────────────────

type ActionCb = (from: PlayerId, action: EngineAction) => void;
type ReadyStateCb = (from: PlayerId, ready: boolean) => void;
type HostSideChannelCb = (from: PlayerId, msg: SideChannelMessage) => void;
type PlayerJoinedCb = (player: LobbyPlayerEntry) => void;
type PlayerLeftCb = (playerId: PlayerId, reason: DisconnectReason) => void;
type SnapshotCb = (snapshot: PlayerSnapshot) => void;
type LobbyStateCb = (state: LobbyState) => void;
type ClientSideChannelCb = (msg: SideChannelMessage) => void;
type DisconnectCb = (reason: DisconnectReason) => void;

function addSub<T>(set: Set<T>, cb: T): Unsubscribe {
    set.add(cb);
    return (): void => {
        set.delete(cb);
    };
}

/** Per-client subscription state within a session. */
interface ClientRecord {
    readonly playerId: PlayerId;
    readonly snapshotCbs: Set<SnapshotCb>;
    readonly sideChannelCbs: Set<ClientSideChannelCb>;
    readonly lobbyStateCbs: Set<LobbyStateCb>;
    readonly disconnectCbs: Set<DisconnectCb>;
}

/** Shared channel connecting one hosted session to N clients. */
class InMemoryChannel {
    readonly lobbyCode: string;
    readonly lobbyInfo: LobbyInfo;

    // Host-side subscriptions (client → host)
    readonly actionCbs = new Set<ActionCb>();
    readonly readyStateCbs = new Set<ReadyStateCb>();
    readonly hostSideChannelCbs = new Set<HostSideChannelCb>();
    readonly playerJoinedCbs = new Set<PlayerJoinedCb>();
    readonly playerLeftCbs = new Set<PlayerLeftCb>();

    // Per-client records
    readonly clients = new Map<PlayerId, ClientRecord>();
    latestLobbyState: LobbyState | null = null;

    closed = false;

    constructor(lobbyCode: string, lobbyInfo: LobbyInfo) {
        this.lobbyCode = lobbyCode;
        this.lobbyInfo = lobbyInfo;
    }

    addClient(playerId: PlayerId): ClientRecord {
        const record: ClientRecord = {
            playerId,
            snapshotCbs: new Set(),
            sideChannelCbs: new Set(),
            lobbyStateCbs: new Set(),
            disconnectCbs: new Set(),
        };
        this.clients.set(playerId, record);
        return record;
    }

    removeClient(playerId: PlayerId): void {
        this.clients.delete(playerId);
    }

    closeAll(): void {
        this.closed = true;
        for (const client of this.clients.values()) {
            for (const cb of client.disconnectCbs) cb('host_closed');
        }
        this.actionCbs.clear();
        this.readyStateCbs.clear();
        this.hostSideChannelCbs.clear();
        this.playerJoinedCbs.clear();
        this.playerLeftCbs.clear();
        for (const client of this.clients.values()) {
            client.snapshotCbs.clear();
            client.sideChannelCbs.clear();
            client.lobbyStateCbs.clear();
            client.disconnectCbs.clear();
        }
        this.clients.clear();
    }
}

// ─── InMemoryMultiplayerProvider ──────────────────────────────────────────────

export class InMemoryMultiplayerProvider implements MultiplayerProvider {
    private readonly sessions = new Map<string, InMemoryChannel>();

    /** Per-instance counter — avoids module-level mutable state and test pollution. */
    private idCounter = 0;

    private nextId(): string {
        this.idCounter += 1;
        return String(this.idCounter);
    }

    hostLobby(params: HostLobbyParams): Promise<HostedSession> {
        const lobbyCode = `in-memory-${this.nextId()}`;
        const lobbyInfo: LobbyInfo = {
            sessionId: lobbyCode,
            hostId: toPlayerId(`host-${this.nextId()}`),
            gameId: params.gameId,
        };
        const channel = new InMemoryChannel(lobbyCode, lobbyInfo);
        this.sessions.set(lobbyCode, channel);

        const transport: HostTransport = {
            sendSnapshot: (playerId: PlayerId, snapshot: PlayerSnapshot): void => {
                const client = channel.clients.get(playerId);
                if (client) {
                    for (const cb of client.snapshotCbs) cb(snapshot);
                }
            },

            broadcastLobbyState: (state: LobbyState): void => {
                channel.latestLobbyState = state;
                for (const client of channel.clients.values()) {
                    for (const cb of client.lobbyStateCbs) cb(state);
                }
            },

            sendSideChannel: (target: PlayerId | 'broadcast', msg: SideChannelMessage): void => {
                if (target === 'broadcast') {
                    for (const client of channel.clients.values()) {
                        for (const cb of client.sideChannelCbs) cb(msg);
                    }
                } else {
                    const client = channel.clients.get(target);
                    if (client) {
                        for (const cb of client.sideChannelCbs) cb(msg);
                    }
                }
            },

            onActionReceived: (cb: ActionCb): Unsubscribe => addSub(channel.actionCbs, cb),

            onReadyStateUpdate: (cb: ReadyStateCb): Unsubscribe =>
                addSub(channel.readyStateCbs, cb),

            onSideChannelReceived: (cb: HostSideChannelCb): Unsubscribe =>
                addSub(channel.hostSideChannelCbs, cb),

            onPlayerJoined: (cb: PlayerJoinedCb): Unsubscribe =>
                addSub(channel.playerJoinedCbs, cb),

            onPlayerLeft: (cb: PlayerLeftCb): Unsubscribe => addSub(channel.playerLeftCbs, cb),
        };

        const session: HostedSession = {
            lobbyCode,
            lobbyInfo,
            transport,
            close: (): Promise<void> => {
                this.sessions.delete(lobbyCode);
                channel.closeAll();
                return Promise.resolve();
            },
        };

        return Promise.resolve(session);
    }

    joinLobby(params: JoinLobbyParams): Promise<JoinedSession> {
        const channel = this.sessions.get(params.address);
        if (!channel) {
            return Promise.reject(
                new Error(
                    `InMemoryMultiplayerProvider: no session found for address "${params.address}"`,
                ),
            );
        }

        const clientPlayerId: PlayerId = toPlayerId(`client-${this.nextId()}`);
        const record = channel.addClient(clientPlayerId);

        const playerEntry: LobbyPlayerEntry = {
            playerId: clientPlayerId,
            displayName: `Player-${clientPlayerId}`,
            ready: false,
        };

        // Notify the host that this client has joined on the next macrotask so
        // the await continuation that receives JoinedSession can run first.
        // This avoids dropping host reactions that depend on client-side
        // subscriptions being installed right after await joinLobby().
        setTimeout(() => {
            for (const cb of channel.playerJoinedCbs) cb(playerEntry);
        }, 0);

        const latestState = channel.latestLobbyState;
        const playersWithJoined =
            latestState === null
                ? [
                      {
                          playerId: channel.lobbyInfo.hostId,
                          displayName: channel.lobbyInfo.hostId,
                          ready: false,
                      },
                      playerEntry,
                  ]
                : latestState.players.some((entry) => entry.playerId === clientPlayerId)
                  ? latestState.players
                  : [...latestState.players, playerEntry];

        const initialLobbyState: LobbyState = {
            info:
                latestState === null
                    ? {
                          sessionId: channel.lobbyInfo.sessionId,
                          hostId: channel.lobbyInfo.hostId,
                          gameId: channel.lobbyInfo.gameId,
                      }
                    : latestState.info,
            players: playersWithJoined,
        };

        const transport: ClientTransport = {
            sendAction: (action: EngineAction): void => {
                for (const cb of channel.actionCbs) cb(clientPlayerId, action);
            },

            sendReadyStateUpdate: (ready: boolean): void => {
                for (const cb of channel.readyStateCbs) cb(clientPlayerId, ready);
            },

            sendSideChannel: (msg: SideChannelMessage): void => {
                for (const cb of channel.hostSideChannelCbs) cb(clientPlayerId, msg);
            },

            onSnapshotReceived: (cb: SnapshotCb): Unsubscribe => addSub(record.snapshotCbs, cb),

            onSideChannelReceived: (cb: ClientSideChannelCb): Unsubscribe =>
                addSub(record.sideChannelCbs, cb),

            onLobbyStateChanged: (cb: LobbyStateCb): Unsubscribe =>
                addSub(record.lobbyStateCbs, cb),

            onDisconnected: (cb: DisconnectCb): Unsubscribe => addSub(record.disconnectCbs, cb),
        };

        const session: JoinedSession = {
            lobbyInfo: channel.lobbyInfo,
            localPlayerId: clientPlayerId,
            initialLobbyState,
            transport,
            disconnect: (): Promise<void> => {
                for (const cb of channel.playerLeftCbs) cb(clientPlayerId, 'normal');
                channel.removeClient(clientPlayerId);
                return Promise.resolve();
            },
        };

        return Promise.resolve(session);
    }

    dispose(): void {
        for (const channel of this.sessions.values()) {
            channel.closeAll();
        }
        this.sessions.clear();
    }
}
