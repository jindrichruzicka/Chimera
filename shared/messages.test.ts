/**
 * shared/messages.test.ts
 *
 * Tests for the wire protocol types defined in shared/messages.ts.
 *
 * Architecture: §4.3 — WebSocket Message Protocol
 * Task: F10 / T01 (issue #216)
 */

import { describe, it, expect } from 'vitest';
import type { PlayerId } from '@chimera/shared/engine-contract.js';
import {
    isClientMessage,
    isServerMessage,
    type ClientMessage,
    type ServerMessage,
} from './messages.js';

// shared/ is the foundation leaf, so its tests construct branded ids locally
// rather than importing the `playerId` factory from simulation/networking (#758).
const toPlayerId = (raw: string): PlayerId => raw as PlayerId;

// ─── ClientMessage ────────────────────────────────────────────────────────────

describe('shared/messages — ClientMessage', () => {
    it('JOIN message has the correct shape', () => {
        const msg: ClientMessage = {
            type: 'JOIN',
            token: 'abc123',
            profile: { playerId: toPlayerId('p1'), displayName: 'Alice' },
        };
        expect(msg.type).toBe('JOIN');
    });

    it('ACTION message has the correct shape', () => {
        const msg: ClientMessage = {
            type: 'ACTION',
            tick: 10,
            action: { type: 'test:noop', playerId: toPlayerId('p1'), tick: 10, payload: {} },
            checksum: 0,
        };
        expect(msg.type).toBe('ACTION');
        expect(msg.tick).toBe(10);
    });

    it('PING message has a sentAt timestamp', () => {
        const msg: ClientMessage = { type: 'PING', sentAt: 12345 };
        expect(msg.type).toBe('PING');
        expect(msg.sentAt).toBe(12345);
    });

    it('PROFILE_UPDATE message has a profile', () => {
        const msg: ClientMessage = {
            type: 'PROFILE_UPDATE',
            profile: {
                localProfileId: 'player-001',
                displayName: 'Bob',
                avatar: { kind: 'builtin', ref: 'avatars/default' },
                locale: 'en-US',
            },
        };
        expect(msg.type).toBe('PROFILE_UPDATE');
    });

    it('CHAT message carries a body and a routing scope', () => {
        const msg: ClientMessage = { type: 'CHAT', body: 'hello', scope: { kind: 'lobby' } };
        expect(msg.type).toBe('CHAT');
        expect(msg.body).toBe('hello');
        expect(msg.scope.kind).toBe('lobby');
    });

    it('CHAT message accepts team and private scopes', () => {
        const team: ClientMessage = {
            type: 'CHAT',
            body: 'team only',
            scope: { kind: 'team', teamId: 'red' },
        };
        const priv: ClientMessage = {
            type: 'CHAT',
            body: 'psst',
            scope: { kind: 'private', toPlayerId: toPlayerId('p2') },
        };
        expect(team.scope.kind).toBe('team');
        expect(priv.scope.kind).toBe('private');
    });

    it('READY_STATE_UPDATE message has a boolean ready flag', () => {
        const msg: ClientMessage = { type: 'READY_STATE_UPDATE', ready: true };
        expect(msg.type).toBe('READY_STATE_UPDATE');
        expect(msg.ready).toBe(true);
    });

    it('PLAYER_ATTRIBUTE_UPDATE message carries a key/value pair', () => {
        const msg: ClientMessage = {
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'color',
            value: 'amber',
        };
        expect(msg.type).toBe('PLAYER_ATTRIBUTE_UPDATE');
        expect(msg.key).toBe('color');
        expect(msg.value).toBe('amber');
    });

    it('LEAVE message signals an intentional departure (no payload)', () => {
        const msg: ClientMessage = { type: 'LEAVE' };
        expect(msg.type).toBe('LEAVE');
    });
});

// ─── ServerMessage ────────────────────────────────────────────────────────────

