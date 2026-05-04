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
    JoinGateResult,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
    LobbyInfo,
} from './MultiplayerProvider.js';
import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type { WireCommitmentReveal } from '@chimera/shared/messages.js';
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
type RevealCb = (reveal: WireCommitmentReveal) => void;
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
    readonly revealCbs: Set<RevealCb>;
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

    /** Optional profile gate registered by the host via HostTransport.setProfileGate(). */
    profileGate: ((pid: PlayerId, rawProfile: unknown) => JoinGateResult) | null = null;

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
            revealCbs: new Set(),
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
            client.revealCbs.clear();
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

            sendReveal: (target: PlayerId | 'broadcast', reveal: WireCommitmentReveal): void => {
                if (target === 'broadcast') {
                    for (const client of channel.clients.values()) {
                        for (const cb of client.revealCbs) cb(reveal);
                    }
                } else {
                    const client = channel.clients.get(target);
                    if (client) {
                        for (const cb of client.revealCbs) cb(reveal);
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

            setProfileGate: (
                gate: (pid: PlayerId, rawProfile: unknown) => JoinGateResult,
            ): void => {
                channel.profileGate = gate;
            },
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

        // Profile gate check (Invariant #61 — gate is the only path to admission)
        let displayName = `Player-${clientPlayerId}`;
        if (channel.profileGate !== null) {
            const gateResult = channel.profileGate(clientPlayerId, params.profile);
            if (!gateResult.admitted) {
                return Promise.reject(new Error(`JOIN rejected: ${gateResult.reason}`));
            }
            displayName = gateResult.displayName;
        }

        const record = channel.addClient(clientPlayerId);

        const playerEntry: LobbyPlayerEntry = {
            playerId: clientPlayerId,
            displayName,
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
        const info =
            latestState === null
                ? {
                      sessionId: channel.lobbyInfo.sessionId,
                      hostId: channel.lobbyInfo.hostId,
                      gameId: channel.lobbyInfo.gameId,
                  }
                : latestState.info;

        const byId = new Map<PlayerId, LobbyPlayerEntry>();
        if (latestState !== null) {
            for (const entry of latestState.players) {
                byId.set(entry.playerId, entry);
            }
        }

        if (!byId.has(info.hostId)) {
            byId.set(info.hostId, {
                playerId: info.hostId,
                displayName: info.hostId,
                ready: false,
            });
        }

        const nextPlayers: LobbyPlayerEntry[] = [byId.get(info.hostId)!];
        for (const [existingClientId] of channel.clients) {
            const existing = byId.get(existingClientId);
            if (existing !== undefined) {
                nextPlayers.push(existing);
                continue;
            }
            if (existingClientId === clientPlayerId) {
                nextPlayers.push(playerEntry);
                continue;
            }
            nextPlayers.push({
                playerId: existingClientId,
                displayName: `Player-${existingClientId}`,
                ready: false,
            });
        }

        const initialLobbyState: LobbyState = {
            info,
            players: nextPlayers,
        };
        channel.latestLobbyState = initialLobbyState;

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

            onReveal: (cb: RevealCb): Unsubscribe => addSub(record.revealCbs, cb),

            onLobbyStateChanged: (cb: LobbyStateCb): Unsubscribe =>
                addSub(record.lobbyStateCbs, cb),

            onDisconnected: (cb: DisconnectCb): Unsubscribe => addSub(record.disconnectCbs, cb),

            onLatencyUpdate:
                (_cb: (latencyMs: number) => void): Unsubscribe =>
                (): void => {
                    // InMemoryMultiplayerProvider does not measure latency — no-op stub.
                },
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
