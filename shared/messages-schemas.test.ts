/**
 * shared/messages-schemas.test.ts
 *
 * Tests for Zod schemas that validate the wire protocol messages defined in
 * shared/messages.ts.
 *
 * Architecture: §4.3 — WebSocket Message Protocol
 * Task: F10.1 / T01 (issue #225)
 */

import { describe, it, expect } from 'vitest';
import { playerId as toPlayerId } from '../networking/provider/MultiplayerProvider.js';
import { ClientMessageSchema, ServerMessageSchema } from './messages-schemas.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultLobbyInfo = { sessionId: 's1', hostId: toPlayerId('host'), gameId: 'test' };

// ─── ClientMessageSchema ──────────────────────────────────────────────────────

describe('ClientMessageSchema — JOIN', () => {
    it('parses a valid JOIN message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'JOIN',
            token: 'abc123',
            profile: { playerId: toPlayerId('p1'), displayName: 'Alice' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('JOIN');
        }
    });

    it('rejects JOIN missing token', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'JOIN',
            profile: { playerId: toPlayerId('p1'), displayName: 'Alice' },
        });
        expect(result.success).toBe(false);
    });

    it('rejects JOIN missing profile', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'JOIN',
            token: 'abc123',
        });
        expect(result.success).toBe(false);
    });

    it('rejects JOIN with extra unknown field still parses (unknown stripped)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'JOIN',
            token: 'abc123',
            profile: { playerId: toPlayerId('p1'), displayName: 'Alice' },
            extra: 'garbage',
        });
        // Zod strips unknown fields by default in strict mode or passes in passthrough
        // We use .strict() so extra fields are rejected
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — ACTION', () => {
    it('parses a valid ACTION message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'ACTION',
            tick: 10,
            action: { type: 'test:noop', playerId: toPlayerId('p1'), tick: 10, payload: {} },
            checksum: 0,
        });
        expect(result.success).toBe(true);
    });

    it('rejects ACTION missing tick', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'ACTION',
            action: { type: 'test:noop', playerId: toPlayerId('p1'), tick: 10, payload: {} },
            checksum: 0,
        });
        expect(result.success).toBe(false);
    });

    it('rejects ACTION with non-integer tick', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'ACTION',
            tick: 'not-a-number',
            action: { type: 'test:noop', playerId: toPlayerId('p1'), tick: 10, payload: {} },
            checksum: 0,
        });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — PING', () => {
    it('parses a valid PING message', () => {
        const result = ClientMessageSchema.safeParse({ type: 'PING', sentAt: 12345 });
        expect(result.success).toBe(true);
    });

    it('rejects PING missing sentAt', () => {
        const result = ClientMessageSchema.safeParse({ type: 'PING' });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — PROFILE_UPDATE', () => {
    it('parses a valid PROFILE_UPDATE message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PROFILE_UPDATE',
            profile: {
                localProfileId: 'player-001',
                displayName: 'Bob',
                avatar: { kind: 'builtin', ref: 'avatars/default' },
                locale: 'en-US',
            },
        });
        expect(result.success).toBe(true);
    });
});

describe('ClientMessageSchema — CHAT', () => {
    it('parses a valid CHAT message without scope (scope deferred to F45)', () => {
        // scope is removed from the wire protocol until F45 Chat System is implemented.
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'hello',
        });
        expect(result.success).toBe(true);
    });

    it('rejects CHAT with unknown extra fields (strict schema)', () => {
        // After scope removal, sending scope on the wire must be rejected
        // so both ends stay in sync and stale clients are detected at the boundary.
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'hello',
            scope: 'all',
        });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — READY_STATE_UPDATE', () => {
    it('parses a valid READY_STATE_UPDATE message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'READY_STATE_UPDATE',
            ready: true,
        });
        expect(result.success).toBe(true);
    });

    it('rejects READY_STATE_UPDATE with non-boolean ready', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'READY_STATE_UPDATE',
            ready: 'true',
        });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — invalid type', () => {
    it('rejects an unknown type', () => {
        const result = ClientMessageSchema.safeParse({ type: 'UNKNOWN', data: 'x' });
        expect(result.success).toBe(false);
    });

    it('rejects null', () => {
        const result = ClientMessageSchema.safeParse(null);
        expect(result.success).toBe(false);
    });

    it('rejects a plain string', () => {
        const result = ClientMessageSchema.safeParse('JOIN');
        expect(result.success).toBe(false);
    });
});

