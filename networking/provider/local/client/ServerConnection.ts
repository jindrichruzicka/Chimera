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
 */

import WebSocket from 'ws';
import type { PlayerId } from '@chimera-engine/simulation/contracts';
import type {
    ClientMessage,
    ServerMessage,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { DisconnectReason, SeatClaim, Unsubscribe } from '../../MultiplayerProvider.js';
import type { LobbyState } from '../../MultiplayerProvider.js';
import { JoinRejectedError } from '../../MultiplayerProvider.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { ServerMessageSchema } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ConnectResult {
    readonly playerId: PlayerId;
    readonly lobbyState: LobbyState;
}

// `JoinRejectedError` is defined on the provider abstraction so consumers can
// catch it without importing this provider-internal module; re-exported here for
// call sites that already depend on ServerConnection.
export { JoinRejectedError };

// ─── WebSocket seam ─────────────────────────────────────────────────────────

/** Raw inbound frame payload, matching `ws`'s message event data. */
type RawData = Buffer | ArrayBuffer | Buffer[];

/**
 * Minimal structural subset of the `ws` `WebSocket` that ServerConnection uses.
 * A real `ws` WebSocket satisfies this supertype, so the default `socketFactory`
 * (`(u) => new WebSocket(u)`) is assignable with no cast. Defining the seam against
 * this structural type — rather than the concrete `ws` class — lets a future
 * STUN/TURN/relay or WebRTC transport be injected without editing the connect path.
 */
