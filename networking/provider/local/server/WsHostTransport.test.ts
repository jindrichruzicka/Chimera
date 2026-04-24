/**
 * networking/provider/local/server/WsHostTransport.test.ts
 *
 * Tests for WsHostTransport — implements HostTransport over a LobbyServer.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T03 (issue #218)
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type {
    HostTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
    LobbyPlayerEntry,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ClientMessage, ServerMessage } from '@chimera/shared/messages.js';
import { LobbyServer } from './LobbyServer.js';
import { MessageRouter } from './MessageRouter.js';
import { WsHostTransport } from './WsHostTransport.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pid(s: string): PlayerId {
    return s as PlayerId;
}

function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 7,
        viewerId,
        players: {},
        entities: {},
        phase: 'test',
        events: [],
        undoMeta: { canUndo: false, canRedo: false },
    };
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
                    profile: { playerId: pid('pending'), displayName: 'Tester' },
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
});

function makeTransport(): { server: LobbyServer; transport: HostTransport } {
    const server = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 4 });
    servers.push(server);
    const router = new MessageRouter(server);
    const transport = new WsHostTransport(server, router);
    return { server, transport };
}

// ─── HostTransport interface compliance ──────────────────────────────────────

describe('WsHostTransport — implements HostTransport', () => {
    it('exposes all HostTransport methods', () => {
        const { transport } = makeTransport();
        expect(typeof transport.sendSnapshot).toBe('function');
        expect(typeof transport.broadcastLobbyState).toBe('function');
        expect(typeof transport.sendSideChannel).toBe('function');
        expect(typeof transport.onActionReceived).toBe('function');
        expect(typeof transport.onSideChannelReceived).toBe('function');
        expect(typeof transport.onPlayerJoined).toBe('function');
        expect(typeof transport.onPlayerLeft).toBe('function');
    });
});

// ─── sendSnapshot ─────────────────────────────────────────────────────────────

describe('WsHostTransport — sendSnapshot', () => {
    it('delivers a SNAPSHOT message to the target client', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const p = new Promise<ServerMessage>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });

        transport.sendSnapshot(playerId, makeSnapshot(playerId));

        const msg = await p;
        expect(msg.type).toBe('SNAPSHOT');
        if (msg.type === 'SNAPSHOT') {
            expect(msg.snapshot.viewerId).toBe(playerId);
            expect(msg.snapshot.tick).toBe(7);
        }
        ws.close();
    });
});

// ─── broadcastLobbyState ──────────────────────────────────────────────────────

describe('WsHostTransport — broadcastLobbyState', () => {
    it('delivers a LOBBY_STATE message to all clients', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);

        const p1 = new Promise<ServerMessage>((resolve) => {
            c1.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        const p2 = new Promise<ServerMessage>((resolve) => {
            c2.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });

        const state: LobbyState = {
            info: { sessionId: 'x', hostId: pid('h'), gameId: 'test' },
            players: [],
        };
        transport.broadcastLobbyState(state);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.type).toBe('LOBBY_STATE');
        expect(r2.type).toBe('LOBBY_STATE');
        c1.ws.close();
        c2.ws.close();
    });
});

// ─── sendSideChannel ──────────────────────────────────────────────────────────

describe('WsHostTransport — sendSideChannel', () => {
    it('unicast delivers a CHAT frame to the target client only', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);

        const p1 = new Promise<ServerMessage>((resolve) => {
            c1.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        const received2: ServerMessage[] = [];
        c2.ws.on('message', (raw) => received2.push(JSON.parse(rawToString(raw)) as ServerMessage));

        const chatMsg: SideChannelMessage = {
            kind: 'chat',
            payload: { senderId: pid('host'), text: 'hello', timestamp: 0 },
        };
        transport.sendSideChannel(c1.playerId, chatMsg);

        const r1 = await p1;
        expect(r1.type).toBe('CHAT');
        await new Promise<void>((r) => setTimeout(r, 20));
        expect(received2).toHaveLength(0);
        c1.ws.close();
        c2.ws.close();
    });

    it('broadcast delivers to all clients', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);

        const p1 = new Promise<ServerMessage>((resolve) => {
            c1.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        const p2 = new Promise<ServerMessage>((resolve) => {
            c2.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });

        transport.sendSideChannel('broadcast', {
            kind: 'chat',
            payload: { senderId: pid('host'), text: 'all', timestamp: 0 },
        });

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.type).toBe('CHAT');
        expect(r2.type).toBe('CHAT');
        c1.ws.close();
        c2.ws.close();
    });
});

// ─── onActionReceived ─────────────────────────────────────────────────────────

describe('WsHostTransport — onActionReceived', () => {
    it('fires when a client sends an ACTION message', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const received: { from: PlayerId }[] = [];
        transport.onActionReceived((from) => received.push({ from }));

        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 3,
                action: { type: 'test:noop', playerId, tick: 3, payload: {} },
                checksum: 0,
            } satisfies ClientMessage),
        );

        await new Promise<void>((r) => setTimeout(r, 30));
        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        ws.close();
    });

    it('returns an Unsubscribe that stops delivery', async () => {
        const { server, transport } = makeTransport();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const received: unknown[] = [];
        const unsub = transport.onActionReceived((_from, a) => received.push(a));
        unsub();

        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 1,
                action: { type: 'test:noop', playerId, tick: 1, payload: {} },
                checksum: 0,
            } satisfies ClientMessage),
        );

        await new Promise<void>((r) => setTimeout(r, 30));
        expect(received).toHaveLength(0);
        ws.close();
    });
});

// ─── onPlayerJoined / onPlayerLeft ────────────────────────────────────────────

describe('WsHostTransport — onPlayerJoined / onPlayerLeft', () => {
    it('fires onPlayerJoined when a client connects', async () => {
        const { server, transport } = makeTransport();
        await server.ready();

        const joined: LobbyPlayerEntry[] = [];
        transport.onPlayerJoined((p) => joined.push(p));

        const { ws } = await connectAndJoin(server);
        expect(joined).toHaveLength(1);
        expect(typeof joined[0]?.playerId).toBe('string');
        ws.close();
    });

    it('fires onPlayerLeft when a client disconnects', async () => {
        const { server, transport } = makeTransport();
        await server.ready();

        const left: PlayerId[] = [];
        transport.onPlayerLeft((id) => left.push(id));

        const { ws, playerId } = await connectAndJoin(server);

        await new Promise<void>((resolve) => {
            transport.onPlayerLeft(() => resolve());
            ws.close();
        });

        expect(left).toHaveLength(1);
        expect(left[0]).toBe(playerId);
    });
});
