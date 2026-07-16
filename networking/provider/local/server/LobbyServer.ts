/**
 * networking/provider/local/server/LobbyServer.ts
 *
 * WebSocket server backbone for LocalWebSocketProvider.
 *
 * Responsibilities:
 *   - Bind a ws.Server to localhost on a given (or OS-assigned) port
 *   - Handle the JOIN handshake: validate token, assign PlayerId, send WELCOME/REJECT
 *   - Maintain a Map<PlayerId, WebSocket> of authenticated connections
 *   - Expose typed send/broadcast helpers that serialize ServerMessage to JSON
 *   - Fire observable events: onPlayerConnected, onPlayerDisconnected, onMessage
 *
 * This module is intentionally ws-aware — it is the ONLY place inside
 * LocalWebSocketProvider that touches ws.Server and ws.WebSocket directly.
 * All higher-level code (WsHostTransport, MessageRouter, LocalWebSocketProvider)
 * talks to LobbyServer through its typed API, never to ws primitives.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 *
 * Invariants upheld:
 *   #1  — Only PlayerSnapshot crosses wire boundaries; LobbyServer never
 *         serialises GameSnapshot
 *   #2  — Zero imports from renderer/, electron/, or DOM APIs
 *   networking boundary — LobbyServer is internal to networking/provider/local/
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { PlayerId } from '@chimera-engine/simulation/contracts';
import { playerId as toPlayerId } from '../../MultiplayerProvider.js';
import type {
    JoinGateResult,
    JoinClassification,
    JoinClassifierContext,
    LobbyPlayerEntry,
    LobbyState,
    SeatClaim,
} from '../../MultiplayerProvider.js';
import { resolveRestoredSeat } from '../../seat-claims.js';
import type { SeatResolutionContext } from '../../seat-claims.js';
import { DEFAULT_MAX_SPECTATORS } from '../../spectator-policy.js';
import {
    REJECT_REASON_MATCH_IN_PROGRESS,
    type ClientMessage,
    type ServerMessage,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { ClientMessageSchema } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { MessageBus } from './MessageBus.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

export type MessageCallback = (from: PlayerId, msg: ClientMessage) => void;
export type PlayerCallback = (
    playerId: PlayerId,
    displayName: string,
    role: 'player' | 'spectator',
) => void;
export type DisconnectCallback = (playerId: PlayerId, reason: DisconnectReason) => void;

export type DisconnectReason = 'kicked' | 'timeout' | 'host_closed' | 'error' | 'normal';

export interface LobbyServerOptions {
    /** Port to listen on. Pass 0 for OS-assigned random port. */
    readonly port: number;
    readonly gameId: string;
    readonly maxPlayers: number;
    /**
     * Optional cap on concurrent spectators. Spectators never count against
     * `maxPlayers`; a full player lobby still admits spectators up to this cap.
     * Defaults to {@link DEFAULT_MAX_SPECTATORS}.
     */
    readonly maxSpectators?: number;
    /**
     * Optional host-set lobby password. When non-empty, every JOIN must
     * present a matching `password` (compared timing-safe) or is rejected with
     * `REJECT 'invalid_password'`. When undefined/empty the lobby is open. The
     * secret stays here — it is never written to `LobbyState` or logged.
     */
    readonly password?: string;
    /** Optional structured logger. Logs join/leave events and validation failures. */
    readonly logger?: Logger;
    /**
     * Stable match identity of a restored session. A JOIN seat claim is only
     * honored when its `matchId` equals this value; absent on
     * non-restored lobbies, so no claim can ever match.
     */
    readonly matchId?: string;
    /**
     * Saved host PlayerId of a restored session. Minted as the lobby's `hostId`
     * instead of the default `host-${token}`, and never
     * grantable to a joining client's claim.
     */
    readonly hostPlayerId?: PlayerId;
    /**
     * Non-host restored human seats, pre-sorted slotIndex-ascending. Seeded
     * into `knownPlayers` for id resolution only — never broadcast as a
     * fabricated roster — and handed out in order to claimless joins as the
     * join-order fallback.
     */
    readonly restoredSeats?: readonly PlayerId[];
}

// ─── LobbyServer ──────────────────────────────────────────────────────────────

