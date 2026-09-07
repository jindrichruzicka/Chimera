/**
 * networking/provider/local/client/WsClientTransport.ts
 *
 * Implements ClientTransport over a ServerConnection. Translates between
 * high-level transport method calls and wire-level ClientMessage / ServerMessage
 * types.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 */

import type { PlayerId, EngineAction } from '@chimera-engine/simulation/contracts';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
    DisconnectReason,
    SnapshotDelta,
    Unsubscribe,
} from '../../MultiplayerProvider.js';
import { applySnapshotDelta } from '@chimera-engine/simulation/foundation/snapshot-delta.js';
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
    /**
     * The newest whole projection this client holds, and the baseline every
     * `SNAPSHOT_DELTA` is applied to.
     *
     * Separate from {@link latchedSnapshot}, which exists only to replay one
     * frame to a late subscriber and is cleared once it has: the delta chain has
     * to be tracked whether or not anyone is listening, or a subscriber arriving
     * mid-match would find the next delta unappliable.
     */
    private deltaBaseline: PlayerSnapshot | null = null;
    /**
     * Whether a full re-sync has been asked for and not yet answered.
     *
     * A broken chain would otherwise ask on EVERY beat, and `engine:sync_request`
     * makes the host broadcast a full snapshot to every viewer rather than only
     * to the asker — so an unlatched request turns one client's desync into a
     * cost the whole session pays. Cleared by the SNAPSHOT that answers it.
     */
    private resyncPending = false;

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

    sendSpectateTarget(targetPlayerId: PlayerId): void {
        this.connection.send({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId,
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
        this.deltaBaseline = null;
        this.resyncPending = false;
    }

    /**
     * Rebuild the whole projection a delta describes and publish THAT.
     *
     * `ClientTransport.onSnapshotReceived` promises subscribers a whole
     * projection, so nothing above this transport ever learns a delta was on the
     * wire. A delta that will not apply is DROPPED rather than partially
     * applied, and the host is asked for a keyframe: half a snapshot is a
     * divergence no later frame corrects.
     *
     * The frame's own checksum is passed through rather than measured on the
     * rebuild. Measuring would not give the host's number for two objects that
     * are deeply equal: `ServerMessageSchema` rebuilds a parsed snapshot in the
     * SCHEMA's key order, so every baseline here — and therefore every rebuild
     * from it — is keyed in that order rather than the host projector's, and
     * `crc32Json` is order-sensitive. It would also cost a full serialisation
     * per beat for a number only the E2E hook reads.
     */
    private applyDelta(delta: SnapshotDelta, checksum: number): void {
        const baseline = this.deltaBaseline;
        const applied = baseline === null ? null : applySnapshotDelta(baseline, delta);
        if (applied === null) {
            this.requestFullResync();
            return;
        }
        this.deltaBaseline = applied;
        this.publishSnapshot(applied, checksum);
    }

    /**
     * Ask the host to broadcast a full snapshot, once per broken chain.
     *
     * `engine:sync_request` is the existing forced-full-broadcast hook; the tick
     * is the last one this client is sure of, and 0 before any snapshot has
     * arrived at all.
     */
    private requestFullResync(): void {
        if (this.resyncPending) return;
        this.resyncPending = true;
        this.sendAction({
            type: 'engine:sync_request',
            playerId: this.playerId,
            tick: this.deltaBaseline?.tick ?? 0,
            payload: {},
        });
    }

    /** Deliver to subscribers, or latch for the first one to arrive. */
    private publishSnapshot(snapshot: PlayerSnapshot, checksum: number): void {
        if (this.snapshotCbs.size === 0) {
            this.latchedSnapshot = { snapshot, checksum };
            return;
        }
        for (const cb of this.snapshotCbs) cb(snapshot, checksum);
    }

    // ─── Internal routing ─────────────────────────────────────────────────────

    private route(msg: ServerMessage): void {
        switch (msg.type) {
            case 'SNAPSHOT': {
                // A keyframe: it re-establishes the delta chain whatever state
                // it was in, and answers any outstanding re-sync request.
                this.deltaBaseline = msg.snapshot;
                this.resyncPending = false;
                this.publishSnapshot(msg.snapshot, msg.checksum);
                break;
            }

            case 'SNAPSHOT_DELTA': {
                this.applyDelta(msg.delta, msg.checksum);
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
                // Mid-session PROFILE_UPDATE rejection. Surfaced as the
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
