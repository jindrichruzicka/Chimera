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
import type { PlayerId } from './engine-contract.js';
import {
    ClientMessageSchema,
    ServerMessageSchema,
    WIRE_MAX_CHAT_BODY_LENGTH,
    WIRE_MAX_JOIN_CLAIMS,
    WIRE_MAX_JOIN_CLAIM_ID_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
    WIRE_MAX_PROFILE_REJECT_REASON_LENGTH,
} from './messages-schemas.js';

// shared/ is the foundation leaf, so its tests construct branded ids locally
// rather than importing the `playerId` factory from simulation/networking (#758).
const toPlayerId = (raw: string): PlayerId => raw as PlayerId;

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

describe('ClientMessageSchema — JOIN claims (F68/#821)', () => {
    const baseJoin = {
        type: 'JOIN',
        token: 'abc123',
        profile: { playerId: toPlayerId('p1'), displayName: 'Alice' },
    };

    it('parses a JOIN carrying a single seat claim', () => {
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: [{ matchId: 'match-1', playerId: 'seat-a' }],
        });
        expect(result.success).toBe(true);
    });

    it('parses a JOIN with an empty claims array (claims presented but sanitized away)', () => {
        const result = ClientMessageSchema.safeParse({ ...baseJoin, claims: [] });
        expect(result.success).toBe(true);
    });

    it('accepts claims at the wire caps (16 entries, 64-char ids)', () => {
        const claim = {
            matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
            playerId: 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
        };
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: Array.from({ length: WIRE_MAX_JOIN_CLAIMS }, () => claim),
        });
        expect(result.success).toBe(true);
    });

    it('rejects claims exceeding the entry cap (coarse DoS bound)', () => {
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: Array.from({ length: WIRE_MAX_JOIN_CLAIMS + 1 }, () => ({
                matchId: 'match-1',
                playerId: 'seat-a',
            })),
        });
        expect(result.success).toBe(false);
    });

    it('rejects a claim with an overlong matchId', () => {
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: [
                { matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1), playerId: 'seat-a' },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects a claim with an overlong playerId', () => {
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: [
                { matchId: 'match-1', playerId: 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1) },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects a claim with an empty matchId or playerId', () => {
        for (const claim of [
            { matchId: '', playerId: 'seat-a' },
            { matchId: 'match-1', playerId: '' },
        ]) {
            const result = ClientMessageSchema.safeParse({ ...baseJoin, claims: [claim] });
            expect(result.success).toBe(false);
        }
    });

    it('rejects a claim with unknown extra fields (strict schema — opaque ids only)', () => {
        const result = ClientMessageSchema.safeParse({
            ...baseJoin,
            claims: [{ matchId: 'match-1', playerId: 'seat-a', displayName: 'Mallory' }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects non-array claims and non-object claim entries', () => {
        for (const claims of ['seat-a', [{ matchId: 'match-1' }], ['seat-a']]) {
            const result = ClientMessageSchema.safeParse({ ...baseJoin, claims });
            expect(result.success).toBe(false);
        }
    });

    it('still parses a JOIN without claims (backward compatible)', () => {
        const result = ClientMessageSchema.safeParse(baseJoin);
        expect(result.success).toBe(true);
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
    it('parses a CHAT message for every scope variant', () => {
        const scopes = [
            { kind: 'lobby' },
            { kind: 'team', teamId: 'red' },
            { kind: 'private', toPlayerId: toPlayerId('p2') },
        ];
        for (const scope of scopes) {
            const result = ClientMessageSchema.safeParse({ type: 'CHAT', body: 'hi', scope });
            expect(result.success).toBe(true);
        }
    });

    it('rejects CHAT with no scope (scope is required)', () => {
        const result = ClientMessageSchema.safeParse({ type: 'CHAT', body: 'hello' });
        expect(result.success).toBe(false);
    });

    it('rejects CHAT with an unknown scope discriminant', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'hello',
            scope: { kind: 'all' },
        });
        expect(result.success).toBe(false);
    });

    it('rejects a team scope missing its teamId', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'hello',
            scope: { kind: 'team' },
        });
        expect(result.success).toBe(false);
    });

    it('rejects CHAT with unknown extra fields (strict schema)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'hello',
            scope: { kind: 'lobby' },
            extra: true,
        });
        expect(result.success).toBe(false);
    });

    it('accepts a CHAT body at the wire length cap', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'x'.repeat(WIRE_MAX_CHAT_BODY_LENGTH),
            scope: { kind: 'lobby' },
        });
        expect(result.success).toBe(true);
    });

    it('rejects a CHAT body that exceeds the wire length cap (coarse DoS bound)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'CHAT',
            body: 'x'.repeat(WIRE_MAX_CHAT_BODY_LENGTH + 1),
            scope: { kind: 'lobby' },
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

describe('ClientMessageSchema — PLAYER_ATTRIBUTE_UPDATE', () => {
    it('parses a valid PLAYER_ATTRIBUTE_UPDATE message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'color',
            value: 'amber',
        });
        expect(result.success).toBe(true);
    });

    it('rejects PLAYER_ATTRIBUTE_UPDATE with a non-string value', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'color',
            value: 42,
        });
        expect(result.success).toBe(false);
    });

    it('rejects PLAYER_ATTRIBUTE_UPDATE missing the key', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            value: 'amber',
        });
        expect(result.success).toBe(false);
    });

    it('accepts PLAYER_ATTRIBUTE_UPDATE with a value at the coarse wire value cap (a JSON deck fits)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'deck',
            value: 'a'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH),
        });
        expect(result.success).toBe(true);
    });

    it('rejects PLAYER_ATTRIBUTE_UPDATE with an over-length value (coarse wire cap)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'color',
            value: 'a'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH + 1),
        });
        expect(result.success).toBe(false);
    });

    it('still rejects PLAYER_ATTRIBUTE_UPDATE with an over-length key (key cap is unchanged)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'PLAYER_ATTRIBUTE_UPDATE',
            key: 'k'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH + 1),
            value: 'amber',
        });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — LEAVE', () => {
    it('parses a valid LEAVE message (no payload)', () => {
        const result = ClientMessageSchema.safeParse({ type: 'LEAVE' });
        expect(result.success).toBe(true);
    });

    it('rejects LEAVE with unknown extra fields (strict schema)', () => {
        const result = ClientMessageSchema.safeParse({ type: 'LEAVE', reason: 'bye' });
        expect(result.success).toBe(false);
    });
});

