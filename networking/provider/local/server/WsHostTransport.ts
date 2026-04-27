/**
 * networking/provider/local/server/WsHostTransport.ts
 *
 * Implements HostTransport using LobbyServer (outbound) and MessageRouter
 * (inbound). This is the single bridge between the multiplayer engine API and
 * the raw WebSocket server.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T03 (issue #218)
 */

import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type {
    HostTransport,
    PlayerSnapshot,
    LobbyState,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { crc32Json } from '@chimera/shared/crc32.js';
import type { ServerMessage } from '@chimera/shared/messages.js';
import type { LobbyServer } from './LobbyServer.js';
import type { MessageRouter } from './MessageRouter.js';

// ─── WsHostTransport ──────────────────────────────────────────────────────────

/**
 * Server-side transport implementation. Delegates:
 *   - outbound messages → LobbyServer.sendToPlayer / LobbyServer.broadcast
 *   - inbound message routing → MessageRouter
 *   - player connection events → LobbyServer.onPlayerConnected / onPlayerDisconnected
 *
 * Constructs a minimal LobbyPlayerEntry for each connected player using the
 * playerId as the default displayName (profile updates arrive later via the
 * PROFILE_UPDATE side-channel message).
 */
export class WsHostTransport implements HostTransport {
    constructor(
        private readonly server: LobbyServer,
        private readonly router: MessageRouter,
    ) {}

    // ─── Outbound ─────────────────────────────────────────────────────────────

    sendSnapshot(playerId: PlayerId, snapshot: PlayerSnapshot): void {
        const msg: ServerMessage = { type: 'SNAPSHOT', snapshot, checksum: crc32Json(snapshot) };
        this.server.sendToPlayer(playerId, msg);
    }

    broadcastLobbyState(state: LobbyState): void {
        const msg: ServerMessage = { type: 'LOBBY_STATE', state };
        this.server.broadcast(msg);
    }

    sendSideChannel(target: PlayerId | 'broadcast', msg: SideChannelMessage): void {
        const frame = this.sideChannelToServerMessage(msg);
        if (frame === null) return;
        if (target === 'broadcast') {
            this.server.broadcast(frame);
        } else {
            this.server.sendToPlayer(target, frame);
        }
    }

    // ─── Inbound / subscriptions ──────────────────────────────────────────────

    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe {
        return this.router.onActionReceived(cb);
    }

    onReadyStateUpdate(cb: (from: PlayerId, ready: boolean) => void): Unsubscribe {
        return this.router.onReadyStateUpdate(cb);
    }

    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe {
        return this.router.onSideChannelReceived(cb);
    }

    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe {
        return this.server.onPlayerConnected((playerId) => {
            const entry: LobbyPlayerEntry = {
                playerId,
                displayName: playerId,
                ready: false,
            };
            cb(entry);
        });
    }

    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe {
        return this.server.onPlayerDisconnected(cb);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private sideChannelToServerMessage(msg: SideChannelMessage): ServerMessage | null {
        if (msg.kind === 'chat') {
            return {
                type: 'CHAT',
                from: msg.payload.senderId,
                body: msg.payload.text,
                serverTime: Date.now(),
            };
        }
        // profile: The current wire protocol has no SERVER_PROFILE_UPDATE frame.
        // Sending a garbage LOBBY_STATE frame here is incorrect and confusing.
        // Drop the side-channel silently until F14 adds proper protocol support.
        // TODO(F14): add a SERVER_PROFILE_UPDATE message type to ServerMessage
        return null;
    }
}
