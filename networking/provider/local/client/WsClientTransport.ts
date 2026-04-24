/**
 * networking/provider/local/client/WsClientTransport.ts
 *
 * Implements ClientTransport over a ServerConnection. Translates between
 * high-level transport method calls and wire-level ClientMessage / ServerMessage
 * types.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T05 (issue #220)
 */

import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ServerMessage } from '@chimera/shared/messages.js';
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
    private readonly snapshotCbs = new Set<(snapshot: PlayerSnapshot) => void>();
    private readonly sideChannelCbs = new Set<(msg: SideChannelMessage) => void>();
    private readonly lobbyStateCbs = new Set<(state: LobbyState) => void>();

    constructor(
        private readonly connection: ServerConnection,
        private readonly playerId: PlayerId,
    ) {
        connection.onMessage((msg) => this.route(msg));
    }

    // ─── Outbound ─────────────────────────────────────────────────────────────

    sendAction(action: EngineAction): void {
        this.connection.send({
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: 0,
        });
    }

    sendSideChannel(msg: SideChannelMessage): void {
        if (msg.kind === 'chat') {
            this.connection.send({
                type: 'CHAT',
                body: msg.payload.text,
                scope: 'all',
            });
        }
        // profile updates are handled via PROFILE_UPDATE
        if (msg.kind === 'profile') {
            this.connection.send({
                type: 'PROFILE_UPDATE',
                profile: {
                    playerId: this.playerId,
                    displayName: msg.payload.displayName,
                },
            });
        }
    }

    // ─── Subscriptions ────────────────────────────────────────────────────────

    onSnapshotReceived(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe {
        this.snapshotCbs.add(cb);
        return (): void => {
            this.snapshotCbs.delete(cb);
        };
    }

    onSideChannelReceived(cb: (msg: SideChannelMessage) => void): Unsubscribe {
        this.sideChannelCbs.add(cb);
        return (): void => {
            this.sideChannelCbs.delete(cb);
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

    // ─── Internal routing ─────────────────────────────────────────────────────

    private route(msg: ServerMessage): void {
        switch (msg.type) {
            case 'SNAPSHOT':
                for (const cb of this.snapshotCbs) cb(msg.snapshot);
                break;

            case 'LOBBY_STATE':
                for (const cb of this.lobbyStateCbs) cb(msg.state);
                break;

            case 'CHAT':
                for (const cb of this.sideChannelCbs) {
                    cb({
                        kind: 'chat',
                        payload: { senderId: msg.from, text: msg.body, timestamp: msg.serverTime },
                    });
                }
                break;

            default:
                // WELCOME handled by ServerConnection; PONG, DELTA, REJECT, REVEAL ignored
                break;
        }
    }
}