describe('ClientMessageSchema — SPECTATE_TARGET_UPDATE (spectator perspective switch, #876)', () => {
    it('parses a valid SPECTATE_TARGET_UPDATE message', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId: 'p2',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('SPECTATE_TARGET_UPDATE');
        }
    });

    it('rejects SPECTATE_TARGET_UPDATE missing targetPlayerId', () => {
        const result = ClientMessageSchema.safeParse({ type: 'SPECTATE_TARGET_UPDATE' });
        expect(result.success).toBe(false);
    });

    it('rejects SPECTATE_TARGET_UPDATE with an empty targetPlayerId', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId: '',
        });
        expect(result.success).toBe(false);
    });

    it('accepts a targetPlayerId at the wire id cap', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId: 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH),
        });
        expect(result.success).toBe(true);
    });

    it('rejects a targetPlayerId exceeding the wire id cap (coarse DoS bound)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId: 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1),
        });
        expect(result.success).toBe(false);
    });

    it('rejects SPECTATE_TARGET_UPDATE with unknown extra fields (strict schema)', () => {
        const result = ClientMessageSchema.safeParse({
            type: 'SPECTATE_TARGET_UPDATE',
            targetPlayerId: 'p2',
            extra: 'garbage',
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

    it('defaults the handshake role to "player" when the host omits it (old hosts, #876)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: { info: defaultLobbyInfo, players: [] },
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'WELCOME') {
            expect(result.data.role).toBe('player');
        }
    });

    it('parses a WELCOME that declares a spectator handshake role (#876)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: { info: defaultLobbyInfo, players: [] },
            role: 'spectator',
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'WELCOME') {
            expect(result.data.role).toBe('spectator');
        }
    });

    it('rejects a WELCOME with an unknown handshake role (#876)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: { info: defaultLobbyInfo, players: [] },
            role: 'observer',
        });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — CHAT', () => {
    it('parses a valid CHAT message carrying id and scope', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'CHAT',
            id: 'msg-1',
            from: toPlayerId('p1'),
            body: 'hello',
            scope: { kind: 'lobby' },
            serverTime: 42,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'CHAT') {
            expect(result.data.id).toBe('msg-1');
            expect(result.data.scope.kind).toBe('lobby');
        }
    });

    it('rejects CHAT missing id', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'CHAT',
            from: toPlayerId('p1'),
            body: 'hello',
            scope: { kind: 'lobby' },
            serverTime: 42,
        });
        expect(result.success).toBe(false);
    });

    it('rejects CHAT with a malformed scope discriminant', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'CHAT',
            id: 'msg-1',
            from: toPlayerId('p1'),
            body: 'hello',
            scope: { kind: 'whisper', toPlayerId: toPlayerId('p2') },
            serverTime: 42,
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

describe('ServerMessageSchema — TICK', () => {
    it('parses a valid TICK message', () => {
        const result = ServerMessageSchema.safeParse({ type: 'TICK', tick: 12 });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ type: 'TICK', tick: 12 });
        }
    });

    it('rejects TICK with non-integer tick', () => {
        const result = ServerMessageSchema.safeParse({ type: 'TICK', tick: 12.5 });

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

    it('parses LOBBY_STATE with host-authored matchSettings and per-player attributes', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'LOBBY_STATE',
            state: {
                info: defaultLobbyInfo,
                matchSettings: { boardColor: 'blue' },
                players: [
                    {
                        playerId: toPlayerId('p1'),
                        displayName: 'Alice',
                        ready: false,
                        attributes: { unitColor: 'red' },
                    },
                ],
            },
        });
        expect(result.success).toBe(true);
    });

    it('parses LOBBY_STATE with matchSettings and attributes absent (backward compatible)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'LOBBY_STATE',
            state: {
                info: defaultLobbyInfo,
                players: [{ playerId: toPlayerId('p1'), displayName: 'Alice', ready: false }],
            },
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'LOBBY_STATE') {
            expect(result.data.state.matchSettings).toBeUndefined();
            expect(result.data.state.players[0]?.attributes).toBeUndefined();
        }
    });

    it('rejects LOBBY_STATE matchSettings with a non-string value', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'LOBBY_STATE',
            state: {
                info: defaultLobbyInfo,
                matchSettings: { boardColor: 42 },
                players: [{ playerId: toPlayerId('p1'), displayName: 'Alice', ready: false }],
            },
        });
        expect(result.success).toBe(false);
    });

    it('rejects a player attributes entry with a non-string value', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'LOBBY_STATE',
            state: {
                info: defaultLobbyInfo,
                players: [
                    {
                        playerId: toPlayerId('p1'),
                        displayName: 'Alice',
                        ready: false,
                        attributes: { unitColor: true },
                    },
                ],
            },
        });
        expect(result.success).toBe(false);
    });
});

