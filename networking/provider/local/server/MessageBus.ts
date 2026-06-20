/**
 * networking/provider/local/server/MessageBus.ts
 *
 * Minimal transport-facing contract consumed by MessageRouter.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: issue #333
 */

import type { Unsubscribe } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { PlayerId } from '@chimera/simulation/contracts';
import type { ClientMessage, ServerMessage } from '@chimera/simulation/foundation/messages.js';

export type MessageBusCallback = (from: PlayerId, message: ClientMessage) => void;

export interface MessageBus {
    onMessage(cb: MessageBusCallback): Unsubscribe;
    sendToPlayer(playerId: PlayerId, message: ServerMessage): void;
}
