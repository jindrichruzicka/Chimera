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
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import type { Logger } from '@chimera/shared/logging.js';
import { ClientMessageSchema } from '@chimera/shared/messages-schemas.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

export type MessageCallback = (from: PlayerId, msg: ClientMessage) => void;
export type PlayerCallback = (playerId: PlayerId) => void;
export type DisconnectCallback = (playerId: PlayerId, reason: DisconnectReason) => void;

export type DisconnectReason = 'kicked' | 'timeout' | 'host_closed' | 'error' | 'normal';

export interface LobbyServerOptions {
    /** Port to listen on. Pass 0 for OS-assigned random port. */
    readonly port: number;
    readonly gameId: string;
    readonly maxPlayers: number;
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
export class LobbyServer {
    private readonly wss: WebSocketServer;
    private readonly connections = new Map<PlayerId, WebSocket>();
    private readonly _token: string;
    private _port = 0;

    private readonly messageCbs = new Set<MessageCallback>();
    private readonly connectedCbs = new Set<PlayerCallback>();
    private readonly disconnectedCbs = new Set<DisconnectCallback>();

    private readonly opts: LobbyServerOptions;
    private readonly logger: Logger | undefined;
    private idCounter = 0;
    private closed = false;
    private readonly readyPromise: Promise<void>;

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
            type: 'REJECT',
            reason: 'host_closed',
            tick: 0,
        };
        const serialised = JSON.stringify(closeMsg);
        const entries = [...this.connections.entries()];
        for (const [playerId, ws] of entries) {
            if (ws.readyState === WebSocket.OPEN) {
                // Flush the REJECT frame first, then close in the callback (W-2)
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

                // Assign PlayerId and authenticate
                this.idCounter += 1;
                playerId = `player-${this.idCounter}` as PlayerId;
                this.connections.set(playerId, ws);
                authenticated = true;
                this.logger?.info('player connected', { playerId });

                // Send WELCOME
                const welcomeMsg: ServerMessage = {
                    type: 'WELCOME',
                    playerId,
                    lobbyState: {
                        info: {
                            sessionId: this._token,
                            hostId: `host-${this._token}` as PlayerId,
                            gameId: this.opts.gameId,
                        },
                        players: [],
                    },
                };
                ws.send(JSON.stringify(welcomeMsg));

                // Fire onPlayerConnected
                const pid = playerId;
                for (const cb of this.connectedCbs) {
                    cb(pid);
                }
                return;
            }

            // Authenticated — route message to subscribers
            const pid = playerId!;
            for (const cb of this.messageCbs) {
                cb(pid, msg);
            }
        };

        const onClose = (): void => {
            if (playerId !== null) {
                this.connections.delete(playerId);
                const pid = playerId;
                this.logger?.info('player disconnected', { playerId: pid });
                for (const cb of this.disconnectedCbs) {
                    cb(pid, 'normal');
                }
            }
        };

        ws.on('message', onMessage);
        ws.on('close', onClose);
        ws.on('error', () => {
            // Let the 'close' event handle cleanup
        });
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