/**
 * WebSocket server that manages authenticated player connections for one
 * LocalWebSocketProvider hosted session.
 *
 * Lifecycle:
 *   1. Construct: `new LobbyServer(opts)` — starts binding immediately
 *   2. `await server.ready()` — resolves when the port is bound and listening
 *   3. Use `server.port` and `server.token` to build the lobby code
 *   4. `await server.close()` — gracefully terminates all connections
 */
export class LobbyServer implements MessageBus {
    private readonly wss: WebSocketServer;
    private readonly connections = new Map<PlayerId, WebSocket>();
    /**
     * Read-only spectator connections, kept out of `connections` so they never
     * count against the player-capacity gate. Bounded by `maxSpectators`.
     * A spectator holds no seat and no agent (Invariant #114): it receives its
     * perspective snapshots via `sendToPlayer` unicast, is never part of
     * `broadcast()`, and its ACTION messages are dropped at this boundary.
     */
    private readonly spectatorConnections = new Map<PlayerId, WebSocket>();
    private readonly _token: string;
    private _port = 0;

    private readonly messageCbs = new Set<MessageCallback>();
    private readonly connectedCbs = new Set<PlayerCallback>();
    private readonly disconnectedCbs = new Set<DisconnectCallback>();
    private latestLobbyState: LobbyState | null = null;
    private readonly knownPlayers = new Map<PlayerId, LobbyPlayerEntry>();
    /**
     * Host-filtered restored seats in slotIndex order — the claim universe and
     * the claimless join-order fallback.
     */
    private readonly restoredSeatSet = new Set<PlayerId>();
    /**
     * Restored seats that have been handed out at least once. The join-order
     * fallback never re-hands such a seat — after a drop it stays reclaimable
     * via an explicit claim or reconnectPlayerId only.
     */
    private readonly claimedRestoredSeats = new Set<PlayerId>();
    /**
     * Every identity that completed a JOIN on this server instance.
     * `reconnectPlayerId` is only honored for these — never for merely-seeded
     * restored seats — so a stale ticket cannot bypass the matchId gate that
     * claims enforce, and the never-connecting host id cannot be seized.
     */
    private readonly everConnected = new Set<PlayerId>();
    /** Lookups handed to the shared seat resolver. */
    private readonly seatResolutionCtx: SeatResolutionContext;

    private readonly opts: LobbyServerOptions;
    private readonly maxSpectators: number;
    private readonly logger: Logger | undefined;
    private idCounter = 0;
    private closed = false;
    private readonly readyPromise: Promise<void>;
    /**
     * Optional profile gate set by the host via `setJoinGate()`.
     * Called synchronously during JOIN handling before WELCOME is sent.
     */
    private joinGate: ((pid: PlayerId, rawProfile: unknown) => JoinGateResult) | null = null;
    /**
     * Optional join classifier set by the host via `setJoinClassifier()`. Runs
     * after the profile gate admits and decides player / spectator / reject. No
     * classifier ⇒ every profile-admitted JOIN is a player (legacy behaviour).
     */
    private joinClassifier:
        | ((pid: PlayerId, ctx: JoinClassifierContext) => JoinClassification)
        | null = null;