describe('shared/messages — ServerMessage', () => {
    const lobbyInfo = { sessionId: 's1', hostId: toPlayerId('host'), gameId: 'test' };

    it('WELCOME message has playerId and lobbyState', () => {
        const msg: ServerMessage = {
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: { info: lobbyInfo, players: [] },
        };
        expect(msg.type).toBe('WELCOME');
    });

    it('SNAPSHOT message has snapshot and checksum', () => {
        const msg: ServerMessage = {
            type: 'SNAPSHOT',
            snapshot: {
                tick: 5,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'playing',
                events: [],
                gameResult: null,
                commitments: {},
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };
        expect(msg.type).toBe('SNAPSHOT');
        expect(msg.checksum).toBe(42);
    });

    it('TICK message carries only the authoritative tick', () => {
        const msg: ServerMessage = { type: 'TICK', tick: 12 };

        expect(msg.type).toBe('TICK');
        expect(msg.tick).toBe(12);
    });

    it('REJECT message has reason and tick', () => {
        const msg: ServerMessage = { type: 'REJECT', reason: 'stale_tick', tick: 7 };
        expect(msg.type).toBe('REJECT');
    });

    it('CLOSE message has a disconnect reason', () => {
        const msg: ServerMessage = { type: 'CLOSE', reason: 'host_closed' };
        expect(msg.type).toBe('CLOSE');
        expect(msg.reason).toBe('host_closed');
    });

    it('CHAT message carries id, from, body, scope and serverTime', () => {
        const msg: ServerMessage = {
            type: 'CHAT',
            id: 'msg-1',
            from: toPlayerId('p1'),
            body: 'hello',
            scope: { kind: 'lobby' },
            serverTime: 42,
        };
        expect(msg.type).toBe('CHAT');
        expect(msg.id).toBe('msg-1');
        expect(msg.scope.kind).toBe('lobby');
        expect(msg.serverTime).toBe(42);
    });

    it('PONG message has sentAt (serverTime deferred to F-clock-skew)', () => {
        const msg: ServerMessage = { type: 'PONG', sentAt: 100 };
        expect(msg.type).toBe('PONG');
        expect(msg.sentAt).toBe(100);
    });

    it('LOBBY_STATE message has a LobbyState payload', () => {
        const msg: ServerMessage = {
            type: 'LOBBY_STATE',
            state: { info: lobbyInfo, players: [] },
        };
        expect(msg.type).toBe('LOBBY_STATE');
    });

    it('PROFILE_REJECT message carries a structured rejection reason', () => {
        const msg: ServerMessage = {
            type: 'PROFILE_REJECT',
            reason: 'profile:NAMESPACE_COLLISION',
        };
        expect(msg.type).toBe('PROFILE_REJECT');
        expect(msg.reason).toBe('profile:NAMESPACE_COLLISION');
    });
});

// ─── isClientMessage ──────────────────────────────────────────────────────────

describe('shared/messages — isClientMessage type guard', () => {
    it('returns true for a valid ClientMessage', () => {
        expect(isClientMessage({ type: 'PING', sentAt: 0 })).toBe(true);
    });

    it('returns false for a non-object', () => {
        expect(isClientMessage(null)).toBe(false);
        expect(isClientMessage(42)).toBe(false);
        expect(isClientMessage('string')).toBe(false);
    });

    it('returns false for an object with no type field', () => {
        expect(isClientMessage({})).toBe(false);
    });

    it('returns false for an unknown type string', () => {
        expect(isClientMessage({ type: 'UNKNOWN_MSG' })).toBe(false);
    });

    it('returns true for READY_STATE_UPDATE', () => {
        expect(isClientMessage({ type: 'READY_STATE_UPDATE', ready: false })).toBe(true);
    });

    it('returns true for PLAYER_ATTRIBUTE_UPDATE', () => {
        expect(
            isClientMessage({ type: 'PLAYER_ATTRIBUTE_UPDATE', key: 'color', value: 'amber' }),
        ).toBe(true);
    });

    it('returns true for LEAVE', () => {
        expect(isClientMessage({ type: 'LEAVE' })).toBe(true);
    });
});

// ─── isServerMessage ──────────────────────────────────────────────────────────

describe('shared/messages — isServerMessage type guard', () => {
    it('returns true for a valid ServerMessage type', () => {
        expect(isServerMessage({ type: 'PONG', sentAt: 0 })).toBe(true);
    });

    it('returns true for CLOSE', () => {
        expect(isServerMessage({ type: 'CLOSE', reason: 'host_closed' })).toBe(true);
    });

    it('returns true for TICK', () => {
        expect(isServerMessage({ type: 'TICK', tick: 3 })).toBe(true);
    });

    it('returns true for PROFILE_REJECT', () => {
        expect(isServerMessage({ type: 'PROFILE_REJECT', reason: 'rate_limit' })).toBe(true);
    });

    it('returns false for an unknown type string', () => {
        expect(isServerMessage({ type: 'UNKNOWN_MSG' })).toBe(false);
    });

    it('returns false for null', () => {
        expect(isServerMessage(null)).toBe(false);
    });
});
