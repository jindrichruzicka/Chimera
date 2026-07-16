/**
 * networking/provider/InMemoryMultiplayerProvider.ts
 *
 * Test double implementing MultiplayerProvider using shared in-memory event
 * channels. Connects host and client sessions without WebSockets or real I/O.
 *
 * Intended for MultiplayerProvider contract tests and other unit/integration tests.
 *
 * Must NOT import from networking/provider/local/ — this is an independent provider.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
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
    JoinClassification,
    JoinClassifierContext,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
    LobbyInfo,
} from './MultiplayerProvider.js';
import type { PlayerId, EngineAction } from '@chimera-engine/simulation/contracts';
import {
    REJECT_REASON_MATCH_IN_PROGRESS,
    type WireCommitmentReveal,
} from '@chimera-engine/simulation/foundation/messages.js';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import { playerId as toPlayerId, JoinRejectedError } from './MultiplayerProvider.js';
import { resolveRestoredSeat, sanitizeSeatClaims } from './seat-claims.js';
import type { SeatResolutionContext } from './seat-claims.js';
import { DEFAULT_MAX_SPECTATORS } from './spectator-policy.js';

// ─── Internal types ───────────────────────────────────────────────────────────

type ActionCb = (from: PlayerId, action: EngineAction) => void;
type ReadyStateCb = (from: PlayerId, ready: boolean) => void;
type PlayerAttributeCb = (from: PlayerId, key: string, value: string) => void;
type SpectateTargetCb = (from: PlayerId, targetPlayerId: PlayerId) => void;
type HostSideChannelCb = (from: PlayerId, msg: SideChannelMessage) => void;
type PlayerJoinedCb = (player: LobbyPlayerEntry) => void;
type PlayerLeftCb = (playerId: PlayerId, reason: DisconnectReason) => void;
type SnapshotCb = (snapshot: PlayerSnapshot, checksum: number) => void;
type TickCb = (tick: number) => void;
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
    readonly tickCbs: Set<TickCb>;
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
    readonly playerAttributeCbs = new Set<PlayerAttributeCb>();
    readonly spectateTargetCbs = new Set<SpectateTargetCb>();
    readonly hostSideChannelCbs = new Set<HostSideChannelCb>();
    readonly playerJoinedCbs = new Set<PlayerJoinedCb>();
    readonly playerLeftCbs = new Set<PlayerLeftCb>();

    // Per-client records
    readonly clients = new Map<PlayerId, ClientRecord>();
    latestLobbyState: LobbyState | null = null;

    /** Optional profile gate registered by the host via HostTransport.setProfileGate(). */
    profileGate: ((pid: PlayerId, rawProfile: unknown) => JoinGateResult) | null = null;

    /** Optional join classifier registered by the host via HostTransport.setJoinClassifier(). */
    joinClassifier: ((pid: PlayerId, ctx: JoinClassifierContext) => JoinClassification) | null =
        null;

    /**
     * Read-only spectators (Invariant #114). Kept out of the player roster and
     * the reconnect/claim ledger; bounded independently of player capacity. A
     * spectator's `ClientRecord` still lives in `clients` for a well-formed
     * transport, but membership here excludes it from the roster.
     */
    readonly spectators = new Set<PlayerId>();

    closed = false;

    // Restored-session seams — the resolution policy itself lives in the shared
    // `resolveRestoredSeat`; seats are seeded for id resolution only, never
    // fabricated into a roster.
    /** Host-filtered restored seats in slotIndex order (insertion-ordered). */
    readonly restoredSeats = new Set<PlayerId>();
    /** Seats handed out at least once — the claimless fallback never re-hands them. */
    readonly claimedSeats = new Set<PlayerId>();
    /** Every identity that completed a join — the only reconnectable ids. */
    readonly everConnected = new Set<PlayerId>();
    /** Lookups handed to the shared seat resolver. */
    readonly seatResolutionCtx: SeatResolutionContext;

    constructor(lobbyCode: string, lobbyInfo: LobbyInfo, restore: HostLobbyParams['restore']) {
        this.lobbyCode = lobbyCode;
        this.lobbyInfo = lobbyInfo;
        for (const pid of restore?.humanSeats ?? []) {
            if (pid === restore?.hostPlayerId) continue;
            this.restoredSeats.add(pid);
        }
        this.seatResolutionCtx = {
            matchId: restore?.matchId,
            hostPlayerId: restore?.hostPlayerId,
            restoredSeats: this.restoredSeats,
            isConnected: (pid) => this.clients.has(pid),
            isReconnectable: (pid) => this.everConnected.has(pid),
            isHandedOut: (pid) => this.claimedSeats.has(pid),
        };
    }

    addClient(playerId: PlayerId): ClientRecord {
        const record: ClientRecord = {
            playerId,
            snapshotCbs: new Set(),
            tickCbs: new Set(),
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

    /**
     * Records that receive host BROADCASTS (lobby state, side-channel, reveal).
     * Spectators are excluded — they hold no seat and, mirroring LobbyServer's
     * `broadcast()` over `connections` (never `spectatorConnections`), must not
     * receive the all-clients fan-out (Invariant #41 parity, Invariant #114).
     */
    *broadcastRecords(): IterableIterator<ClientRecord> {
        for (const [pid, record] of this.clients) {
            if (this.spectators.has(pid)) continue;
            yield record;
        }
    }

    closeAll(): void {
        this.closed = true;
        for (const client of this.clients.values()) {
            for (const cb of client.disconnectCbs) cb('host_closed');
        }
        this.actionCbs.clear();
        this.readyStateCbs.clear();
        this.playerAttributeCbs.clear();
        this.hostSideChannelCbs.clear();
        this.playerJoinedCbs.clear();
        this.playerLeftCbs.clear();
        for (const client of this.clients.values()) {
            client.snapshotCbs.clear();
            client.tickCbs.clear();
            client.sideChannelCbs.clear();
            client.revealCbs.clear();
            client.lobbyStateCbs.clear();
            client.disconnectCbs.clear();
        }
        this.clients.clear();
        this.spectators.clear();
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
            // A restored session reclaims its saved host id.
            hostId: params.restore?.hostPlayerId ?? toPlayerId(`host-${this.nextId()}`),
            gameId: params.gameId,
        };
        const channel = new InMemoryChannel(lobbyCode, lobbyInfo, params.restore);
        this.sessions.set(lobbyCode, channel);

        const transport: HostTransport = {
            sendSnapshot: (playerId: PlayerId, snapshot: PlayerSnapshot): void => {
                const client = channel.clients.get(playerId);
                if (client) {
                    const checksum = crc32Json(snapshot);
                    for (const cb of client.snapshotCbs) cb(snapshot, checksum);
                }
            },

            sendTick: (playerId: PlayerId, tick: number): void => {
                const client = channel.clients.get(playerId);
                if (client) {
                    for (const cb of client.tickCbs) cb(tick);
                }
            },

            broadcastLobbyState: (state: LobbyState): void => {
                channel.latestLobbyState = state;
                for (const client of channel.broadcastRecords()) {
                    for (const cb of client.lobbyStateCbs) cb(state);
                }
            },

            sendSideChannel: (target: PlayerId | 'broadcast', msg: SideChannelMessage): void => {
                if (target === 'broadcast') {
                    for (const client of channel.broadcastRecords()) {
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
                    for (const client of channel.broadcastRecords()) {
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

            onPlayerAttributeUpdate: (cb: PlayerAttributeCb): Unsubscribe =>
                addSub(channel.playerAttributeCbs, cb),

            onSpectateTargetUpdate: (cb: SpectateTargetCb): Unsubscribe =>
                addSub(channel.spectateTargetCbs, cb),

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

            setJoinClassifier: (
                classify: (pid: PlayerId, ctx: JoinClassifierContext) => JoinClassification,
            ): void => {
                channel.joinClassifier = classify;
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

        // Sanitize at the join boundary — same seam as LocalWebSocketProvider,
        // so the shared resolver receives bounded, shape-exact claims.
        const clientPlayerId =
            resolveRestoredSeat(
                channel.seatResolutionCtx,
                params.reconnectPlayerId,
                sanitizeSeatClaims(params.claims),
            ) ?? this.mintFreshClientId(channel);

        // Profile gate check (Invariant #61 — gate is the only path to admission).
        // Reclaimed restored seats default to the seat id, matching LobbyServer's
        // seeded-displayName behavior.
        let displayName = channel.restoredSeats.has(clientPlayerId)
            ? String(clientPlayerId)
            : `Player-${clientPlayerId}`;
        if (channel.profileGate !== null) {
            const gateResult = channel.profileGate(clientPlayerId, params.profile);
            if (!gateResult.admitted) {
                // Typed rejection so consumers branch on the structured reason
                // (parity with LocalWebSocketProvider) — see JoinRejectedError.
                return Promise.reject(new JoinRejectedError(gateResult.reason));
            }
            displayName = gateResult.displayName;
        }

        // Join classification (Invariant #114) — parity with LobbyServer. Runs
        // after the profile gate; no classifier ⇒ player. A retained/restored
        // seat is a reconnect and is always a player.
        const reconnect =
            channel.everConnected.has(clientPlayerId) || channel.restoredSeats.has(clientPlayerId);
        const classification: JoinClassification =
            channel.joinClassifier !== null
                ? channel.joinClassifier(clientPlayerId, { reconnect })
                : { role: 'player' };
        if ('reject' in classification) {
            return Promise.reject(new JoinRejectedError(classification.reject));
        }
        const role = classification.role;
        if (role === 'spectator' && channel.spectators.size >= DEFAULT_MAX_SPECTATORS) {
            // Spectator cap reached — a full gallery reads as a running match a
            // fresh viewer cannot join (parity with LobbyServer's cap reject).
            return Promise.reject(new JoinRejectedError(REJECT_REASON_MATCH_IN_PROGRESS));
        }

        const record = channel.addClient(clientPlayerId);
        if (role === 'spectator') {
            // Spectators hold no seat: excluded from the roster and the
            // reconnect/claim ledger, tracked only for the cap and roster skip.
            channel.spectators.add(clientPlayerId);
        } else {
            // Only now is the identity consumed — marking any earlier would let a
            // gate-rejected join burn a restored seat for the claimless fallback
            // or open it to reconnect claims.
            channel.everConnected.add(clientPlayerId);
            if (channel.restoredSeats.has(clientPlayerId)) {
                channel.claimedSeats.add(clientPlayerId);
            }
        }

        const playerEntry: LobbyPlayerEntry = {
            playerId: clientPlayerId,
            displayName,
            ready: false,
            // Carry the spectator role for the who's-watching flag; a player
            // entry stays role-less (undefined ⇒ player).
            ...(role === 'spectator' ? { role } : {}),
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
            // Spectators never appear in the authoritative roster (Invariant #114).
            if (channel.spectators.has(existingClientId)) continue;
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

            sendPlayerAttributeUpdate: (key: string, value: string): void => {
                for (const cb of channel.playerAttributeCbs) cb(clientPlayerId, key, value);
            },

            sendSpectateTarget: (targetPlayerId: PlayerId): void => {
                // The spectator's identity is the connection-bound `clientPlayerId`;
                // a client-supplied id can never be trusted (Invariant #99).
                for (const cb of channel.spectateTargetCbs) cb(clientPlayerId, targetPlayerId);
            },

            sendSideChannel: (msg: SideChannelMessage): void => {
                for (const cb of channel.hostSideChannelCbs) cb(clientPlayerId, msg);
            },

            onSnapshotReceived: (cb: SnapshotCb): Unsubscribe => addSub(record.snapshotCbs, cb),

            onTickReceived: (cb: TickCb): Unsubscribe => addSub(record.tickCbs, cb),

            onSideChannelReceived: (cb: ClientSideChannelCb): Unsubscribe =>
                addSub(record.sideChannelCbs, cb),

            onReveal: (cb: RevealCb): Unsubscribe => addSub(record.revealCbs, cb),

            onLobbyStateChanged: (cb: LobbyStateCb): Unsubscribe =>
                addSub(record.lobbyStateCbs, cb),

            onDisconnected: (cb: DisconnectCb): Unsubscribe => addSub(record.disconnectCbs, cb),

            onLatencyUpdate:
                (_cb: (latencyMs: number) => void): Unsubscribe =>
                (): void => {
                    // No latency measurement in the in-memory provider.
                },
        };

        const session: JoinedSession = {
            lobbyInfo: channel.lobbyInfo,
            localPlayerId: clientPlayerId,
            role,
            initialLobbyState,
            transport,
            disconnect: (): Promise<void> => {
                for (const cb of channel.playerLeftCbs) cb(clientPlayerId, 'normal');
                channel.removeClient(clientPlayerId);
                channel.spectators.delete(clientPlayerId);
                return Promise.resolve();
            },
        };

        return Promise.resolve(session);
    }

    private mintFreshClientId(channel: InMemoryChannel): PlayerId {
        // Restored seats saved from a prior InMemory session are themselves
        // 'client-N' ids while the counter restarts per provider — skip
        // occupied ids so a "fresh" mint can never collide.
        let pid: PlayerId;
        do {
            pid = toPlayerId(`client-${this.nextId()}`);
        } while (channel.restoredSeats.has(pid) || channel.clients.has(pid));
        return pid;
    }

    dispose(): void {
        for (const channel of this.sessions.values()) {
            channel.closeAll();
        }
        this.sessions.clear();
    }
}
