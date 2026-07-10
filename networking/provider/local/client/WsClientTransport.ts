/**
 * networking/provider/local/client/WsClientTransport.ts
 *
 * Implements ClientTransport over a ServerConnection. Translates between
 * high-level transport method calls and wire-level ClientMessage / ServerMessage
 * types.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T05 (issue #220); F13 / T04 (issue #309)
 */

import type { PlayerId, EngineAction } from '@chimera-engine/simulation/contracts';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
} from '../../MultiplayerProvider.js';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import type {
    ServerMessage,
    WireCommitmentReveal,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { ServerConnection } from './ServerConnection.js';

// ─── WsClientTransport ────────────────────────────────────────────────────────

/**
 * Client-side transport implementation. Delegates all outbound calls to
 * ServerConnection.send() and routes inbound ServerMessages to typed callback
 * sets.
 *
 * Constructed by LocalWebSocketProvider.joinLobby() immediately after
 * ServerConnection.connect() resolves with a PlayerId.
 */
export class WsClientTransport implements ClientTransport {
    private readonly snapshotCbs = new Set<(snapshot: PlayerSnapshot, checksum: number) => void>();
    private readonly tickCbs = new Set<(tick: number) => void>();
    private readonly sideChannelCbs = new Set<(msg: SideChannelMessage) => void>();
    private readonly revealCbs = new Set<(reveal: WireCommitmentReveal) => void>();
    private readonly lobbyStateCbs = new Set<(state: LobbyState) => void>();
    private readonly latencyUpdateCbs = new Set<(latencyMs: number) => void>();
    private disconnectUnsub: Unsubscribe | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    /**
     * Newest snapshot routed while no snapshot subscriber existed, replayed to
     * the first subscriber and then discarded. Covers the reconnect resync: the
     * host answers a mid-match rejoin with a snapshot that can arrive before
     * LobbyManager wires onSnapshotReceived, and nothing re-sends it
     * (action-driven games have no ticker). Latest-wins is safe — snapshots
     * are authoritative whole-state, not deltas.
     */
    private latchedSnapshot: { snapshot: PlayerSnapshot; checksum: number } | null = null;

    constructor(
        private readonly connection: ServerConnection,
        private readonly playerId: PlayerId,
    ) {
        connection.onMessage((msg) => this.route(msg));
        this.disconnectUnsub = connection.onDisconnected(() => this.dispose());

        // WELCOME has already been received (ServerConnection.connect() resolved).
        // Send the first PING immediately, then repeat every 5 s.
        this.connection.send({ type: 'PING', sentAt: performance.now() });
        this.pingInterval = setInterval(() => {
            this.connection.send({ type: 'PING', sentAt: performance.now() });
        }, 5_000);
    }

    // ─── Outbound ─────────────────────────────────────────────────────────────

    sendAction(action: EngineAction): void {
        this.connection.send({
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action),
        });
    }

    sendReadyStateUpdate(ready: boolean): void {
        this.connection.send({
            type: 'READY_STATE_UPDATE',
            ready,
        });
    }

    sendPlayerAttributeUpdate(key: string, value: string): void {
        this.connection.send({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key,
            value,
        });
    }

    sendSideChannel(msg: SideChannelMessage): void {
        if (msg.kind === 'chat') {
            this.connection.send({
                type: 'CHAT',
                body: msg.payload.text,
                scope: msg.payload.scope,
            });
        }
        // profile updates are handled via PROFILE_UPDATE
        if (msg.kind === 'profile') {
            this.connection.send({
                type: 'PROFILE_UPDATE',
                profile: msg.payload,
            });
        }
    }

    // ─── Subscriptions ────────────────────────────────────────────────────────

    onSnapshotReceived(cb: (snapshot: PlayerSnapshot, checksum: number) => void): Unsubscribe {
        this.snapshotCbs.add(cb);
        if (this.latchedSnapshot !== null) {
            const { snapshot, checksum } = this.latchedSnapshot;
            this.latchedSnapshot = null;
            cb(snapshot, checksum);
        }
        return (): void => {
            this.snapshotCbs.delete(cb);
        };
    }

    onTickReceived(cb: (tick: number) => void): Unsubscribe {
        this.tickCbs.add(cb);
        return (): void => {
            this.tickCbs.delete(cb);
        };
    }

    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe {
        this.sideChannelCbs.add(cb);
        return (): void => {
            this.sideChannelCbs.delete(cb);
        };
    }

    onReveal(cb: (reveal: WireCommitmentReveal) => void): Unsubscribe {
        this.revealCbs.add(cb);
        return (): void => {
            this.revealCbs.delete(cb);
        };
    }

    onLobbyStateChanged(cb: (state: LobbyState) => void): Unsubscribe {
        this.lobbyStateCbs.add(cb);
        return (): void => {
            this.lobbyStateCbs.delete(cb);
        };
    }

    onDisconnected(cb: (reason: DisconnectReason) => void): Unsubscribe {
        return this.connection.onDisconnected(cb);
    }

    onLatencyUpdate(cb: (latencyMs: number) => void): Unsubscribe {
        this.latencyUpdateCbs.add(cb);
        return (): void => {
            this.latencyUpdateCbs.delete(cb);
        };
    }

    /** Clears the PING interval and all subscriber Sets. Called automatically on disconnect. */
    dispose(): void {
        if (this.disconnectUnsub !== null) {
            this.disconnectUnsub();
            this.disconnectUnsub = null;
        }

        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        this.snapshotCbs.clear();
        this.tickCbs.clear();
        this.sideChannelCbs.clear();
        this.revealCbs.clear();
        this.lobbyStateCbs.clear();
        this.latencyUpdateCbs.clear();
        this.latchedSnapshot = null;
    }

    // ─── Internal routing ─────────────────────────────────────────────────────

    private route(msg: ServerMessage): void {
        switch (msg.type) {
            case 'SNAPSHOT': {
                if (this.snapshotCbs.size === 0) {
                    this.latchedSnapshot = { snapshot: msg.snapshot, checksum: msg.checksum };
                    break;
                }
                for (const cb of this.snapshotCbs) cb(msg.snapshot, msg.checksum);
                break;
            }

            case 'TICK': {
                for (const cb of this.tickCbs) cb(msg.tick);
                break;
            }

            case 'LOBBY_STATE':
                for (const cb of this.lobbyStateCbs) cb(msg.state);
                break;

            case 'PONG': {
                const latencyMs = Math.max(0, performance.now() - msg.sentAt);
                for (const cb of this.latencyUpdateCbs) cb(latencyMs);
                break;
            }

            case 'CHAT':
                for (const cb of this.sideChannelCbs) {
                    cb({
                        kind: 'chat',
                        payload: {
                            id: msg.id,
                            senderId: msg.from,
                            text: msg.body,
                            scope: msg.scope,
                            timestamp: msg.serverTime,
                        },
                    });
                }
                break;

            case 'REVEAL':
                for (const cb of this.revealCbs) cb(msg.reveal);
                break;

            case 'PROFILE_REJECT':
                // Mid-session PROFILE_UPDATE rejection (#688). Surfaced as the
                // `profile_reject` side-channel so LobbyManager can raise the
                // §4.30 "Profile rejected" toast on the joined client.
                for (const cb of this.sideChannelCbs) {
                    cb({ kind: 'profile_reject', reason: msg.reason });
                }
                break;

            default:
                // WELCOME handled by ServerConnection; DELTA and non-terminal REJECT ignored
                break;
        }
    }
}
