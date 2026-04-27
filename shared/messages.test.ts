/**
 * shared/messages.test.ts
 *
 * Tests for the wire protocol types defined in shared/messages.ts.
 *
 * Architecture: §4.3 — WebSocket Message Protocol
 * Task: F10 / T01 (issue #216)
 */

import { describe, it, expect } from 'vitest';
import { playerId as toPlayerId } from '../networking/provider/MultiplayerProvider.js';
import {
    isClientMessage,
    isServerMessage,
    type ClientMessage,
    type ServerMessage,
} from './messages.js';

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
            profile: { playerId: toPlayerId('p1'), displayName: 'Bob' },
        };
        expect(msg.type).toBe('PROFILE_UPDATE');
    });

    it('CHAT message has body (scope deferred to F45)', () => {
        const msg: ClientMessage = { type: 'CHAT', body: 'hello' };
        expect(msg.type).toBe('CHAT');
        expect(msg.body).toBe('hello');
    });

    it('READY_STATE_UPDATE message has a boolean ready flag', () => {
        const msg: ClientMessage = { type: 'READY_STATE_UPDATE', ready: true };
        expect(msg.type).toBe('READY_STATE_UPDATE');
        expect(msg.ready).toBe(true);
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
                undoMeta: { canUndo: false, canRedo: false },
            },
            checksum: 42,
        };
        expect(msg.type).toBe('SNAPSHOT');
        expect(msg.checksum).toBe(42);
    });

    it('REJECT message has reason and tick', () => {
        const msg: ServerMessage = { type: 'REJECT', reason: 'stale_tick', tick: 7 };
        expect(msg.type).toBe('REJECT');
    });

    it('PONG message has sentAt and serverTime', () => {
        const msg: ServerMessage = { type: 'PONG', sentAt: 100, serverTime: 200 };
        expect(msg.type).toBe('PONG');
        expect(msg.serverTime).toBe(200);
    });

    it('LOBBY_STATE message has a LobbyState payload', () => {
        const msg: ServerMessage = {
            type: 'LOBBY_STATE',
            state: { info: lobbyInfo, players: [] },
        };
        expect(msg.type).toBe('LOBBY_STATE');
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
});

// ─── isServerMessage ──────────────────────────────────────────────────────────

describe('shared/messages — isServerMessage type guard', () => {
    it('returns true for a valid ServerMessage type', () => {
        expect(isServerMessage({ type: 'PONG', sentAt: 0, serverTime: 1 })).toBe(true);
    });

    it('returns false for an unknown type string', () => {
        expect(isServerMessage({ type: 'UNKNOWN_MSG' })).toBe(false);
    });

    it('returns false for null', () => {
        expect(isServerMessage(null)).toBe(false);
    });
});
