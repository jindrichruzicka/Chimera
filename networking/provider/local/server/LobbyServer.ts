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
 * Task: F10 / T02 (issue #217)
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
import type { JoinGateResult, LobbyPlayerEntry, LobbyState } from '../../MultiplayerProvider.js';
import type {
    ClientMessage,
    ServerMessage,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { ClientMessageSchema } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { MessageBus } from './MessageBus.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

export type MessageCallback = (from: PlayerId, msg: ClientMessage) => void;
export type PlayerCallback = (playerId: PlayerId, displayName: string) => void;
export type DisconnectCallback = (playerId: PlayerId, reason: DisconnectReason) => void;

export type DisconnectReason = 'kicked' | 'timeout' | 'host_closed' | 'error' | 'normal';

export interface LobbyServerOptions {
    /** Port to listen on. Pass 0 for OS-assigned random port. */
    readonly port: number;
    readonly gameId: string;
    readonly maxPlayers: number;
    /**
     * Optional host-set lobby password (F56). When non-empty, every JOIN must
     * present a matching `password` (compared timing-safe) or is rejected with
     * `REJECT 'invalid_password'`. When undefined/empty the lobby is open. The
     * secret stays here — it is never written to `LobbyState` or logged.
     */
    readonly password?: string;
    /** Optional structured logger. Logs join/leave events and validation failures. */
    readonly logger?: Logger;
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
    private readonly _token: string;
    private _port = 0;

    private readonly messageCbs = new Set<MessageCallback>();
    private readonly connectedCbs = new Set<PlayerCallback>();
    private readonly disconnectedCbs = new Set<DisconnectCallback>();
    private latestLobbyState: LobbyState | null = null;
    private readonly knownPlayers = new Map<PlayerId, LobbyPlayerEntry>();

    private readonly opts: LobbyServerOptions;
    private readonly logger: Logger | undefined;
    private idCounter = 0;
    private closed = false;
    private readonly readyPromise: Promise<void>;
    /**
     * Optional profile gate set by the host via `setJoinGate()`.
     * Called synchronously during JOIN handling before WELCOME is sent.
     */
    private joinGate: ((pid: PlayerId, rawProfile: unknown) => JoinGateResult) | null = null;

    constructor(opts: LobbyServerOptions) {
        this.opts = opts;
        this.logger = opts.logger;
        this._token = randomBytes(16).toString('hex');

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
     * Send a serialised ServerMessage to one specific authenticated client.
     * No-op if the PlayerId is not connected.
     */
    sendToPlayer(playerId: PlayerId, msg: ServerMessage): void {
        const ws = this.connections.get(playerId);
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
     * Gracefully close the server.
     * - Sends 'host_closed' to all connected clients
     * - Closes all ws connections
     * - Stops the listening server
     * Safe to call multiple times.
     */
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        // Notify all clients — snapshot the map before iterating (W-3)
        const closeMsg: ServerMessage = {
            type: 'CLOSE',
            reason: 'host_closed',
        };
        const serialised = JSON.stringify(closeMsg);
        const entries = [...this.connections.entries()];
        for (const [playerId, ws] of entries) {
            if (ws.readyState === WebSocket.OPEN) {
                // Flush the CLOSE frame first, then close in the callback (W-2)
                ws.send(serialised, () => ws.close());
            }
            for (const cb of this.disconnectedCbs) {
                cb(playerId, 'host_closed');
            }
        }
        this.connections.clear();

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
        // (#687) never fire "disconnected" on a deliberate leave.
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
                // Only JOIN is valid before authentication
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

                // Validate token — timing-safe comparison (T07)
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
                // one (F56). An empty/undefined host password leaves the lobby
                // open (unchanged behaviour). A missing or mismatched client
                // password is rejected before WELCOME; the secret is never
                // echoed back to the client.
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

                // Check capacity
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

                const pid = this.resolveJoinPlayerId(msg.reconnectPlayerId);

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

                this.connections.set(pid, ws);
                playerId = pid;
                authenticated = true;
                this.logger?.info('player connected', { playerId: pid });

                // Send WELCOME
                const lobbyState = this.buildWelcomeLobbyState(pid, displayName);
                const welcomeMsg: ServerMessage = {
                    type: 'WELCOME',
                    playerId: pid,
                    lobbyState,
                };
                ws.send(JSON.stringify(welcomeMsg));

                // Fire onPlayerConnected with the sanitised displayName
                for (const cb of this.connectedCbs) {
                    cb(pid, displayName);
                }
                return;
            }

            // Authenticated — route message to subscribers
            const pid = playerId!;

            // LEAVE is a connection-control message handled here, not routed to
            // subscribers: it marks the departure as intentional and forgets the
            // player so a later JOIN with the same reconnectPlayerId is treated as
            // a fresh join (no "reconnected" toast). The socket close that follows
            // then reports `'normal'` (#687).
            if (msg.type === 'LEAVE') {
                intentionalLeave = true;
                this.knownPlayers.delete(pid);
                ws.close();
                return;
            }

            for (const cb of this.messageCbs) {
                cb(pid, msg);
            }
        };

        const onClose = (): void => {
            if (playerId !== null) {
                this.connections.delete(playerId);
                const pid = playerId;
                this.logger?.info('player disconnected', { playerId: pid, intentionalLeave });
                // An explicit LEAVE → `'normal'` (deliberate). A bare socket close
                // with no preceding LEAVE → `'timeout'` (transient drop); the
                // player stays in `knownPlayers` so a reconnect resolves the same
                // PlayerId and the host can raise the "reconnected" toast (#687).
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

    private buildWelcomeLobbyState(playerId: PlayerId, displayName: string): LobbyState {
        const baseState: LobbyState =
            this.latestLobbyState ??
            ({
                info: {
                    sessionId: this._token,
                    hostId: toPlayerId(`host-${this._token}`),
                    gameId: this.opts.gameId,
                },
                players: [],
            } satisfies LobbyState);

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

    private resolveJoinPlayerId(reconnectPlayerId: PlayerId | undefined): PlayerId {
        if (
            reconnectPlayerId !== undefined &&
            !this.connections.has(reconnectPlayerId) &&
            this.knownPlayers.has(reconnectPlayerId)
        ) {
            return reconnectPlayerId;
        }

        this.idCounter += 1;
        return toPlayerId(`player-${this.idCounter}`);
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