describe('LobbyPlayerEntry role (who-is-watching flag, #876)', () => {
    const entryWith = (role?: unknown) => ({
        type: 'LOBBY_STATE' as const,
        state: {
            info: defaultLobbyInfo,
            players: [
                {
                    playerId: toPlayerId('p1'),
                    displayName: 'Alice',
                    ready: false,
                    ...(role !== undefined ? { role } : {}),
                },
            ],
        },
    });

    it('parses a roster entry that declares a spectator role', () => {
        const result = ServerMessageSchema.safeParse(entryWith('spectator'));
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'LOBBY_STATE') {
            expect(result.data.state.players[0]?.role).toBe('spectator');
        }
    });

    it('parses a roster entry that omits role (backward-compatible)', () => {
        const result = ServerMessageSchema.safeParse(entryWith());
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'LOBBY_STATE') {
            expect(result.data.state.players[0]?.role).toBeUndefined();
        }
    });

    it('rejects a roster entry with an unknown role value', () => {
        const result = ServerMessageSchema.safeParse(entryWith('observer'));
        expect(result.success).toBe(false);
    });
});

describe('wire schemas — parsing never mutates its input (#876)', () => {
    it('leaves a frozen SPECTATE_TARGET_UPDATE input unchanged', () => {
        const input = Object.freeze({ type: 'SPECTATE_TARGET_UPDATE', targetPlayerId: 'p2' });
        const snapshot = { ...input };
        const result = ClientMessageSchema.safeParse(input);
        expect(result.success).toBe(true);
        expect(input).toStrictEqual(snapshot);
    });

    it('leaves a frozen WELCOME input unchanged even when the role default is applied', () => {
        const input = Object.freeze({
            type: 'WELCOME',
            playerId: toPlayerId('p1'),
            lobbyState: Object.freeze({ info: defaultLobbyInfo, players: Object.freeze([]) }),
        });
        const snapshot = { ...input };
        const result = ServerMessageSchema.safeParse(input);
        expect(result.success).toBe(true);
        // The `.default('player')` materialises on the parsed *output*, never on the input.
        expect(input).toStrictEqual(snapshot);
        expect(input).not.toHaveProperty('role');
    });
});

