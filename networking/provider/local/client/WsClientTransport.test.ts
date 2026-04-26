/**
 * networking/provider/local/client/WsClientTransport.test.ts
 *
 * Tests for WsClientTransport — implements ClientTransport over a ServerConnection.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T05 (issue #220)
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { LobbyServer } from '../server/LobbyServer.js';
import { MessageRouter } from '../server/MessageRouter.js';
import { WsHostTransport } from '../server/WsHostTransport.js';
import { ServerConnection } from './ServerConnection.js';
import { WsClientTransport } from './WsClientTransport.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 10,
        viewerId,
        players: {},
        entities: {},
        phase: 'test',
        events: [],
        undoMeta: { canUndo: false, canRedo: false },
    };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const servers: LobbyServer[] = [];
const connections: ServerConnection[] = [];

afterEach(async () => {
    await Promise.all(connections.map((c) => c.close()));
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
    connections.length = 0;
});

async function makeClientTransport(opts?: { maxRetries?: number }): Promise<{
    server: LobbyServer;
    hostTransport: WsHostTransport;
    playerId: PlayerId;
    transport: ClientTransport;
}> {
    const server = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 4 });
    servers.push(server);
    const router = new MessageRouter(server);
    const hostTransport = new WsHostTransport(server, router);
    await server.ready();

    const conn = new ServerConnection(opts);
    connections.push(conn);
    const { playerId } = await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, {
        playerId: toPlayerId('pending'),
        displayName: 'TestClient',
    });

    const transport = new WsClientTransport(conn, playerId);
    return { server, hostTransport, playerId, transport };
}

// ─── Interface compliance ─────────────────────────────────────────────────────

describe('WsClientTransport — implements ClientTransport', () => {
    it('exposes all ClientTransport methods', async () => {
        const { transport } = await makeClientTransport();
        expect(typeof transport.sendAction).toBe('function');
        expect(typeof transport.sendReadyStateUpdate).toBe('function');
        expect(typeof transport.sendSideChannel).toBe('function');
        expect(typeof transport.onSnapshotReceived).toBe('function');
        expect(typeof transport.onSideChannelReceived).toBe('function');
        expect(typeof transport.onLobbyStateChanged).toBe('function');
        expect(typeof transport.onDisconnected).toBe('function');
    });
});

// ─── sendAction ───────────────────────────────────────────────────────────────

describe('WsClientTransport — sendAction', () => {
    it('delivers an ACTION message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received: { from: PlayerId }[] = [];
        server.onMessage((from, msg) => {
            if (msg.type === 'ACTION') received.push({ from });
        });

        transport.sendAction({ type: 'test:move', playerId, tick: 3, payload: { x: 1 } });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
    });
});

describe('WsClientTransport — sendReadyStateUpdate', () => {
    it('delivers a READY_STATE_UPDATE message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received: { from: PlayerId; ready: boolean }[] = [];
        server.onMessage((from, msg) => {
            if (msg.type === 'READY_STATE_UPDATE') {
                received.push({ from, ready: msg.ready });
            }
        });

        transport.sendReadyStateUpdate(true);
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.from).toBe(playerId);
        expect(received[0]?.ready).toBe(true);
    });
});

// ─── onSnapshotReceived ───────────────────────────────────────────────────────

describe('WsClientTransport — onSnapshotReceived', () => {
    it('fires when the host sends a SNAPSHOT message', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => snapshots.push(s));

        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.viewerId).toBe(playerId);
    });

    it('Unsubscribe stops delivery', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        const unsub = transport.onSnapshotReceived((s) => snapshots.push(s));
        unsub();

        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await new Promise<void>((r) => setTimeout(r, 30));
        expect(snapshots).toHaveLength(0);
    });
});

// ─── onLobbyStateChanged ──────────────────────────────────────────────────────

describe('WsClientTransport — onLobbyStateChanged', () => {
    it('fires when the host broadcasts a LOBBY_STATE message', async () => {
        const { hostTransport, transport } = await makeClientTransport();

        const states: LobbyState[] = [];
        transport.onLobbyStateChanged((s) => states.push(s));

        const state: LobbyState = {
            info: { sessionId: 'x', hostId: toPlayerId('h'), gameId: 'test' },
            players: [],
        };
        hostTransport.broadcastLobbyState(state);
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(states).toHaveLength(1);
        expect(states[0]?.info.gameId).toBe('test');
    });
});

// ─── onSideChannelReceived ────────────────────────────────────────────────────

describe('WsClientTransport — onSideChannelReceived', () => {
    it('fires when the host sends a CHAT frame', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const received: SideChannelMessage[] = [];
        transport.onSideChannelReceived((m) => received.push(m));

        hostTransport.sendSideChannel(playerId, {
            kind: 'chat',
            payload: { senderId: toPlayerId('host'), text: 'hello', timestamp: 0 },
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(received).toHaveLength(1);
        expect(received[0]?.kind).toBe('chat');
    });
});

// ─── onDisconnected ───────────────────────────────────────────────────────────

describe('WsClientTransport — onDisconnected', () => {
    it('fires when the server closes the connection', async () => {
        const { server, transport } = await makeClientTransport({ maxRetries: 0 });

        const reasons: string[] = [];
        transport.onDisconnected((r) => reasons.push(r));

        await server.close();
        // Remove server from cleanup list (already closed)
        const idx = servers.indexOf(server);
        if (idx !== -1) servers.splice(idx, 1);

        await new Promise<void>((r) => setTimeout(r, 100));
        expect(reasons.length).toBeGreaterThan(0);
    });
});
