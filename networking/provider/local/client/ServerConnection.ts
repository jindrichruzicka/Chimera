/**
 * networking/provider/local/client/ServerConnection.ts
 *
 * Wraps a ws WebSocket with a structured connect/send/close API, typed
 * message subscriptions, and exponential-backoff reconnect logic.
 *
 * Responsibilities:
 *   - connect(url, token, profile): connect, send JOIN, await WELCOME → PlayerId
 *   - send(msg): send a ClientMessage over the open socket
 *   - close(): cleanly close the socket
 *   - onMessage(cb): subscribe to ServerMessages (excluding WELCOME)
 *   - onDisconnected(cb): subscribe to disconnect events
 *   - Reconnect: on unexpected close, retry with exponential backoff
 *     (up to opts.maxRetries, default 5, delays: 250, 500, 1000, 2000, 4000 ms)
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T04 (issue #219)
 */

import WebSocket from 'ws';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import type {
    DisconnectReason,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { LobbyState } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { Logger } from '@chimera/shared/logging.js';
import { ServerMessageSchema } from '@chimera/shared/messages-schemas.js';
import { crc32Json } from '@chimera/shared/crc32.js';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ConnectResult {
    readonly playerId: PlayerId;
    readonly lobbyState: LobbyState;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ServerConnectionOptions {
    /** Maximum number of automatic reconnect attempts. Default: 5. Set 0 to disable. */
    readonly maxRetries?: number;
    /** Base delay in milliseconds for exponential backoff. Default: 250. */
    readonly baseDelayMs?: number;
    /** Optional structured logger. Logs connect/disconnect and validation failures. */
    readonly logger?: Logger;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

const TERMINAL_REJECT_REASONS: ReadonlySet<string> = new Set<DisconnectReason>([
    'kicked',
    'timeout',
    'error',
    'normal',
]);

function isTerminalRejectReason(reason: string): reason is DisconnectReason {
    return TERMINAL_REJECT_REASONS.has(reason);
}

// ─── ServerConnection ─────────────────────────────────────────────────────────

/**
 * Low-level WebSocket client for LocalWebSocketProvider. Handles the JOIN
 * handshake and message delivery. WsClientTransport builds on top of this.
 */
export class ServerConnection {
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly logger: Logger | undefined;

    private ws: WebSocket | null = null;
    private url = '';
    private token = '';
    private profile: Record<string, unknown> | null = null;
    // profile is typed Record<string,unknown> internally; connect() widens to unknown so
    // callers never need a cast — the server-side Zod schema validates the shape on receipt.

    /** The PlayerId assigned by the server after a successful WELCOME. */
    private _assignedPlayerId: PlayerId | null = null;

    private readonly messageCbs = new Set<(msg: ServerMessage) => void>();
    private readonly disconnectedCbs = new Set<(reason: DisconnectReason) => void>();

    /** Whether the connection was closed intentionally (no reconnect). */
    private intentionalClose = false;
    private retryCount = 0;
    /** Pending reconnect timer — cleared in close() to prevent timer leaks (W-6). */
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts?: ServerConnectionOptions) {
        this.maxRetries = opts?.maxRetries ?? 5;
        this.baseDelayMs = opts?.baseDelayMs ?? 250;
        this.logger = opts?.logger;
    }

    /** The server-assigned PlayerId, available after a successful connect(). */
    get assignedPlayerId(): PlayerId | null {
        return this._assignedPlayerId;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Connect to the WebSocket server, send a JOIN message, and await a WELCOME
     * response.  Resolves with the server-assigned PlayerId.
     * Rejects if the server sends REJECT, the connection fails, or connect times
     * out after the first attempt.
     */
    connect(url: string, token: string, profile: unknown): Promise<ConnectResult> {
        this.url = url;
        this.token = token;
        // Cast: caller-supplied profile is unknown; server-side Zod schema (ClientMessageSchema)
        // validates the record structure on receipt — widening here is safe.
        this.profile = profile as Record<string, unknown>;
        this.intentionalClose = false;
        this.retryCount = 0;
        return this.attemptConnect();
    }

    /** Send a ClientMessage. No-op if not connected. */
    send(msg: ClientMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /** Subscribe to inbound ServerMessages. Returns an Unsubscribe handle. */
    onMessage(cb: (msg: ServerMessage) => void): Unsubscribe {
        this.messageCbs.add(cb);
        return (): void => {
            this.messageCbs.delete(cb);
        };
    }

    /** Subscribe to disconnect events. Returns an Unsubscribe handle. */
    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe {
        this.disconnectedCbs.add(cb);
        return (): void => {
            this.disconnectedCbs.delete(cb);
        };
    }

    /** Cleanly close the connection. Resolves when the socket is closed. */
    close(): Promise<void> {
        this.intentionalClose = true;
        // Cancel any pending reconnect timer (W-6)
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        return new Promise<void>((resolve) => {
            if (this.ws === null || this.ws.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }
            this.ws.once('close', () => resolve());
            this.ws.close();
        });
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /** Open one WebSocket connection and resolve with ConnectResult from WELCOME. */
    private attemptConnect(): Promise<ConnectResult> {
        return new Promise<ConnectResult>((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;

            ws.once('open', () => {
                ws.send(
                    JSON.stringify({
                        type: 'JOIN',
                        token: this.token,
                        profile: this.profile!, // profile is always set before attemptConnect
                    } satisfies ClientMessage),
                );
            });
            ws.once('error', (err) => {
                reject(err);
            });

            let welcomed = false;

            const onHandshakeMessage = (raw: Buffer | ArrayBuffer | Buffer[]): void => {
                let msg: ServerMessage;
                try {
                    const parsed: unknown = JSON.parse(rawToString(raw));
                    const result = ServerMessageSchema.safeParse(parsed);
                    if (!result.success) {
                        this.logger?.warn('malformed server message during handshake', {
                            issues: result.error.issues,
                        });
                        return;
                    }
                    // Cast: Zod PlayerId is string; Chimera PlayerId is branded string.
                    // Structural validation is complete — the cast is safe here.
                    msg = result.data as unknown as ServerMessage;
                } catch {
                    this.logger?.warn('non-JSON data received during handshake');
                    return;
                }

                if (msg.type === 'WELCOME') {
                    welcomed = true;
                    this._assignedPlayerId = msg.playerId;
                    // Update profile so reconnect sends the server-assigned ID (T03)
                    if (this.profile !== null) {
                        this.profile = { ...this.profile, playerId: msg.playerId };
                    }
                    // Remove the handshake listener and wire up the ongoing listener
                    ws.off('message', onHandshakeMessage);
                    ws.on('message', (r) => {
                        let m: ServerMessage;
                        try {
                            const p: unknown = JSON.parse(rawToString(r));
                            // Validate SNAPSHOT CRC against pre-Zod bytes.
                            // Zod may reorder object keys, so computing the CRC from the
                            // Zod-parsed snapshot would diverge from the host's CRC.
                            // Validate here — at the wire boundary — before safeParse runs.
                            if (!this.validateSnapshotCrc(p)) return;
                            const res = ServerMessageSchema.safeParse(p);
                            if (!res.success) {
                                this.logger?.warn('malformed server message', {
                                    issues: res.error.issues,
                                });
                                return;
                            }
                            // Cast: Zod PlayerId is string; Chimera PlayerId is branded string.
                            // Structural validation is complete — the cast is safe here.
                            m = res.data as unknown as ServerMessage;
                        } catch {
                            this.logger?.warn('non-JSON data received from server');
                            return;
                        }
                        if (m.type === 'REJECT' && isTerminalRejectReason(m.reason)) {
                            for (const cb of this.disconnectedCbs) cb(m.reason);
                            return;
                        }
                        if (m.type === 'CLOSE') {
                            for (const cb of this.disconnectedCbs) cb(m.reason);
                            return;
                        }
                        for (const cb of this.messageCbs) cb(m);
                    });
                    ws.on('close', () => this.handleClose());
                    resolve({ playerId: msg.playerId, lobbyState: msg.lobbyState });
                    return;
                }
                if (msg.type === 'REJECT') {
                    reject(new Error(`ServerConnection: server rejected JOIN: ${msg.reason}`));
                    ws.close();
                }
            };

            ws.on('message', onHandshakeMessage);

            ws.once('close', () => {
                if (!welcomed) {
                    reject(new Error('ServerConnection: connection closed before WELCOME'));
                }
            });
        });
    }

    private handleClose(): void {
        if (this.intentionalClose) {
            for (const cb of this.disconnectedCbs) cb('normal');
            return;
        }

        if (this.retryCount >= this.maxRetries) {
            for (const cb of this.disconnectedCbs) cb('error');
            return;
        }

        const delay = this.baseDelayMs * Math.pow(2, this.retryCount);
        this.retryCount += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.intentionalClose) return;
            void this.attemptReconnect();
        }, delay);
    }

    /** Re-run the full connect handshake for reconnect. Silent on failure. */
    private async attemptReconnect(): Promise<void> {
        try {
            await this.attemptConnect();
        } catch {
            // handleClose will fire again from the close event and schedule
            // the next retry (or give up) based on retryCount
        }
    }

    /**
     * Validates the CRC32 checksum of an inbound SNAPSHOT message against the
     * raw pre-Zod bytes.
     *
     * Must be called before `ServerMessageSchema.safeParse()` to avoid comparing
     * against Zod's potentially key-reordered snapshot object.
     *
     * Returns `true` if the message is not a SNAPSHOT, or if it is a SNAPSHOT and
     * its checksum is valid. Returns `false` (and logs a warning) if the checksum
     * does not match.
     */
    private validateSnapshotCrc(p: unknown): boolean {
        if (typeof p !== 'object' || p === null) return true;
        const raw = p as Record<string, unknown>;
        if (raw['type'] !== 'SNAPSHOT') return true;

        const expected = crc32Json(raw['snapshot']);
        if (expected !== raw['checksum']) {
            this.logger?.warn('SNAPSHOT checksum mismatch — discarding frame', {
                expected,
                received: raw['checksum'],
            });
            return false;
        }
        return true;
    }
}
