/**
 * networking/provider/local/server/MessageBus.ts
 *
 * Minimal transport-facing contract consumed by MessageRouter.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 */

import type { Unsubscribe } from '../../MultiplayerProvider.js';
import type { PlayerId } from '@chimera-engine/simulation/contracts';
import type {
    ClientMessage,
    ServerMessage,
} from '@chimera-engine/simulation/foundation/messages.js';

export type MessageBusCallback = (from: PlayerId, message: ClientMessage) => void;

export interface MessageBus {
    onMessage(cb: MessageBusCallback): Unsubscribe;
    sendToPlayer(playerId: PlayerId, message: ServerMessage): void;
}
