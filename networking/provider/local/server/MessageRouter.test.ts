/**
 * networking/provider/local/server/MessageRouter.test.ts
 *
 * Tests for MessageRouter — routes inbound ClientMessages from an injected
 * message bus to the WsHostTransport callback sets.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T03 (issue #218), issue #333
 */

import { describe, it, expect } from 'vitest';
import type { PlayerId, EngineAction } from '@chimera/simulation/contracts';
import { playerId as toPlayerId } from '../../MultiplayerProvider.js';
import type { Unsubscribe } from '../../MultiplayerProvider.js';
import type { ClientMessage, ServerMessage } from '@chimera/simulation/foundation/messages.js';
import { crc32Json } from '@chimera/simulation/foundation/crc32.js';
import type { MessageBus } from './MessageBus.js';
import { MessageRouter } from './MessageRouter.js';

// ─── Test double ─────────────────────────────────────────────────────────────

class FakeMessageBus implements MessageBus {
    readonly sentMessages: { readonly playerId: PlayerId; readonly message: ServerMessage }[] = [];

    private readonly messageCbs = new Set<(from: PlayerId, msg: ClientMessage) => void>();

    onMessage(cb: (from: PlayerId, msg: ClientMessage) => void): Unsubscribe {
        this.messageCbs.add(cb);
        return (): void => {
            this.messageCbs.delete(cb);
        };
    }

    sendToPlayer(playerId: PlayerId, message: ServerMessage): void {
        this.sentMessages.push({ playerId, message });
    }

    emit(from: PlayerId, message: ClientMessage): void {
        for (const cb of this.messageCbs) {
            cb(from, message);
        }
    }

    listenerCount(): number {
        return this.messageCbs.size;
    }
}

const playerOne = toPlayerId('p1');

function makeAction(playerId: PlayerId = playerOne): EngineAction {
    return {
        type: 'test:move',
        playerId,
        tick: 5,
        payload: { x: 1 },
    };
}

// ─── MessageRouter construction ───────────────────────────────────────────────

describe('MessageRouter — construction', () => {
    it('subscribes to an injected message bus without depending on LobbyServer', () => {
        const bus = new FakeMessageBus();

        expect(() => new MessageRouter(bus)).not.toThrow();
        expect(bus.listenerCount()).toBe(1);
    });

    it('dispose detaches from the injected bus and clears callback sets', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: EngineAction[] = [];
        router.onActionReceived((_from, action) => received.push(action));

        router.dispose();
        const action = makeAction();
        bus.emit(playerOne, {
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action),
        });

        expect(bus.listenerCount()).toBe(0);
        expect(received).toHaveLength(0);
    });
});

// ─── ACTION routing ───────────────────────────────────────────────────────────

describe('MessageRouter — ACTION routing', () => {
    it('routes ACTION messages to onActionReceived callbacks', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const action = makeAction();
        const received: { readonly from: PlayerId; readonly action: EngineAction }[] = [];
        router.onActionReceived((from, routedAction) =>
            received.push({ from, action: routedAction }),
        );

        bus.emit(playerOne, {
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action),
        });

        expect(received).toEqual([{ from: playerOne, action }]);
    });

    it('does not fire onActionReceived for non-ACTION messages', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: EngineAction[] = [];
        router.onActionReceived((_from, action) => received.push(action));

        bus.emit(playerOne, { type: 'PING', sentAt: 0 });

        expect(received).toHaveLength(0);
    });

    it('onActionReceived Unsubscribe stops delivery', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const action = makeAction();
        const received: EngineAction[] = [];
        const unsubscribe = router.onActionReceived((_from, routedAction) =>
            received.push(routedAction),
        );
        unsubscribe();

        bus.emit(playerOne, {
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action),
        });

        expect(received).toHaveLength(0);
    });
});

// ─── Side-channel routing ─────────────────────────────────────────────────────

