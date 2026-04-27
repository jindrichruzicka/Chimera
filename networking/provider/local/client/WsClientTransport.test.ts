/**
 * networking/provider/local/client/WsClientTransport.test.ts
 *
 * Tests for WsClientTransport — implements ClientTransport over a ServerConnection.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T05 (issue #220)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { crc32Json } from '@chimera/shared/crc32.js';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { Logger } from '@chimera/shared/logging.js';
import { LobbyServer } from '../server/LobbyServer.js';
import { MessageRouter } from '../server/MessageRouter.js';
import { WsHostTransport } from '../server/WsHostTransport.js';
import type { ClientMessage } from '@chimera/shared/messages.js';
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
        expect(typeof transport.onLatencyUpdate).toBe('function');
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

    it('sets checksum to crc32Json(action) on the outbound ACTION frame', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const frames: ClientMessage[] = [];
        server.onMessage((_from, msg) => {
            if (msg.type === 'ACTION') frames.push(msg);
        });

        const action = { type: 'test:move', playerId, tick: 5, payload: { x: 2 } };
        transport.sendAction(action);
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(frames).toHaveLength(1);
        const frame = frames[0];
        expect(frame?.type).toBe('ACTION');
        if (frame?.type === 'ACTION') {
            expect(frame.checksum).toBe(crc32Json(action));
        }
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

// ─── CRC32 validation on inbound SNAPSHOT ────────────────────────────────────

describe('WsClientTransport — CRC32 validation on inbound SNAPSHOT', () => {
    it('does NOT fire onSnapshotReceived when the SNAPSHOT checksum is wrong', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => snapshots.push(s));

        const snapshot = makeSnapshot(playerId);
        // Send a SNAPSHOT with a deliberately wrong checksum (correct + 1)
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot,
            checksum: crc32Json(snapshot) + 1,
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(snapshots).toHaveLength(0);
    });

    it('fires onSnapshotReceived when the SNAPSHOT checksum is correct', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => snapshots.push(s));

        const snapshot = makeSnapshot(playerId);
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot,
            checksum: crc32Json(snapshot),
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.viewerId).toBe(playerId);
    });

    it('logs a warning when the SNAPSHOT checksum is wrong', async () => {
        const warnMessages: string[] = [];
        const logger: Logger = {
            trace: (): void => {},
            debug: (): void => {},
            info: (): void => {},
            warn: (msg: string): void => {
                warnMessages.push(msg);
            },
            error: (): void => {},
            fatal: (): void => {},
            child(): Logger {
                return logger;
            },
        };

        const server = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 4 });
        servers.push(server);
        // MessageRouter must be constructed to register inbound message handlers on
        // the server before clients connect — without it the server silently drops
        // client messages (e.g. JOIN handshake internals).
        new MessageRouter(server);
        await server.ready();

        const conn = new ServerConnection();
        connections.push(conn);
        const { playerId } = await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, {
            playerId: toPlayerId('pending'),
            displayName: 'TestLogger',
        });

        const transportWithLogger = new WsClientTransport(conn, playerId, logger);
        const snapshots: PlayerSnapshot[] = [];
        transportWithLogger.onSnapshotReceived((s) => snapshots.push(s));

        const snapshot = makeSnapshot(playerId);
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot,
            checksum: crc32Json(snapshot) + 1,
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(snapshots).toHaveLength(0);
        expect(warnMessages).toHaveLength(1);
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

// ─── onLatencyUpdate ─────────────────────────────────────────────────────────

describe('WsClientTransport — onLatencyUpdate', () => {
    it('fires with latencyMs >= 0 when a PONG is received', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        // Wait for the initial constructor PING/PONG to complete before subscribing
        await new Promise<void>((r) => setTimeout(r, 80));

        const latencies: number[] = [];
        transport.onLatencyUpdate((ms) => latencies.push(ms));

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() - 5,
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(latencies).toHaveLength(1);
        expect(latencies[0]).toBeGreaterThanOrEqual(0);
    });

    it('fires automatically when the server responds to the initial PING', async () => {
        const { transport } = await makeClientTransport();

        const latencies: number[] = [];
        transport.onLatencyUpdate((ms) => latencies.push(ms));

        // The initial PING is sent in the constructor; the MessageRouter responds
        // with a PONG automatically — wait for the round-trip.
        await new Promise<void>((r) => setTimeout(r, 100));

        expect(latencies.length).toBeGreaterThanOrEqual(1);
        expect(latencies[0]).toBeGreaterThanOrEqual(0);
    });

    it('does not fire after unsubscribe', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const latencies: number[] = [];
        const unsub = transport.onLatencyUpdate((ms) => latencies.push(ms));
        unsub();

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() - 5,
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(latencies).toHaveLength(0);
    });

    it('clamps latency to 0 when a PONG sentAt is in the future', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        await new Promise<void>((r) => setTimeout(r, 80));

        const latencies: number[] = [];
        transport.onLatencyUpdate((ms) => latencies.push(ms));

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() + 1_000,
        });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(latencies).toHaveLength(1);
        expect(latencies[0]).toBe(0);
    });
});

// ─── dispose — clears PING interval ──────────────────────────────────────────

describe('WsClientTransport — dispose', () => {
    it('clears the PING interval so no additional PINGs are sent after dispose', () => {
        vi.useFakeTimers();

        const sentMessages: { type: string }[] = [];
        const stubConn = {
            send: (msg: { type: string }): void => {
                sentMessages.push(msg);
            },
            onMessage: (): (() => void) => (): void => {},
            onDisconnected: (): (() => void) => (): void => {},
        } as unknown as ServerConnection;

        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));

        // Initial PING is sent immediately in the constructor
        expect(sentMessages.filter((m) => m.type === 'PING')).toHaveLength(1);

        transport.dispose();

        // Advance well past the 5 s interval — no further PINGs should be sent
        vi.advanceTimersByTime(15_000);

        expect(sentMessages.filter((m) => m.type === 'PING')).toHaveLength(1);

        vi.useRealTimers();
    });

    it('unsubscribes the internal disconnect listener on dispose', () => {
        let unsubCalled = 0;
        const stubConn = {
            send: (): void => {},
            onMessage: (): (() => void) => (): void => {},
            onDisconnected: (): (() => void) => {
                return (): void => {
                    unsubCalled += 1;
                };
            },
        } as unknown as ServerConnection;

        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        transport.dispose();

        expect(unsubCalled).toBe(1);
    });

    it('clears all subscriber Sets on dispose so no callbacks fire after teardown', () => {
        // Build a stub that lets us capture the onMessage handler so we can
        // drive it manually after dispose().
        let capturedOnMessage: ((msg: unknown) => void) | null = null;
        const stubConn = {
            send: (): void => {},
            onMessage: (handler: (msg: unknown) => void): (() => void) => {
                capturedOnMessage = handler;
                return (): void => {};
            },
            onDisconnected: (): (() => void) => (): void => {},
        } as unknown as ServerConnection;

        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));

        const snapshotFired: unknown[] = [];
        const sideChannelFired: unknown[] = [];
        const lobbyStateFired: unknown[] = [];
        const latencyFired: unknown[] = [];

        transport.onSnapshotReceived((s) => snapshotFired.push(s));
        transport.onSideChannelReceived((m) => sideChannelFired.push(m));
        transport.onLobbyStateChanged((s) => lobbyStateFired.push(s));
        transport.onLatencyUpdate((ms) => latencyFired.push(ms));

        transport.dispose();

        // Push a PONG message through the captured handler — nothing should fire.
        // TypeScript's control-flow analysis cannot track let-assignments that happen
        // inside closures, so we assert the type here after construction.
        const dispatch = capturedOnMessage as ((msg: unknown) => void) | null;
        dispatch?.({
            type: 'PONG',
            sentAt: performance.now() - 1,
        });

        expect(snapshotFired).toHaveLength(0);
        expect(sideChannelFired).toHaveLength(0);
        expect(lobbyStateFired).toHaveLength(0);
        expect(latencyFired).toHaveLength(0);
    });
});
