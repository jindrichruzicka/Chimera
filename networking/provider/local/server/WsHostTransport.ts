/**
 * networking/provider/local/server/WsHostTransport.ts
 *
 * Implements HostTransport using LobbyServer (outbound) and MessageRouter
 * (inbound). This is the single bridge between the multiplayer engine API and
 * the raw WebSocket server.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 */

import type { PlayerId, EngineAction } from '@chimera-engine/simulation/contracts';
import type {
    HostTransport,
    PlayerSnapshot,
    LobbyState,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
    Unsubscribe,
    JoinGateResult,
} from '../../MultiplayerProvider.js';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import type {
    ServerMessage,
    WireCommitmentReveal,
} from '@chimera-engine/simulation/foundation/messages.js';
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

    sendTick(playerId: PlayerId, tick: number): void {
        this.server.sendToPlayer(playerId, { type: 'TICK', tick });
    }

    broadcastLobbyState(state: LobbyState): void {
        this.server.broadcastLobbyState(state);
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

    sendReveal(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal): void {
        const msg: ServerMessage = { type: 'REVEAL', reveal };
        if (target === 'broadcast') {
            this.server.broadcast(msg);
        } else {
            this.server.sendToPlayer(target, msg);
        }
    }

    // ─── Inbound / subscriptions ──────────────────────────────────────────────

    onActionReceived(cb: (from: PlayerId, action: EngineAction) => void): Unsubscribe {
        return this.router.onActionReceived(cb);
    }

    onReadyStateUpdate(cb: (from: PlayerId, ready: boolean) => void): Unsubscribe {
        return this.router.onReadyStateUpdate(cb);
    }

    onPlayerAttributeUpdate(cb: (from: PlayerId, key: string, value: string) => void): Unsubscribe {
        return this.router.onPlayerAttributeUpdate(cb);
    }

    onSideChannelReceived(cb: (from: PlayerId, msg: SideChannelMessage) => void): Unsubscribe {
        return this.router.onSideChannelReceived(cb);
    }

    onPlayerJoined(cb: (player: LobbyPlayerEntry) => void): Unsubscribe {
        return this.server.onPlayerConnected((playerId, displayName) => {
            const entry: LobbyPlayerEntry = {
                playerId,
                displayName,
                ready: false,
            };
            cb(entry);
        });
    }

    onPlayerLeft(cb: (playerId: PlayerId, reason: DisconnectReason) => void): Unsubscribe {
        return this.server.onPlayerDisconnected(cb);
    }

    setProfileGate(gate: (pid: PlayerId, rawProfile: unknown) => JoinGateResult): void {
        this.server.setJoinGate(gate);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private sideChannelToServerMessage(msg: SideChannelMessage): ServerMessage | null {
        if (msg.kind === 'chat') {
            // The host-side ChatRelay is the authoritative source of `id`
            // and `serverTime` (Invariant #73); the transport passes them through
            // verbatim rather than re-stamping, so recipients see the relay's
            // ordering clock — not a second, divergent wall-clock read.
            return {
                type: 'CHAT',
                id: msg.payload.id,
                from: msg.payload.senderId,
                body: msg.payload.text,
                scope: msg.payload.scope,
                serverTime: msg.payload.timestamp,
            };
        }
        if (msg.kind === 'profile_reject') {
            // Mid-session PROFILE_UPDATE rejection. Carries the structured
            // reason (`'profile:<AdmissionRejection>'` or `'rate_limit'`) so the
            // client can raise the §4.30 "Profile rejected" toast. Originates from
            // the ProfileGate/ProfileSanitizer admission path (Invariants #61/#62).
            return { type: 'PROFILE_REJECT', reason: msg.reason };
        }
        // profile / profile_ack / chat_reject: the current wire protocol still has
        // no frame for these host→client side-channels, so they deliver only over
        // the in-process provider today. Sending a garbage LOBBY_STATE frame here
        // is incorrect and confusing, so drop silently until proper protocol
        // support lands. (chat_reject is the sender-side rejection signal; without
        // a wire frame a WS sender still sees a silent drop — see chat-system.md.)
        // TODO: add a wire frame for chat_reject too.
        return null;
    }
}
