/**
 * networking/provider/local/server/MessageRouter.test.ts
 *
 * Tests for MessageRouter — routes inbound ClientMessages from LobbyServer to
 * the WsHostTransport callback sets.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T03 (issue #218)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import { crc32Json } from '@chimera/shared/crc32.js';
import { LobbyServer } from './LobbyServer.js';
import { MessageRouter } from './MessageRouter.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

async function connectAndJoin(server: LobbyServer): Promise<{ ws: WebSocket; playerId: PlayerId }> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.on('error', reject);
        ws.on('open', () =>
            ws.send(
                JSON.stringify({
                    type: 'JOIN',
                    token: server.token,
                    profile: { playerId: toPlayerId('pending'), displayName: 'Tester' },
                } satisfies ClientMessage),
            ),
        );
        ws.on('message', (raw) => {
            const msg = JSON.parse(rawToString(raw)) as ServerMessage;
            if (msg.type === 'WELCOME') resolve({ ws, playerId: msg.playerId });
            else if (msg.type === 'REJECT') reject(new Error(`REJECT: ${msg.reason}`));
        });
    });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const servers: LobbyServer[] = [];

afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
    vi.restoreAllMocks();
});

function makeServer(): LobbyServer {
    const s = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 4 });
    servers.push(s);
    return s;
}

// ─── MessageRouter construction ───────────────────────────────────────────────

describe('MessageRouter — construction', () => {
    it('can be constructed with a LobbyServer', () => {
        const server = makeServer();
        expect(() => new MessageRouter(server)).not.toThrow();
    });
});

// ─── ACTION routing ───────────────────────────────────────────────────────────

describe('MessageRouter — ACTION routing', () => {
    it('routes ACTION messages to onActionReceived callbacks', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: { from: PlayerId; action: unknown }[] = [];
        router.onActionReceived((from, action) => received.push({ from, action }));

        const { ws, playerId } = await connectAndJoin(server);

        const action = { type: 'test:move', playerId, tick: 5, payload: { x: 1 } };
        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 5,
                action,
                checksum: crc32Json(action),
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        expect((received[0]?.action as { type: string }).type).toBe('test:move');
        ws.close();
    });

    it('does not fire onActionReceived for non-ACTION messages', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: unknown[] = [];
        router.onActionReceived((_from, a) => received.push(a));

        const { ws } = await connectAndJoin(server);
        ws.send(JSON.stringify({ type: 'PING', sentAt: 0 } satisfies ClientMessage));

        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        expect(received).toHaveLength(0);
        ws.close();
    });

    it('onActionReceived Unsubscribe stops delivery', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: unknown[] = [];
        const unsub = router.onActionReceived((_from, a) => received.push(a));
        unsub();

        const { ws, playerId } = await connectAndJoin(server);
        const action = { type: 'test:noop', playerId, tick: 1, payload: {} };
        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 1,
                action,
                checksum: crc32Json(action),
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        expect(received).toHaveLength(0);
        ws.close();
    });
});

// ─── Side-channel routing ─────────────────────────────────────────────────────

describe('MessageRouter — side-channel routing', () => {
    it('routes CHAT messages to onSideChannelReceived as kind=chat', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: { from: PlayerId; kind: string }[] = [];
        router.onSideChannelReceived((from, msg) => received.push({ from, kind: msg.kind }));

        const { ws, playerId } = await connectAndJoin(server);
        ws.send(JSON.stringify({ type: 'CHAT', body: 'hi', scope: 'all' } satisfies ClientMessage));

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        expect(received[0]?.kind).toBe('chat');
        ws.close();
    });

    it('routes PROFILE_UPDATE messages to onSideChannelReceived as kind=profile', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: { from: PlayerId; kind: string }[] = [];
        router.onSideChannelReceived((from, msg) => received.push({ from, kind: msg.kind }));

        const { ws, playerId } = await connectAndJoin(server);
        ws.send(
            JSON.stringify({
                type: 'PROFILE_UPDATE',
                profile: { playerId, displayName: 'New Name' },
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.kind).toBe('profile');
        ws.close();
    });

    it('onSideChannelReceived Unsubscribe stops delivery', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: unknown[] = [];
        const unsub = router.onSideChannelReceived((_from, m) => received.push(m));
        unsub();

        const { ws } = await connectAndJoin(server);
        ws.send(JSON.stringify({ type: 'CHAT', body: 'hi', scope: 'all' } satisfies ClientMessage));

        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        expect(received).toHaveLength(0);
        ws.close();
    });
});

describe('MessageRouter — ready-state routing', () => {
    it('routes READY_STATE_UPDATE messages to onReadyStateUpdate callbacks', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: { from: PlayerId; ready: boolean }[] = [];
        router.onReadyStateUpdate((from, ready) => received.push({ from, ready }));

        const { ws, playerId } = await connectAndJoin(server);
        ws.send(
            JSON.stringify({ type: 'READY_STATE_UPDATE', ready: true } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        expect(received[0]?.ready).toBe(true);
        ws.close();
    });
});

// ─── PING → PONG ─────────────────────────────────────────────────────────────

describe('MessageRouter — PING/PONG', () => {
    it('responds to PING with a PONG message containing sentAt', async () => {
        const server = makeServer();
        await server.ready();
        new MessageRouter(server); // MessageRouter handles PING

        const { ws } = await connectAndJoin(server);
        const pong = await new Promise<ServerMessage>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
            ws.send(JSON.stringify({ type: 'PING', sentAt: 999 } satisfies ClientMessage));
        });

        expect(pong.type).toBe('PONG');
        if (pong.type === 'PONG') {
            expect(pong.sentAt).toBe(999);
        }
        ws.close();
    });
});

// ─── ACTION checksum validation ───────────────────────────────────────────────

describe('MessageRouter — ACTION checksum validation', () => {
    it('forwards ACTION to callbacks when checksum matches crc32Json(action)', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: { from: PlayerId; action: unknown }[] = [];
        router.onActionReceived((from, action) => received.push({ from, action }));

        const { ws, playerId } = await connectAndJoin(server);
        const action = { type: 'test:move', playerId, tick: 3, payload: { x: 2 } };
        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 3,
                action,
                checksum: crc32Json(action),
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        ws.close();
    });

    it('does NOT forward ACTION to callbacks when checksum is tampered', async () => {
        const server = makeServer();
        await server.ready();
        const router = new MessageRouter(server);

        const received: unknown[] = [];
        router.onActionReceived((_from, action) => received.push(action));

        const { ws, playerId } = await connectAndJoin(server);
        const action = { type: 'test:move', playerId, tick: 7, payload: { x: 99 } };
        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 7,
                action,
                checksum: crc32Json(action) + 1, // deliberately wrong
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(received).toHaveLength(0);
        ws.close();
    });

    it('sends REJECT with reason crc_mismatch and correct tick when checksum is tampered', async () => {
        const server = makeServer();
        await server.ready();
        new MessageRouter(server);

        const { ws, playerId } = await connectAndJoin(server);
        const action = { type: 'test:fire', playerId, tick: 12, payload: {} };

        const reject = await new Promise<ServerMessage>((resolve) => {
            ws.once('message', (raw) => {
                const parsed = JSON.parse(
                    Array.isArray(raw)
                        ? Buffer.concat(raw).toString('utf8')
                        : raw instanceof ArrayBuffer
                          ? Buffer.from(raw).toString('utf8')
                          : raw.toString('utf8'),
                ) as ServerMessage;
                resolve(parsed);
            });
            ws.send(
                JSON.stringify({
                    type: 'ACTION',
                    tick: 12,
                    action,
                    checksum: 0, // wrong checksum
                } satisfies ClientMessage),
            );
        });

        expect(reject.type).toBe('REJECT');
        if (reject.type === 'REJECT') {
            expect(reject.reason).toBe('crc_mismatch');
            expect(reject.tick).toBe(12);
        }
        ws.close();
    });
});