    constructor(opts: LobbyServerOptions) {
        this.opts = opts;
        this.maxSpectators = opts.maxSpectators ?? DEFAULT_MAX_SPECTATORS;
        this.logger = opts.logger;
        this._token = randomBytes(16).toString('hex');

        // Seed restored seats for join-time id resolution. The knownPlayers
        // entry only provides the seat's displayName default —
        // this never touches latestLobbyState, so the roster the host
        // broadcasts still starts with the host entry only.
        for (const pid of opts.restoredSeats ?? []) {
            if (pid === opts.hostPlayerId) continue;
            this.restoredSeatSet.add(pid);
            this.knownPlayers.set(pid, { playerId: pid, displayName: pid, ready: false });
        }
        this.seatResolutionCtx = {
            matchId: opts.matchId,
            hostPlayerId: opts.hostPlayerId,
            restoredSeats: this.restoredSeatSet,
            isConnected: (pid) => this.connections.has(pid),
            // knownPlayers preserves the LEAVE-forgets semantics; everConnected
            // keeps merely-seeded seats out of the reconnect path.
            isReconnectable: (pid) => this.knownPlayers.has(pid) && this.everConnected.has(pid),
            isHandedOut: (pid) => this.claimedRestoredSeats.has(pid),
        };

        this.wss = new WebSocketServer({
            port: opts.port,
            host: '127.0.0.1',
            maxPayload: 1_048_576,
        });

        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.wss.once('listening', () => {
                const addr = this.wss.address();
                if (addr && typeof addr === 'object') {
                    this._port = addr.port;
                }
                resolve();
            });
            this.wss.once('error', reject);
        });

        this.wss.on('connection', (ws: WebSocket) => {
            this.handleConnection(ws);
        });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Resolves when the server is bound and ready to accept connections. */
    ready(): Promise<void> {
        return this.readyPromise;
    }

    /** The bound port. Meaningful only after `ready()` resolves. */
    get port(): number {
        return this._port;
    }

    /** The auth token clients must present in their JOIN message. */
    get token(): string {
        return this._token;
    }

    /**
     * Send a serialised ServerMessage to one specific authenticated client —
     * a seated player or a spectator (spectators receive their perspective
     * snapshots through this unicast path; they are never part of
     * `broadcast()`). No-op if the PlayerId is not connected.
     */
    sendToPlayer(playerId: PlayerId, msg: ServerMessage): void {
        const ws = this.connections.get(playerId) ?? this.spectatorConnections.get(playerId);
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    /**
     * Send a serialised ServerMessage to every authenticated client.
     */
    broadcast(msg: ServerMessage): void {
        const serialised = JSON.stringify(msg);
        for (const ws of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(serialised);
            }
        }
    }

    /** Cache and broadcast the authoritative lobby roster for future JOIN welcomes. */
    broadcastLobbyState(state: LobbyState): void {
        this.rememberPlayers(state.players);
        this.latestLobbyState = state;
        this.broadcast({ type: 'LOBBY_STATE', state });
    }

    /**
     * Subscribe to inbound ClientMessages from authenticated players.
     * Un-authenticated messages (before JOIN completes) are silently dropped.
     */
    onMessage(cb: MessageCallback): Unsubscribe {
        this.messageCbs.add(cb);
        return (): void => {
            this.messageCbs.delete(cb);
        };
    }

    /**
     * Subscribe to player-connected events (fires after successful JOIN/WELCOME).
     */
    onPlayerConnected(cb: PlayerCallback): Unsubscribe {
        this.connectedCbs.add(cb);
        return (): void => {
            this.connectedCbs.delete(cb);
        };
    }

    /**
     * Subscribe to player-disconnected events.
     */
    onPlayerDisconnected(cb: DisconnectCallback): Unsubscribe {
        this.disconnectedCbs.add(cb);
        return (): void => {
            this.disconnectedCbs.delete(cb);
        };
    }

    /**
     * Register a profile gate.  Called synchronously during the JOIN handshake
     * (after token and capacity checks) before WELCOME is sent.
     *
     * Returning `{ admitted: true }` allows the join; returning `{ admitted: false }`
     * causes REJECT `{ reason }` to be sent and the connection to be closed.
     *
     * If no gate is registered, all token-valid JOINs are admitted with the
     * assigned `PlayerId` used as the display name.
     */
    setJoinGate(gate: (pid: PlayerId, rawProfile: unknown) => JoinGateResult): void {
        this.joinGate = gate;
    }

    /**
     * Register a join classifier. Called synchronously during the JOIN
     * handshake, after the profile gate admits, to decide the role — `player`
     * (default), `spectator`, or `reject`. A `spectator` result admits a
     * read-only viewer that does not consume a player seat (bounded by
     * `maxSpectators`); a `reject` result sends REJECT with the reason and
     * closes. No classifier ⇒ every profile-admitted JOIN is a player.
     */
    setJoinClassifier(
        classify: (pid: PlayerId, ctx: JoinClassifierContext) => JoinClassification,
    ): void {
        this.joinClassifier = classify;
    }

    /**
     * Gracefully close the server.
     * - Sends 'host_closed' to all connected clients
     * - Closes all ws connections
     * - Stops the listening server
     * Safe to call multiple times.
     */
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        // Notify all clients — snapshot the map before iterating.
        const closeMsg: ServerMessage = {
            type: 'CLOSE',
            reason: 'host_closed',
        };
        const serialised = JSON.stringify(closeMsg);
        const entries = [...this.connections.entries(), ...this.spectatorConnections.entries()];
        for (const [playerId, ws] of entries) {
            if (ws.readyState === WebSocket.OPEN) {
                // Flush the CLOSE frame first, then close in the callback.
                ws.send(serialised, () => ws.close());
            }
            for (const cb of this.disconnectedCbs) {
                cb(playerId, 'host_closed');
            }
        }
        this.connections.clear();
        this.spectatorConnections.clear();

        return new Promise<void>((resolve) => {
            this.wss.close(() => resolve());
        });
    }

    // ─── Connection handling ──────────────────────────────────────────────────

    private handleConnection(ws: WebSocket): void {
        let authenticated = false;
        let playerId: PlayerId | null = null;
        // Set when the client sends an explicit LEAVE before closing. Lets the
        // close handler distinguish an intentional departure (`'normal'`) from a
        // transient drop (`'timeout'`), so the host's opponent-presence toasts
        // never fire "disconnected" on a deliberate leave.
        let intentionalLeave = false;

        const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]): void => {
            let parsed: unknown;
            try {
                const text = Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf8')
                    : raw instanceof ArrayBuffer
                      ? Buffer.from(raw).toString('utf8')
                      : raw.toString('utf8');
                parsed = JSON.parse(text);
            } catch {
                // Malformed JSON — ignore silently
                return;
            }

            if (!isClientMessageValid(parsed)) return;
            const msg = parsed;

            if (!authenticated) {
                if (msg.type !== 'JOIN') {
                    ws.send(
                        JSON.stringify({
                            type: 'REJECT',
                            reason: 'not_authenticated',
                            tick: 0,
                        } satisfies ServerMessage),
                    );
                    ws.close();
                    return;
                }

                // Validate token — timing-safe comparison.
                if (!timingSafeTokenEqual(msg.token, this._token)) {
                    ws.send(
                        JSON.stringify({
                            type: 'REJECT',
                            reason: 'invalid_token',
                            tick: 0,
                        } satisfies ServerMessage),
                    );
                    ws.close();
                    return;
                }

                // Validate lobby password — timing-safe, only when the host set
                // one. An empty/undefined host password leaves the lobby open.
                // A missing or mismatched client password is rejected before
                // WELCOME; the secret is never echoed back to the client.
                const requiredPassword = this.opts.password;
                if (
                    requiredPassword !== undefined &&
                    requiredPassword.length > 0 &&
                    !timingSafeTokenEqual(msg.password ?? '', requiredPassword)
                ) {
                    ws.send(
                        JSON.stringify({
                            type: 'REJECT',
                            reason: 'invalid_password',
                            tick: 0,
                        } satisfies ServerMessage),
                    );
                    ws.close();
                    return;
                }

                const pid = this.resolveJoinPlayerId(msg.reconnectPlayerId, msg.claims);

                // Profile gate check (Invariant #61)
                let displayName: string = this.knownPlayers.get(pid)?.displayName ?? pid;
                if (this.joinGate !== null) {
                    const gateResult = this.joinGate(pid, msg.profile);
                    if (!gateResult.admitted) {
                        ws.send(
                            JSON.stringify({
                                type: 'REJECT',
                                reason: gateResult.reason,
                                tick: 0,
                            } satisfies ServerMessage),
                        );
                        ws.close();
                        return;
                    }
                    displayName = gateResult.displayName;
                }

                // Join classification (Invariant #114). Runs after the profile
                // gate. With no classifier installed the result is `player`, so
                // the player-capacity gate below still rejects a full lobby with
                // `lobby_full` — its effect is unchanged, only its position moved
                // (now after the profile gate + pid resolution) so a spectator can
                // slip past a full player lobby. Position-only edge: on a full
                // lobby the profile gate now runs first, so a rejected profile
                // reports its own reason rather than `lobby_full` (both still
                // reject + close). A retained/restored seat is a reconnect and is
                // always a player, independent of match phase.
                const reconnect = this.everConnected.has(pid) || this.restoredSeatSet.has(pid);
                const classification: JoinClassification =
                    this.joinClassifier !== null
                        ? this.joinClassifier(pid, { reconnect })
                        : { role: 'player' };

                if ('reject' in classification) {
                    ws.send(
                        JSON.stringify({
                            type: 'REJECT',
                            reason: classification.reject,
                            tick: 0,
                        } satisfies ServerMessage),
                    );
                    ws.close();
                    return;
                }

                const role = classification.role;

                if (role === 'spectator') {
                    // Spectators never consume a player seat; a separate cap
                    // bounds them so a full player lobby still admits viewers.
                    if (this.spectatorConnections.size >= this.maxSpectators) {
                        ws.send(
                            JSON.stringify({
                                type: 'REJECT',
                                reason: REJECT_REASON_MATCH_IN_PROGRESS,
                                tick: 0,
                            } satisfies ServerMessage),
                        );
                        ws.close();
                        return;
                    }
                    this.spectatorConnections.set(pid, ws);
                } else {
                    // Player-capacity gate — unchanged semantics; only its
                    // position moved (now after classification) so spectators
                    // can slip past a full player lobby.
                    if (this.connections.size >= this.opts.maxPlayers) {
                        ws.send(
                            JSON.stringify({
                                type: 'REJECT',
                                reason: 'lobby_full',
                                tick: 0,
                            } satisfies ServerMessage),
                        );
                        ws.close();
                        return;
                    }
                    this.connections.set(pid, ws);
                    // Only now is the identity consumed — marking any earlier
                    // would let a gate-rejected join burn a restored seat for
                    // the claimless fallback or open it to reconnect claims.
                    this.everConnected.add(pid);
                    if (this.restoredSeatSet.has(pid)) {
                        this.claimedRestoredSeats.add(pid);
                    }
                }

                playerId = pid;
                authenticated = true;
                this.logger?.info(
                    role === 'spectator' ? 'spectator connected' : 'player connected',
                    { playerId: pid },
                );

                const lobbyState = this.buildWelcomeLobbyState(pid, displayName, role);
                const welcomeMsg: ServerMessage = {
                    type: 'WELCOME',
                    playerId: pid,
                    lobbyState,
                    // Omit role on a player WELCOME so it is byte-identical to
                    // today; the client schema defaults an absent role to
                    // 'player'. Spectators are told their role explicitly.
                    ...(role === 'spectator' ? { role } : {}),
                };
                ws.send(JSON.stringify(welcomeMsg));

                // Fire onPlayerConnected with the sanitised displayName + role
                for (const cb of this.connectedCbs) {
                    cb(pid, displayName, role);
                }
                return;
            }

            // Authenticated — route message to subscribers
            const pid = playerId!;

            // LEAVE is a connection-control message handled here, not routed to
            // subscribers: it marks the departure as intentional and forgets the
            // player so a later JOIN with the same reconnectPlayerId is treated as
            // a fresh join (no "reconnected" toast). The socket close that follows
            // then reports `'normal'`.
            if (msg.type === 'LEAVE') {
                intentionalLeave = true;
                this.knownPlayers.delete(pid);
                ws.close();
                return;
            }

            // A spectator is a read-only viewer (Invariant #114): drop its
            // EngineActions at this boundary — belt-and-braces on top of the
            // seatless `validate()` rejection. Out-of-band messages (chat,
            // spectate-target updates) still route.
            if (msg.type === 'ACTION' && this.spectatorConnections.has(pid)) {
                this.logger?.warn('dropped ACTION from spectator connection', {
                    playerId: pid,
                });
                return;
            }

            for (const cb of this.messageCbs) {
                cb(pid, msg);
            }
        };

        const onClose = (): void => {
            if (playerId !== null) {
                this.connections.delete(playerId);
                // A spectator lives in `spectatorConnections`; delete is a no-op
                // for the map that does not hold this pid.
                this.spectatorConnections.delete(playerId);
                const pid = playerId;
                this.logger?.info('player disconnected', { playerId: pid, intentionalLeave });
                // An explicit LEAVE → `'normal'` (deliberate). A bare socket close
                // with no preceding LEAVE → `'timeout'` (transient drop); the
                // player stays in `knownPlayers` so a reconnect resolves the same
                // PlayerId and the host can raise the "reconnected" toast.
                const reason: DisconnectReason = intentionalLeave ? 'normal' : 'timeout';
                for (const cb of this.disconnectedCbs) {
                    cb(pid, reason);
                }
            }
        };

        ws.on('message', onMessage);
        ws.on('close', onClose);
        ws.on('error', () => {
            // Let the 'close' event handle cleanup
        });
    }

    private buildWelcomeLobbyState(
        playerId: PlayerId,
        displayName: string,
        role: 'player' | 'spectator',
    ): LobbyState {
        const baseState: LobbyState =
            this.latestLobbyState ??
            ({
                info: {
                    sessionId: this._token,
                    // A restored session reclaims its saved host id.
                    hostId: this.opts.hostPlayerId ?? toPlayerId(`host-${this._token}`),
                    gameId: this.opts.gameId,
                },
                players: [],
            } satisfies LobbyState);

        // A spectator holds no seat and is never added to the authoritative
        // roster; the host tracks viewers in its own SpectatorRegistry, not in
        // this lobby state. It still receives the current roster so it can see
        // who is playing, but it does not mutate or persist the cached lobby
        // state (Invariant #114).
        if (role === 'spectator') {
            return baseState;
        }

        const playersById = new Map<PlayerId, LobbyPlayerEntry>();
        for (const entry of baseState.players) {
            playersById.set(entry.playerId, entry);
        }
        if (!playersById.has(playerId)) {
            playersById.set(playerId, { playerId, displayName, ready: false });
        }

        const lobbyState: LobbyState = {
            info: baseState.info,
            players: [...playersById.values()],
        };
        this.latestLobbyState = lobbyState;
        this.rememberPlayers(lobbyState.players);
        return lobbyState;
    }

    /**
     * Resolve the PlayerId a JOIN is admitted under. The priority chain
     * (reconnect → claims → claimless restored-seat fallback) lives in the
     * shared `resolveRestoredSeat` so it cannot drift between providers; this
     * method only adds the fresh `player-N` mint.
     *
     * Seat-handout bookkeeping (`everConnected` / `claimedRestoredSeats`) is
     * deferred to admission time, so a profile-gate or capacity rejection cannot
     * burn a *restored* seat. It is not otherwise pure: a claimless mint advances
     * `idCounter` here, so a claimless join later rejected (e.g. `lobby_full`)
     * still consumes a `player-N` number — harmless, it only bumps the next
     * mint's suffix.
     */
    private resolveJoinPlayerId(
        reconnectPlayerId: PlayerId | undefined,
        claims: readonly SeatClaim[] | undefined,
    ): PlayerId {
        return (
            resolveRestoredSeat(this.seatResolutionCtx, reconnectPlayerId, claims) ??
            this.mintFreshId()
        );
    }

    private mintFreshId(): PlayerId {
        // Restored seats carry prior-session 'player-N' ids while idCounter
        // restarts at 0 per server — skip occupied ids so a "fresh" mint can
        // never collide with a restored seat or a live connection.
        let pid: PlayerId;
        do {
            this.idCounter += 1;
            pid = toPlayerId(`player-${this.idCounter}`);
        } while (
            this.restoredSeatSet.has(pid) ||
            this.knownPlayers.has(pid) ||
            this.connections.has(pid)
        );
        return pid;
    }

    private rememberPlayers(players: readonly LobbyPlayerEntry[]): void {
        for (const player of players) {
            this.knownPlayers.set(player.playerId, player);
        }
    }
}

// ─── Module-private helpers ───────────────────────────────────────────────────

/**
 * Validate an unknown value against the full ClientMessage schema.
 * Returns true (and narrows the type) if the value matches any known variant.
 */
function isClientMessageValid(value: unknown): value is ClientMessage {
    return ClientMessageSchema.safeParse(value).success;
}

/**
 * Timing-safe string equality using crypto.timingSafeEqual.
 * Returns false (not throws) when lengths differ.
 */
function timingSafeTokenEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