describe('ServerMessageSchema — SNAPSHOT setup (synced lobby config)', () => {
    const baseSnapshot = {
        tick: 1,
        viewerId: toPlayerId('p1'),
        players: {},
        entities: {},
        phase: 'game',
        events: [],
        gameResult: null,
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };

    it('parses SNAPSHOT with a synced setup config', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: {
                ...baseSnapshot,
                setup: {
                    matchSettings: { boardColor: 'blue' },
                    playerAttributes: { [toPlayerId('p1')]: { unitColor: 'red' } },
                },
            },
            checksum: 42,
        });
        expect(result.success).toBe(true);
    });

    it('parses SNAPSHOT with setup absent (backward compatible)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: { ...baseSnapshot },
            checksum: 42,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'SNAPSHOT') {
            expect(result.data.snapshot.setup).toBeUndefined();
        }
    });

    it('rejects SNAPSHOT setup.matchSettings with a non-string value', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: {
                ...baseSnapshot,
                setup: { matchSettings: { boardColor: 1 }, playerAttributes: {} },
            },
            checksum: 42,
        });
        expect(result.success).toBe(false);
    });

    it('rejects SNAPSHOT setup.playerAttributes with a non-object value', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: {
                ...baseSnapshot,
                setup: { matchSettings: {}, playerAttributes: { [toPlayerId('p1')]: 'red' } },
            },
            checksum: 42,
        });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — SNAPSHOT matchId (host-minted match identity, #820)', () => {
    const baseSnapshot = {
        tick: 1,
        viewerId: toPlayerId('p1'),
        players: {},
        entities: {},
        phase: 'game',
        events: [],
        gameResult: null,
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };

    it('parses SNAPSHOT with a matchId and preserves it for clients', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: { ...baseSnapshot, matchId: 'match-uuid-1' },
            checksum: 42,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'SNAPSHOT') {
            expect(result.data.snapshot.matchId).toBe('match-uuid-1');
        }
    });

    it('parses SNAPSHOT with matchId absent (backward compatible)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: { ...baseSnapshot },
            checksum: 42,
        });
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'SNAPSHOT') {
            expect(result.data.snapshot.matchId).toBeUndefined();
        }
    });

    it('rejects SNAPSHOT with a non-string matchId', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'SNAPSHOT',
            snapshot: { ...baseSnapshot, matchId: 7 },
            checksum: 42,
        });
        expect(result.success).toBe(false);
    });
});

