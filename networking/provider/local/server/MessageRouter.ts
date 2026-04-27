/**
 * networking/provider/local/server/MessageRouter.ts
 *
 * Routes inbound ClientMessages from an injected message bus to typed callback sets.
 *
 * Responsibilities:
 *   - Subscribe to MessageBus.onMessage
 *   - Route ACTION → onActionReceived callbacks
 *   - Route CHAT / PROFILE_UPDATE → onSideChannelReceived as SideChannelMessage
 *   - Respond to PING with a PONG sent back via MessageBus.sendToPlayer
 *
 * All other message types (JOIN is handled by LobbyServer itself before
 * messages reach MessageRouter) are silently ignored.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T03 (issue #218)
 */

import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type {
    SideChannelMessage,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import { crc32Json } from '@chimera/shared/crc32.js';
import type { MessageBus } from './MessageBus.js';

// ─── Callback types ───────────────────────────────────────────────────────────

type ActionCb = (from: PlayerId, action: EngineAction) => void;
type ReadyStateCb = (from: PlayerId, ready: boolean) => void;
type SideChannelCb = (from: PlayerId, msg: SideChannelMessage) => void;

// ─── MessageRouter ────────────────────────────────────────────────────────────

/**
 * Subscribes to raw ClientMessage events from an injected bus and routes them to
 * typed callback sets. WsHostTransport delegates its subscription methods to
 * the router.
 *
 * MessageRouter is constructed once per hosted session; it is shared between
 * WsHostTransport and LocalWebSocketProvider. Its only external dependency is
 * MessageBus — it never touches LobbyServer or ws.WebSocket directly.
 */
export class MessageRouter {
    private readonly actionCbs = new Set<ActionCb>();
    private readonly readyStateCbs = new Set<ReadyStateCb>();
    private readonly sideChannelCbs = new Set<SideChannelCb>();
    private readonly unsub: Unsubscribe;

    constructor(private readonly bus: MessageBus) {
        this.unsub = bus.onMessage((from, msg) => this.route(from, msg));
    }

    // ─── Public subscription API ──────────────────────────────────────────────

    /** Subscribe to ACTION messages delivered by connected clients. */
    onActionReceived(cb: ActionCb): Unsubscribe {
        this.actionCbs.add(cb);
        return (): void => {
            this.actionCbs.delete(cb);
        };
    }

    /** Subscribe to READY_STATE_UPDATE messages delivered by connected clients. */
    onReadyStateUpdate(cb: ReadyStateCb): Unsubscribe {
        this.readyStateCbs.add(cb);
        return (): void => {
            this.readyStateCbs.delete(cb);
        };
    }

    /** Subscribe to side-channel messages (CHAT, PROFILE_UPDATE). */
    onSideChannelReceived(cb: SideChannelCb): Unsubscribe {
        this.sideChannelCbs.add(cb);
        return (): void => {
            this.sideChannelCbs.delete(cb);
        };
    }

    /** Detach from the injected bus. Called when the session is closed. */
    dispose(): void {
        this.unsub();
        this.actionCbs.clear();
        this.readyStateCbs.clear();
        this.sideChannelCbs.clear();
    }

    // ─── Routing logic ────────────────────────────────────────────────────────

    private route(from: PlayerId, msg: ClientMessage): void {
        switch (msg.type) {
            case 'ACTION': {
                const expected = crc32Json(msg.action);
                if (msg.checksum !== expected) {
                    const reject: ServerMessage = {
                        type: 'REJECT',
                        reason: 'crc_mismatch',
                        tick: msg.tick,
                    };
                    this.bus.sendToPlayer(from, reject);
                    break;
                }
                for (const cb of this.actionCbs) {
                    cb(from, msg.action);
                }
                break;
            }

            case 'READY_STATE_UPDATE':
                for (const cb of this.readyStateCbs) {
                    cb(from, msg.ready);
                }
                break;

            case 'CHAT':
                for (const cb of this.sideChannelCbs) {
                    // Internal placeholder only: WsHostTransport stamps wire-level CHAT.serverTime.
                    // Keep this at 0 so review readers do not treat router-local payload time as authoritative.
                    cb(from, {
                        kind: 'chat',
                        payload: { senderId: from, text: msg.body, timestamp: 0 },
                    });
                }
                break;

            case 'PROFILE_UPDATE':
                for (const cb of this.sideChannelCbs) {
                    cb(from, {
                        kind: 'profile',
                        payload: msg.profile,
                    });
                }
                break;

            case 'PING': {
                const pong: ServerMessage = {
                    type: 'PONG',
                    sentAt: msg.sentAt,
                    // TODO(F-clock-skew): add serverTime once clock-skew estimation is implemented.
                };
                this.bus.sendToPlayer(from, pong);
                break;
            }

            default:
                // JOIN is handled before messages reach the router; other unknowns are ignored
                break;
        }
    }
}
