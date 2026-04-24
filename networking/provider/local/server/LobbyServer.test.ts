/**
 * networking/provider/local/server/LobbyServer.test.ts
 *
 * Unit tests for LobbyServer — the WebSocket server backbone of
 * LocalWebSocketProvider.
 *
 * All tests bind to port 0 (OS assigns a random free port) to avoid
 * conflicts when run in parallel.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T02 (issue #217)
 *
 * Invariants upheld:
 *   #2 — no imports from renderer/, electron/, or DOM APIs
 *   networking boundary — only imports from within local/ or shared/
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import { LobbyServer } from './LobbyServer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pid(s: string): PlayerId {
    return s as PlayerId;
}

/** Safely convert ws RawData (Buffer | ArrayBuffer | Buffer[]) to a string. */
function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

function connectAndJoin(
    server: LobbyServer,
    displayName = 'Tester',
): Promise<{ ws: WebSocket; playerId: PlayerId }> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.on('error', reject);
        ws.on('open', () => {
            const joinMsg: ClientMessage = {
                type: 'JOIN',
                token: server.token,
                profile: { playerId: pid('pending'), displayName },
            };
            ws.send(JSON.stringify(joinMsg));
        });
        ws.on('message', (raw) => {
            const msg = JSON.parse(rawToString(raw)) as ServerMessage;
            if (msg.type === 'WELCOME') {
                resolve({ ws, playerId: msg.playerId });
            } else if (msg.type === 'REJECT') {
                reject(new Error(`JOIN rejected: ${msg.reason}`));
            }
        });
    });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const servers: LobbyServer[] = [];

afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
});

function makeServer(opts?: { maxPlayers?: number }): LobbyServer {
    const s = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: opts?.maxPlayers ?? 4 });
    servers.push(s);
    return s;
}

// ─── Construction & lifecycle ────────────────────────────────────────────────

describe('LobbyServer — construction and lifecycle', () => {
    it('exposes a positive port after construction', async () => {
        const server = makeServer();
        await server.ready();
        expect(server.port).toBeGreaterThan(0);
    });

    it('exposes a non-empty token', async () => {
        const server = makeServer();
        await server.ready();
        expect(typeof server.token).toBe('string');
        expect(server.token.length).toBeGreaterThan(0);
    });

    it('each instance has a unique token', async () => {
        const s1 = makeServer();
        const s2 = makeServer();
        await Promise.all([s1.ready(), s2.ready()]);
        expect(s1.token).not.toBe(s2.token);
    });

    it('close() resolves without throwing', async () => {
        const server = makeServer();
        await server.ready();
        await expect(server.close()).resolves.toBeUndefined();
    });

    it('close() can be called multiple times without throwing', async () => {
        const server = makeServer();
        await server.ready();
        await server.close();
        await expect(server.close()).resolves.toBeUndefined();
    });
});

// ─── JOIN handshake ──────────────────────────────────────────────────────────

describe('LobbyServer — JOIN handshake', () => {
    it('sends WELCOME with a unique PlayerId on valid JOIN', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);
        expect(typeof playerId).toBe('string');
        expect(playerId.length).toBeGreaterThan(0);
        ws.close();
    });

    it('assigns distinct PlayerId values to different clients', async () => {
        const server = makeServer();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);
        expect(c1.playerId).not.toBe(c2.playerId);
        c1.ws.close();
        c2.ws.close();
    });

    it('sends REJECT when the token is wrong', async () => {
        const server = makeServer();
        await server.ready();
        const rejected = await new Promise<ServerMessage>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('open', () => {
                const join: ClientMessage = {
                    type: 'JOIN',
                    token: 'wrong-token',
                    profile: { playerId: pid('x'), displayName: 'X' },
                };
                ws.send(JSON.stringify(join));
            });
            ws.on('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        expect(rejected.type).toBe('REJECT');
    });

    it('rejects when the server is at capacity', async () => {
        const server = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 1 });
        servers.push(server);
        await server.ready();

        const first = await connectAndJoin(server);

        const rejected = await new Promise<ServerMessage>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('open', () => {
                ws.send(
                    JSON.stringify({
                        type: 'JOIN',
                        token: server.token,
                        profile: { playerId: pid('x'), displayName: 'X' },
                    } satisfies ClientMessage),
                );
            });
            ws.on('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        expect(rejected.type).toBe('REJECT');
        first.ws.close();
    });
});

// ─── sendToPlayer / broadcast ─────────────────────────────────────────────────

describe('LobbyServer — sending messages', () => {
    it('sendToPlayer delivers to the correct client', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const received = await new Promise<ServerMessage>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
            server.sendToPlayer(playerId, { type: 'PONG', sentAt: 0, serverTime: 1 });
        });
        expect(received.type).toBe('PONG');
        ws.close();
    });

    it('broadcast delivers to all connected clients', async () => {
        const server = makeServer();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);

        // Set up listeners first, then broadcast, then await
        const p1 = new Promise<ServerMessage>((resolve) => {
            c1.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        const p2 = new Promise<ServerMessage>((resolve) => {
            c2.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });

        server.broadcast({ type: 'PONG', sentAt: 0, serverTime: 2 });

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.type).toBe('PONG');
        expect(r2.type).toBe('PONG');
        c1.ws.close();
        c2.ws.close();
    });

    it('sendToPlayer is a no-op for unknown PlayerId', async () => {
        const server = makeServer();
        await server.ready();
        expect(() =>
            server.sendToPlayer(pid('ghost'), { type: 'PONG', sentAt: 0, serverTime: 0 }),
        ).not.toThrow();
    });
});

// ─── Event subscriptions ──────────────────────────────────────────────────────

describe('LobbyServer — event subscriptions', () => {
    it('onPlayerConnected fires when a client completes JOIN', async () => {
        const server = makeServer();
        await server.ready();

        const joined: PlayerId[] = [];
        server.onPlayerConnected((id) => joined.push(id));

        const { ws } = await connectAndJoin(server);
        expect(joined).toHaveLength(1);
        ws.close();
    });

    it('onPlayerDisconnected fires when a client disconnects', async () => {
        const server = makeServer();
        await server.ready();

        const left: PlayerId[] = [];
        server.onPlayerDisconnected((id) => left.push(id));

        const { ws } = await connectAndJoin(server);
        await new Promise<void>((resolve) => {
            server.onPlayerDisconnected(() => resolve());
            ws.close();
        });
        expect(left).toHaveLength(1);
    });

    it('onPlayerConnected returns an Unsubscribe that stops firing', async () => {
        const server = makeServer();
        await server.ready();

        const joined: PlayerId[] = [];
        const unsub = server.onPlayerConnected((id) => joined.push(id));
        unsub();

        const { ws } = await connectAndJoin(server);
        // Allow any pending callbacks to flush
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(joined).toHaveLength(0);
        ws.close();
    });

    it('onMessage fires for ACTION messages from a connected client', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const messages: { from: PlayerId; msg: ClientMessage }[] = [];
        server.onMessage((from, msg) => messages.push({ from, msg }));

        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 1,
                action: { type: 'test:noop', playerId, tick: 1, payload: {} },
                checksum: 0,
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        expect(messages).toHaveLength(1);
        expect(messages[0]?.from).toBe(playerId);
        expect(messages[0]?.msg.type).toBe('ACTION');
        ws.close();
    });
});