// ─── ServerMessageSchema ──────────────────────────────────────────────────────

describe('ServerMessageSchema — WELCOME', () => {
    it('parses a valid WELCOME message', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: { info: defaultLobbyInfo, players: [] },
        });
        expect(result.success).toBe(true);
    });

    it('rejects WELCOME missing playerId', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'WELCOME',
            lobbyState: { info: defaultLobbyInfo, players: [] },
        });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — REJECT', () => {
    it('parses a valid REJECT message', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'REJECT',
            reason: 'stale_tick',
            tick: 0,
        });
        expect(result.success).toBe(true);
    });

    it('rejects REJECT missing reason', () => {
        const result = ServerMessageSchema.safeParse({ type: 'REJECT', tick: 0 });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — CLOSE', () => {
    it('parses a valid CLOSE message', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'CLOSE',
            reason: 'host_closed',
        });
        expect(result.success).toBe(true);
    });

    it('rejects CLOSE missing reason', () => {
        const result = ServerMessageSchema.safeParse({ type: 'CLOSE' });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — PONG', () => {
    it('parses a valid PONG message without serverTime (deferred to F-clock-skew)', () => {
        // serverTime is removed from PONG until clock-skew estimation is implemented.
        const result = ServerMessageSchema.safeParse({
            type: 'PONG',
            sentAt: 100,
        });
        expect(result.success).toBe(true);
    });

    it('rejects PONG with extra serverTime field (strict schema)', () => {
        // Once serverTime is removed, old clients sending serverTime must be detected.
        const result = ServerMessageSchema.safeParse({
            type: 'PONG',
            sentAt: 100,
            serverTime: 200,
        });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — LOBBY_STATE', () => {
    it('parses a valid LOBBY_STATE message', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'LOBBY_STATE',
            state: {
                info: defaultLobbyInfo,
                players: [{ playerId: toPlayerId('p1'), displayName: 'Alice', ready: false }],
            },
        });
        expect(result.success).toBe(true);
    });
});

describe('ServerMessageSchema — invalid', () => {
    it('rejects unknown type', () => {
        const result = ServerMessageSchema.safeParse({ type: 'BOGUS' });
        expect(result.success).toBe(false);
    });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('ClientMessageSchema — round-trip via JSON', () => {
    it('JOIN survives JSON serialise → parse', () => {
        const msg = {
            type: 'JOIN' as const,
            token: 'tok',
            profile: { playerId: toPlayerId('p1'), displayName: 'A' },
        };
        const round = ClientMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));
        expect(round.success).toBe(true);
        if (round.success) expect(round.data).toMatchObject(msg);
    });
});

describe('ServerMessageSchema — round-trip via JSON', () => {
    it('SNAPSHOT survives JSON serialise → parse', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 1,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'game',
                events: [],
                undoMeta: { canUndo: false, canRedo: false },
            },
            checksum: 42,
        };
        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));
        expect(round.success).toBe(true);
    });

    it('SNAPSHOT preserves pending commitment envelopes for reveal verification', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 1,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'game',
                events: [],
                commitments: {
                    'commitment-1': {
                        id: 'commitment-1',
                        commitment: 'a'.repeat(64),
                    },
                },
                undoMeta: { canUndo: false, canRedo: false },
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.commitments).toStrictEqual(msg.snapshot.commitments);
        }
    });
});