export interface WebSocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on(event: 'message', listener: (data: RawData) => void): void;
    on(event: 'close', listener: () => void): void;
    once(event: 'open', listener: () => void): void;
    once(event: 'error', listener: (err: Error) => void): void;
    once(event: 'close', listener: () => void): void;
    off(event: 'message', listener: (data: RawData) => void): void;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ServerConnectionOptions {
    /** Maximum number of automatic reconnect attempts. Default: 5. Set 0 to disable. */
    readonly maxRetries?: number;
    /** Base delay in milliseconds for exponential backoff. Default: 250. */
    readonly baseDelayMs?: number;
    /** Optional structured logger. Logs connect/disconnect and validation failures. */
    readonly logger?: Logger;
    /**
     * Optional endpoint resolver applied to the connect URL before the socket is
     * opened. Defaults to identity. A future STUN/TURN/relay transport can rewrite
     * the URL here (e.g. resolve a lobby code to a relay address) without changing
     * the core connect path. May be async.
     *
     * Failure contract: a rejection (or thrown error) rejects the in-flight
     * `attemptConnect()` before any socket exists. On the initial `connect()` this
     * surfaces to the caller; during an automatic reconnect it is swallowed by the
     * backoff loop and does NOT itself schedule a further retry. A resolver that
     * wants its transient failures to feed the reconnect path must resolve to a
     * fallback URL rather than reject.
     */
    readonly resolveEndpoint?: (url: string) => string | Promise<string>;
    /**
     * Optional factory that creates the underlying socket from the resolved URL.
     * Defaults to `(u) => new WebSocket(u)` — today's exact behaviour. A future
     * WebRTC/relay transport can return any object satisfying {@link WebSocketLike}.
     */
    readonly socketFactory?: (url: string) => WebSocketLike;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rawToString(raw: RawData): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

/**
 * Cap on messages held for the first onMessage subscriber. The realistic gap
 * is one microtask chain (connect() resolution → WsClientTransport
 * construction), so a handful of frames; the cap only guards against a
 * pathological pre-subscription flood.
 */
const MAX_PENDING_MESSAGES = 64;

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
    private readonly resolveEndpoint: (url: string) => string | Promise<string>;
    private readonly socketFactory: (url: string) => WebSocketLike;

    private ws: WebSocketLike | null = null;
    private url = '';
    private token = '';
    private profile: Record<string, unknown> | null = null;
    /**
     * Optional lobby password presented in every JOIN, including auto-reconnect
     * attempts. Stored alongside the token so a transient drop re-authenticates
     * against a password-protected host without re-prompting.
     */
    private password: string | undefined = undefined;
    /**
     * Optional saved-seat claims presented in every JOIN, including
     * auto-reconnect attempts. Resending them on reconnect is harmless: once a
     * WELCOME assigned an id, `reconnectPlayerId` outranks claims server-side.
     */
    private claims: readonly SeatClaim[] | undefined = undefined;
    // profile is typed Record<string,unknown> internally; connect() widens to unknown so
    // callers never need a cast — the server-side Zod schema validates the shape on receipt.

    /** The PlayerId assigned by the server after a successful WELCOME. */
    private _assignedPlayerId: PlayerId | null = null;

    private readonly messageCbs = new Set<(msg: ServerMessage) => void>();
    private readonly disconnectedCbs = new Set<(reason: DisconnectReason) => void>();
    /**
     * Messages that arrived after WELCOME but before the first onMessage
     * subscriber, delivered (in order) when that subscriber attaches. `ws`
     * dispatches already-buffered frames back-to-back in one macrotask, so a
     * host that answers a mid-match rejoin with WELCOME + snapshot resync in
     * one burst would otherwise have the resync silently dropped — the
     * consumer (WsClientTransport) is only constructed after connect()
     * resolves, a microtask later. Bounded so a pathological pre-subscription
     * flood cannot grow without limit.
     */
    private pendingMessages: ServerMessage[] = [];

    /** Whether the connection was closed intentionally (no reconnect). */
    private intentionalClose = false;
    private retryCount = 0;
    /** Pending reconnect timer — cleared in close() to prevent timer leaks. */
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts?: ServerConnectionOptions) {
        this.maxRetries = opts?.maxRetries ?? 5;
        this.baseDelayMs = opts?.baseDelayMs ?? 250;
        this.logger = opts?.logger;
        // Dormant by default: identity resolver + direct `new WebSocket` factory
        // preserve today's exact connect behaviour.
        this.resolveEndpoint = opts?.resolveEndpoint ?? ((url) => url);
        this.socketFactory = opts?.socketFactory ?? ((u) => new WebSocket(u));
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
    connect(
        url: string,
        token: string,
        profile: unknown,
        reconnectPlayerId?: PlayerId,
        password?: string,
        claims?: readonly SeatClaim[],
    ): Promise<ConnectResult> {
        this.url = url;
        this.token = token;
        this.password = password;
        this.claims = claims;
        this._assignedPlayerId = reconnectPlayerId ?? this._assignedPlayerId;
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
        // First subscriber: flush anything that arrived in the same socket
        // batch as WELCOME (reconnect resync), preserving arrival order.
        if (this.pendingMessages.length > 0) {
            const pending = this.pendingMessages;
            this.pendingMessages = [];
            for (const msg of pending) {
                for (const subscriber of this.messageCbs) subscriber(msg);
            }
        }
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
        // Announce a deliberate departure before tearing down the socket so the
        // host distinguishes this from a transient drop and suppresses the
        // opponent "disconnected" presence toast. Best-effort: send() is a
        // no-op unless the socket is OPEN, and `ws` flushes buffered frames before
        // the close handshake, so the LEAVE reaches the host ahead of the close.
        this.send({ type: 'LEAVE' });
        // Cancel any pending reconnect timer.
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
    private async attemptConnect(): Promise<ConnectResult> {
        // A new socket means a new handshake; anything buffered from a previous
        // socket is stale (the host re-syncs after every WELCOME).
        this.pendingMessages = [];
        const resolvedUrl = await this.resolveEndpoint(this.url);
        return new Promise<ConnectResult>((resolve, reject) => {
            const ws = this.socketFactory(resolvedUrl);
            this.ws = ws;

            ws.once('open', () => {
                ws.send(
                    JSON.stringify({
                        type: 'JOIN',
                        token: this.token,
                        ...(this._assignedPlayerId === null
                            ? {}
                            : { reconnectPlayerId: this._assignedPlayerId }),
                        profile: this.profile!, // profile is always set before attemptConnect
                        ...(this.password === undefined ? {} : { password: this.password }),
                        // Omitted (not []) when absent: older hosts validate JOIN
                        // with a .strict() schema and would drop the whole frame.
                        ...(this.claims === undefined ? {} : { claims: this.claims }),
                    } satisfies ClientMessage),
                );
            });
            ws.once('error', (err) => {
                reject(err);
            });

            let welcomed = false;

            const onHandshakeMessage = (raw: RawData): void => {
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
                        if (this.messageCbs.size === 0) {
                            if (this.pendingMessages.length < MAX_PENDING_MESSAGES) {
                                this.pendingMessages.push(m);
                            } else {
                                this.logger?.warn(
                                    'pre-subscription message buffer full — dropping frame',
                                    { type: m.type },
                                );
                            }
                            return;
                        }
                        for (const cb of this.messageCbs) cb(m);
                    });
                    ws.on('close', () => this.handleClose());
                    resolve({ playerId: msg.playerId, lobbyState: msg.lobbyState });
                    return;
                }
                if (msg.type === 'REJECT') {
                    reject(new JoinRejectedError(msg.reason));
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
