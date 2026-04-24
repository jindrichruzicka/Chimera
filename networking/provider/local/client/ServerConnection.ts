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
import type { WirePlayerProfile } from '@chimera/shared/messages.js';
import type { LobbyState } from '@chimera/networking/provider/MultiplayerProvider.js';

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

// ─── ServerConnection ─────────────────────────────────────────────────────────

/**
 * Low-level WebSocket client for LocalWebSocketProvider. Handles the JOIN
 * handshake and message delivery. WsClientTransport builds on top of this.
 */
export class ServerConnection {
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;

    private ws: WebSocket | null = null;
    private url = '';
    private token = '';
    private profile: WirePlayerProfile | null = null;

    private readonly messageCbs = new Set<(msg: ServerMessage) => void>();
    private readonly disconnectedCbs = new Set<(reason: DisconnectReason) => void>();

    /** Whether the connection was closed intentionally (no reconnect). */
    private intentionalClose = false;
    private retryCount = 0;

    constructor(opts?: ServerConnectionOptions) {
        this.maxRetries = opts?.maxRetries ?? 5;
        this.baseDelayMs = opts?.baseDelayMs ?? 250;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Connect to the WebSocket server, send a JOIN message, and await a WELCOME
     * response.  Resolves with the server-assigned PlayerId.
     * Rejects if the server sends REJECT, the connection fails, or connect times
     * out after the first attempt.
     */
    connect(url: string, token: string, profile: WirePlayerProfile): Promise<ConnectResult> {
        this.url = url;
        this.token = token;
        this.profile = profile;
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
                const msg = JSON.parse(rawToString(raw)) as ServerMessage;

                if (msg.type === 'WELCOME') {
                    welcomed = true;
                    // Remove the handshake listener and wire up the ongoing listener
                    ws.off('message', onHandshakeMessage);
                    ws.on('message', (r) => {
                        const m = JSON.parse(rawToString(r)) as ServerMessage;
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

        setTimeout(() => {
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
}
