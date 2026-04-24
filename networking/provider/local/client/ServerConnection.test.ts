/**
 * networking/provider/local/client/ServerConnection.test.ts
 *
 * Tests for ServerConnection — wraps a ws WebSocket with connect, send,
 * close, and event callbacks, plus exponential-backoff reconnect logic.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T04 (issue #219)
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import { LobbyServer } from '../server/LobbyServer.js';
import { MessageRouter } from '../server/MessageRouter.js';
import { ServerConnection } from './ServerConnection.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pid(s: string): PlayerId {
    return s as PlayerId;
}

const defaultProfile = { playerId: pid('pending'), displayName: 'TestClient' };

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const servers: LobbyServer[] = [];

afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
});

function makeServer(): LobbyServer {
    const s = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 4 });
    servers.push(s);
    return s;
}

// ─── connect ──────────────────────────────────────────────────────────────────

describe('ServerConnection — connect', () => {
    it('resolves with the assigned playerId after receiving WELCOME', async () => {
        const server = makeServer();
        await server.ready();

        const conn = new ServerConnection();
        const { playerId } = await conn.connect(
            `ws://127.0.0.1:${server.port}`,
            server.token,
            defaultProfile,
        );

        expect(typeof playerId).toBe('string');
        expect(playerId).toMatch(/^player-\d+$/);
        await conn.close();
    });

    it('rejects when the token is wrong', async () => {
        const server = makeServer();
        await server.ready();

        const conn = new ServerConnection();
        await expect(
            conn.connect(`ws://127.0.0.1:${server.port}`, 'bad-token', defaultProfile),
        ).rejects.toThrow();
    });

    it('rejects when the server is unreachable', async () => {
        const conn = new ServerConnection({ maxRetries: 0 });
        await expect(
            conn.connect('ws://127.0.0.1:19999', 'token', defaultProfile),
        ).rejects.toThrow();
    });
});

// ─── send ─────────────────────────────────────────────────────────────────────

describe('ServerConnection — send', () => {
    it('delivers messages to the server after connect', async () => {
        const server = makeServer();
        await server.ready();

        const received: { from: PlayerId; msg: ClientMessage }[] = [];
        server.onMessage((from, msg) => received.push({ from, msg }));

        const conn = new ServerConnection();
        const { playerId } = await conn.connect(
            `ws://127.0.0.1:${server.port}`,
            server.token,
            defaultProfile,
        );

        conn.send({ type: 'PING', sentAt: 42 });

        await new Promise<void>((r) => setTimeout(r, 30));

        expect(received.some((e) => e.msg.type === 'PING')).toBe(true);
        expect(received.find((e) => e.msg.type === 'PING')?.from).toBe(playerId);
        await conn.close();
    });
});

// ─── onMessage ────────────────────────────────────────────────────────────────

describe('ServerConnection — onMessage', () => {
    it('delivers server messages to subscribed callbacks', async () => {
        const server = makeServer();
        await server.ready();
        // Attach MessageRouter so PING → PONG works
        new MessageRouter(server);

        const conn = new ServerConnection();
        await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, defaultProfile);

        const received: ServerMessage[] = [];
        conn.onMessage((msg) => received.push(msg));

        // Trigger a PONG from the server by sending PING
        conn.send({ type: 'PING', sentAt: 1 });
        await new Promise<void>((r) => setTimeout(r, 60));

        expect(received.some((m) => m.type === 'PONG')).toBe(true);
        await conn.close();
    });

    it('Unsubscribe stops delivery', async () => {
        const server = makeServer();
        await server.ready();
        const conn = new ServerConnection();
        await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, defaultProfile);

        const received: ServerMessage[] = [];
        const unsub = conn.onMessage((msg) => received.push(msg));
        unsub();

        conn.send({ type: 'PING', sentAt: 1 });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(received).toHaveLength(0);
        await conn.close();
    });
});

// ─── onDisconnected ───────────────────────────────────────────────────────────

describe('ServerConnection — onDisconnected', () => {
    it('fires when the server closes the connection', async () => {
        const server = makeServer();
        await server.ready();
        const conn = new ServerConnection({ maxRetries: 0 });
        await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, defaultProfile);

        const reasons: string[] = [];
        conn.onDisconnected((r) => reasons.push(r));

        await server.close();
        await new Promise<void>((r) => setTimeout(r, 60));

        expect(reasons.length).toBeGreaterThan(0);
    });
});

// ─── close ────────────────────────────────────────────────────────────────────

describe('ServerConnection — close', () => {
    it('resolves without error after connect', async () => {
        const server = makeServer();
        await server.ready();
        const conn = new ServerConnection();
        await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, defaultProfile);
        await expect(conn.close()).resolves.toBeUndefined();
    });

    it('resolves without error when called before connect', async () => {
        const conn = new ServerConnection();
        await expect(conn.close()).resolves.toBeUndefined();
    });
});