describe('MessageRouter — side-channel routing', () => {
    it('routes CHAT messages with id: "" and timestamp: 0 placeholders for the host relay', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: { readonly from: PlayerId; readonly message: unknown }[] = [];
        router.onSideChannelReceived((from, message) => received.push({ from, message }));

        bus.emit(playerOne, { type: 'CHAT', body: 'hi', scope: { kind: 'team', teamId: 'red' } });

        expect(received).toEqual([
            {
                from: playerOne,
                message: {
                    kind: 'chat',
                    payload: {
                        id: '',
                        senderId: playerOne,
                        text: 'hi',
                        scope: { kind: 'team', teamId: 'red' },
                        timestamp: 0,
                    },
                },
            },
        ]);
    });

    it('routes PROFILE_UPDATE messages to onSideChannelReceived as kind=profile', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: { readonly from: PlayerId; readonly kind: string }[] = [];
        router.onSideChannelReceived((from, message) =>
            received.push({ from, kind: message.kind }),
        );

        bus.emit(playerOne, {
            type: 'PROFILE_UPDATE',
            profile: {
                localProfileId: 'player-001',
                displayName: 'New Name',
                avatar: { kind: 'builtin', ref: 'avatars/default' },
                locale: 'en-US',
            },
        });

        expect(received).toEqual([{ from: playerOne, kind: 'profile' }]);
    });

    it('onSideChannelReceived Unsubscribe stops delivery', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: unknown[] = [];
        const unsubscribe = router.onSideChannelReceived((_from, message) =>
            received.push(message),
        );
        unsubscribe();

        bus.emit(playerOne, { type: 'CHAT', body: 'hi', scope: { kind: 'lobby' } });

        expect(received).toHaveLength(0);
    });
});

describe('MessageRouter — ready-state routing', () => {
    it('routes READY_STATE_UPDATE messages to onReadyStateUpdate callbacks', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: { readonly from: PlayerId; readonly ready: boolean }[] = [];
        router.onReadyStateUpdate((from, ready) => received.push({ from, ready }));

        bus.emit(playerOne, { type: 'READY_STATE_UPDATE', ready: true });

        expect(received).toEqual([{ from: playerOne, ready: true }]);
    });
});

describe('MessageRouter — player-attribute routing', () => {
    it('routes PLAYER_ATTRIBUTE_UPDATE messages to onPlayerAttributeUpdate callbacks', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const received: {
            readonly from: PlayerId;
            readonly key: string;
            readonly value: string;
        }[] = [];
        router.onPlayerAttributeUpdate((from, key, value) => received.push({ from, key, value }));

        bus.emit(playerOne, { type: 'PLAYER_ATTRIBUTE_UPDATE', key: 'color', value: 'amber' });

        expect(received).toEqual([{ from: playerOne, key: 'color', value: 'amber' }]);
    });
});

// ─── PING → PONG ─────────────────────────────────────────────────────────────

describe('MessageRouter — PING/PONG', () => {
    it('responds to PING with a PONG message containing sentAt', () => {
        const bus = new FakeMessageBus();
        new MessageRouter(bus);

        bus.emit(playerOne, { type: 'PING', sentAt: 999 });

        expect(bus.sentMessages).toEqual([
            { playerId: playerOne, message: { type: 'PONG', sentAt: 999 } },
        ]);
    });
});

// ─── ACTION checksum validation ───────────────────────────────────────────────

describe('MessageRouter — ACTION checksum validation', () => {
    it('forwards ACTION to callbacks when checksum matches crc32Json(action)', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const action = makeAction();
        const received: { readonly from: PlayerId; readonly action: EngineAction }[] = [];
        router.onActionReceived((from, routedAction) =>
            received.push({ from, action: routedAction }),
        );

        bus.emit(playerOne, {
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action),
        });

        expect(received).toEqual([{ from: playerOne, action }]);
        expect(bus.sentMessages).toHaveLength(0);
    });

    it('does not forward ACTION to callbacks when checksum is tampered', () => {
        const bus = new FakeMessageBus();
        const router = new MessageRouter(bus);
        const action = makeAction();
        const received: EngineAction[] = [];
        router.onActionReceived((_from, routedAction) => received.push(routedAction));

        bus.emit(playerOne, {
            type: 'ACTION',
            tick: action.tick,
            action,
            checksum: crc32Json(action) + 1,
        });

        expect(received).toHaveLength(0);
    });

    it('sends REJECT with reason crc_mismatch and correct tick when checksum is tampered', () => {
        const bus = new FakeMessageBus();
        new MessageRouter(bus);
        const action = makeAction();

        bus.emit(playerOne, {
            type: 'ACTION',
            tick: 12,
            action,
            checksum: 0,
        });

        expect(bus.sentMessages).toEqual([
            {
                playerId: playerOne,
                message: { type: 'REJECT', reason: 'crc_mismatch', tick: 12 },
            },
        ]);
    });
});