describe('ServerMessageSchema — PROFILE_REJECT', () => {
    it('parses a valid PROFILE_REJECT message', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'PROFILE_REJECT',
            reason: 'profile:AVATAR_TOO_LARGE',
        });
        expect(result.success).toBe(true);
    });

    it('rejects PROFILE_REJECT missing reason', () => {
        const result = ServerMessageSchema.safeParse({ type: 'PROFILE_REJECT' });
        expect(result.success).toBe(false);
    });

    it('accepts a PROFILE_REJECT reason at the wire length cap', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'PROFILE_REJECT',
            reason: 'x'.repeat(WIRE_MAX_PROFILE_REJECT_REASON_LENGTH),
        });
        expect(result.success).toBe(true);
    });

    it('rejects a PROFILE_REJECT reason that exceeds the wire length cap (coarse DoS bound)', () => {
        const result = ServerMessageSchema.safeParse({
            type: 'PROFILE_REJECT',
            reason: 'x'.repeat(WIRE_MAX_PROFILE_REJECT_REASON_LENGTH + 1),
        });
        expect(result.success).toBe(false);
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
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
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
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.commitments).toStrictEqual(msg.snapshot.commitments);
        }
    });

    it('SNAPSHOT preserves isMyTurn for renderer turn controls', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 1,
                viewerId: toPlayerId('p2'),
                players: {},
                entities: {},
                phase: 'game',
                events: [],
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: false,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.isMyTurn).toBe(false);
        }
    });

    it('SNAPSHOT accepts extended sceneTransition timeout fields', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 5,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'game',
                sceneId: 'engine:game',
                sceneTransition: {
                    toSceneId: 'engine:post-game',
                    phase: 'preparing',
                    startedAtTick: 1,
                    params: {},
                    playersReady: [],
                    timeoutTicks: 4_000,
                    onClientTimeout: 'drop',
                },
                events: [],
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.sceneTransition).toStrictEqual(msg.snapshot.sceneTransition);
        }
    });

    it('SNAPSHOT preserves null gameResult while the match is in progress', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 1,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'game',
                events: [],
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.gameResult).toBeNull();
        }
    });

    it('SNAPSHOT preserves resolved gameResult winnerIds including draw', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 2,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'ended',
                events: [],
                gameResult: { winnerIds: [] },
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.gameResult).toEqual({ winnerIds: [] });
        }
    });

    it('LOBBY_STATE preserves host matchSettings and per-player attributes', () => {
        const msg = {
            type: 'LOBBY_STATE' as const,
            state: {
                info: defaultLobbyInfo,
                matchSettings: { boardColor: 'blue' },
                players: [
                    {
                        playerId: toPlayerId('p1'),
                        displayName: 'Alice',
                        ready: false,
                        attributes: { unitColor: 'red' },
                    },
                ],
            },
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'LOBBY_STATE') {
            expect(round.data.state.matchSettings).toStrictEqual(msg.state.matchSettings);
            expect(round.data.state.players[0]?.attributes).toStrictEqual(
                msg.state.players[0]?.attributes,
            );
        }
    });

    it('SNAPSHOT preserves the synced setup config for clients', () => {
        const msg = {
            type: 'SNAPSHOT' as const,
            snapshot: {
                tick: 3,
                viewerId: toPlayerId('p1'),
                players: {},
                entities: {},
                phase: 'game',
                events: [],
                setup: {
                    matchSettings: { boardColor: 'blue' },
                    playerAttributes: { [toPlayerId('p1')]: { unitColor: 'red' } },
                },
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: true,
            },
            checksum: 42,
        };

        const round = ServerMessageSchema.safeParse(JSON.parse(JSON.stringify(msg)));

        expect(round.success).toBe(true);
        if (round.success && round.data.type === 'SNAPSHOT') {
            expect(round.data.snapshot.setup).toStrictEqual(msg.snapshot.setup);
        }
    });
});
