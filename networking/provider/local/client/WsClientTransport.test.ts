/**
 * networking/provider/local/client/WsClientTransport.test.ts
 *
 * Tests for WsClientTransport — implements ClientTransport over a ServerConnection.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T05
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import type { PlayerId } from '@chimera-engine/simulation/contracts';
import { playerId as toPlayerId } from '../../MultiplayerProvider.js';
import type {
    ClientTransport,
    PlayerSnapshot,
    LobbyState,
    SideChannelMessage,
} from '../../MultiplayerProvider.js';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { LobbyServer } from '../server/LobbyServer.js';
import { MessageRouter } from '../server/MessageRouter.js';
import { WsHostTransport } from '../server/WsHostTransport.js';
import type {
    ClientMessage,
    ServerMessage,
    WireCommitmentReveal,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { SnapshotDelta } from '@chimera-engine/simulation/foundation/snapshot-delta.js';
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
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
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
    conn: ServerConnection;
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
    return { server, hostTransport, playerId, conn, transport };
}

function waitForServerInboundMessage(
    server: LobbyServer,
    predicate: (from: PlayerId, message: ClientMessage) => boolean,
): Promise<{ readonly from: PlayerId; readonly message: ClientMessage }> {
    return new Promise((resolve) => {
        const unsubscribe = server.onMessage((from, message) => {
            if (!predicate(from, message)) return;
            unsubscribe();
            resolve({ from, message });
        });
    });
}

function waitForConnectionMessage(
    conn: ServerConnection,
    predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
    return new Promise((resolve) => {
        const unsubscribe = conn.onMessage((message) => {
            if (!predicate(message)) return;
            unsubscribe();
            resolve(message);
        });
    });
}

// ─── Interface compliance ─────────────────────────────────────────────────────

describe('WsClientTransport — implements ClientTransport', () => {
    it('exposes all ClientTransport methods', async () => {
        const { transport } = await makeClientTransport();
        expect(typeof transport.sendAction).toBe('function');
        expect(typeof transport.sendReadyStateUpdate).toBe('function');
        expect(typeof transport.sendPlayerAttributeUpdate).toBe('function');
        expect(typeof transport.sendSpectateTarget).toBe('function');
        expect(typeof transport.sendSideChannel).toBe('function');
        expect(typeof transport.onSnapshotReceived).toBe('function');
        expect(typeof transport.onSideChannelReceived).toBe('function');
        expect(typeof transport.onLobbyStateChanged).toBe('function');
        expect(typeof transport.onDisconnected).toBe('function');
        expect(typeof transport.onLatencyUpdate).toBe('function');
        expect(typeof transport.onReveal).toBe('function');
    });
});

// ─── sendAction ───────────────────────────────────────────────────────────────

describe('WsClientTransport — sendAction', () => {
    it('delivers an ACTION message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received = waitForServerInboundMessage(server, (_from, msg) => msg.type === 'ACTION');

        transport.sendAction({ type: 'test:move', playerId, tick: 3, payload: { x: 1 } });
        const receivedMessage = await received;

        expect(receivedMessage.from).toBe(playerId);
    });

    it('sets checksum to crc32Json(action) on the outbound ACTION frame', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received = waitForServerInboundMessage(server, (_from, msg) => msg.type === 'ACTION');

        const action = { type: 'test:move', playerId, tick: 5, payload: { x: 2 } };
        transport.sendAction(action);
        const { message } = await received;

        const frame = message;
        expect(frame?.type).toBe('ACTION');
        if (frame?.type === 'ACTION') {
            expect(frame.checksum).toBe(crc32Json(action));
        }
    });
});

describe('WsClientTransport — sendReadyStateUpdate', () => {
    it('delivers a READY_STATE_UPDATE message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received = waitForServerInboundMessage(
            server,
            (_from, msg) => msg.type === 'READY_STATE_UPDATE',
        );

        transport.sendReadyStateUpdate(true);
        const receivedMessage = await received;

        expect(receivedMessage.from).toBe(playerId);
        expect(receivedMessage.message.type).toBe('READY_STATE_UPDATE');
        if (receivedMessage.message.type === 'READY_STATE_UPDATE') {
            expect(receivedMessage.message.ready).toBe(true);
        }
    });
});

describe('WsClientTransport — sendPlayerAttributeUpdate', () => {
    it('delivers a PLAYER_ATTRIBUTE_UPDATE message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received = waitForServerInboundMessage(
            server,
            (_from, msg) => msg.type === 'PLAYER_ATTRIBUTE_UPDATE',
        );

        transport.sendPlayerAttributeUpdate('color', 'amber');
        const receivedMessage = await received;

        expect(receivedMessage.from).toBe(playerId);
        expect(receivedMessage.message.type).toBe('PLAYER_ATTRIBUTE_UPDATE');
        if (receivedMessage.message.type === 'PLAYER_ATTRIBUTE_UPDATE') {
            expect(receivedMessage.message.key).toBe('color');
            expect(receivedMessage.message.value).toBe('amber');
        }
    });
});

describe('WsClientTransport — sendSpectateTarget', () => {
    it('delivers a SPECTATE_TARGET_UPDATE message to the server', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const received = waitForServerInboundMessage(
            server,
            (_from, msg) => msg.type === 'SPECTATE_TARGET_UPDATE',
        );

        transport.sendSpectateTarget(toPlayerId('seat-2'));
        const receivedMessage = await received;

        expect(receivedMessage.from).toBe(playerId);
        expect(receivedMessage.message.type).toBe('SPECTATE_TARGET_UPDATE');
        if (receivedMessage.message.type === 'SPECTATE_TARGET_UPDATE') {
            expect(receivedMessage.message.targetPlayerId).toBe('seat-2');
        }
    });
});

// ─── onSnapshotReceived ───────────────────────────────────────────────────────

describe('WsClientTransport — onSnapshotReceived', () => {
    it('fires when the host sends a SNAPSHOT message', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const snapshotReceived = new Promise<PlayerSnapshot>((resolve) => {
            const unsubscribe = transport.onSnapshotReceived((snapshot) => {
                unsubscribe();
                resolve(snapshot);
            });
        });

        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        const snapshot = await snapshotReceived;

        expect(snapshot.viewerId).toBe(playerId);
    });

    it('Unsubscribe stops delivery', async () => {
        const { hostTransport, playerId, conn, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        const unsub = transport.onSnapshotReceived((s) => snapshots.push(s));
        unsub();

        const inboundSnapshot = waitForConnectionMessage(
            conn,
            (message) => message.type === 'SNAPSHOT',
        );

        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await inboundSnapshot;

        expect(snapshots).toHaveLength(0);
    });
});

// ─── CRC32 validation on inbound SNAPSHOT ────────────────────────────────────

describe('WsClientTransport — CRC32 validation on inbound SNAPSHOT', () => {
    it('does NOT fire onSnapshotReceived when the SNAPSHOT checksum is wrong', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const snapshots: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => snapshots.push(s));

        const invalidSnapshot = { ...makeSnapshot(playerId), tick: 11 };
        const validSnapshot = { ...makeSnapshot(playerId), tick: 12 };
        const validSnapshotReceived = new Promise<PlayerSnapshot>((resolve) => {
            const unsubscribe = transport.onSnapshotReceived((snapshot) => {
                unsubscribe();
                resolve(snapshot);
            });
        });

        // Send a SNAPSHOT with a deliberately wrong checksum (correct + 1)
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot: invalidSnapshot,
            checksum: crc32Json(invalidSnapshot) + 1,
        });
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot: validSnapshot,
            checksum: crc32Json(validSnapshot),
        });

        const snapshot = await validSnapshotReceived;

        expect(snapshot.tick).toBe(12);
        expect(snapshots).toHaveLength(1);
    });

    it('fires onSnapshotReceived when the SNAPSHOT checksum is correct', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const snapshotReceived = new Promise<PlayerSnapshot>((resolve) => {
            const unsubscribe = transport.onSnapshotReceived((snapshot) => {
                unsubscribe();
                resolve(snapshot);
            });
        });

        const snapshot = makeSnapshot(playerId);
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot,
            checksum: crc32Json(snapshot),
        });
        const receivedSnapshot = await snapshotReceived;

        expect(receivedSnapshot.viewerId).toBe(playerId);
    });

    it('logs a warning when the SNAPSHOT checksum is wrong', async () => {
        const warnMessages: string[] = [];
        let resolveWarn: (() => void) | null = null;
        const warned = new Promise<void>((resolve) => {
            resolveWarn = resolve;
        });
        const logger: Logger = {
            trace: (): void => {},
            debug: (): void => {},
            info: (): void => {},
            warn: (msg: string): void => {
                warnMessages.push(msg);
                resolveWarn?.();
                resolveWarn = null;
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

        // Pass the logger to ServerConnection — CRC validation now happens at the
        // wire boundary in ServerConnection, not in WsClientTransport.
        const conn = new ServerConnection({ logger });
        connections.push(conn);
        const { playerId } = await conn.connect(`ws://127.0.0.1:${server.port}`, server.token, {
            playerId: toPlayerId('pending'),
            displayName: 'TestLogger',
        });

        const transportWithLogger = new WsClientTransport(conn, playerId);
        const snapshots: PlayerSnapshot[] = [];
        transportWithLogger.onSnapshotReceived((s) => snapshots.push(s));

        const snapshot = makeSnapshot(playerId);
        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot,
            checksum: crc32Json(snapshot) + 1,
        });
        await warned;

        expect(snapshots).toHaveLength(0);
        expect(warnMessages).toHaveLength(1);
    });

    it('accepts a SNAPSHOT whose CRC was computed from non-schema-order keys', async () => {
        // Regression test for WARN-1: if CRC is validated on the Zod-reordered object
        // rather than the pre-Zod wire bytes, any snapshot with field order that differs
        // from the Zod schema definition will be falsely rejected.
        //
        // The Zod PlayerSnapshot schema defines fields: tick, viewerId, players, entities,
        // phase, events, undoMeta. This snapshot puts 'phase' FIRST — non-schema order.
        // The host computes CRC with phase-first order; the client must validate against
        // the same bytes, not Zod's reordered output.
        const { server, playerId, transport } = await makeClientTransport();

        const snapshotReceived = new Promise<{
            readonly snapshot: PlayerSnapshot;
            readonly checksum: number;
        }>((resolve) => {
            const unsubscribe = transport.onSnapshotReceived((snapshot, receivedChecksum) => {
                unsubscribe();
                resolve({ snapshot, checksum: receivedChecksum });
            });
        });

        // Non-schema key order: phase comes before tick
        const nonSchemaOrderSnapshot: PlayerSnapshot = {
            phase: 'test',
            tick: 77,
            viewerId: playerId,
            players: {},
            entities: {},
            events: [],
            gameResult: null,
            commitments: {},
            undoMeta: { canUndo: false as const, canRedo: false as const },
            isMyTurn: true,
        };
        // CRC computed from the non-schema-order object — as the host would produce it
        const checksum = crc32Json(nonSchemaOrderSnapshot);

        server.sendToPlayer(playerId, {
            type: 'SNAPSHOT',
            snapshot: nonSchemaOrderSnapshot,
            checksum,
        });
        const { snapshot, checksum: receivedChecksum } = await snapshotReceived;

        // After the fix: snapshot accepted (CRC validated against pre-Zod bytes)
        // Before the fix: snapshot rejected (CRC computed from Zod-reordered keys)
        expect(snapshot.tick).toBe(77);
        expect(receivedChecksum).toBe(checksum);
    });
});

// ─── onLobbyStateChanged ──────────────────────────────────────────────────────

describe('WsClientTransport — onLobbyStateChanged', () => {
    it('fires when the host broadcasts a LOBBY_STATE message', async () => {
        const { hostTransport, transport } = await makeClientTransport();

        const stateReceived = new Promise<LobbyState>((resolve) => {
            const unsubscribe = transport.onLobbyStateChanged((state) => {
                unsubscribe();
                resolve(state);
            });
        });

        const state: LobbyState = {
            info: { sessionId: 'x', hostId: toPlayerId('h'), gameId: 'test' },
            players: [],
        };
        hostTransport.broadcastLobbyState(state);
        const receivedState = await stateReceived;

        expect(receivedState.info.gameId).toBe('test');
    });
});

// ─── onSideChannelReceived ────────────────────────────────────────────────────

describe('WsClientTransport — onSideChannelReceived', () => {
    it('fires when the host sends a CHAT frame', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const messageReceived = new Promise<SideChannelMessage>((resolve) => {
            const unsubscribe = transport.onSideChannelReceived((message) => {
                unsubscribe();
                resolve(message);
            });
        });

        hostTransport.sendSideChannel(playerId, {
            kind: 'chat',
            payload: {
                id: '',
                senderId: toPlayerId('host'),
                text: 'hello',
                scope: { kind: 'lobby' },
                timestamp: 0,
            },
        });
        const message = await messageReceived;

        expect(message.kind).toBe('chat');
    });

    it('fires with a profile_reject when the host sends a PROFILE_REJECT frame', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();

        const messageReceived = new Promise<SideChannelMessage>((resolve) => {
            const unsubscribe = transport.onSideChannelReceived((message) => {
                unsubscribe();
                resolve(message);
            });
        });

        hostTransport.sendSideChannel(playerId, {
            kind: 'profile_reject',
            reason: 'rate_limit',
        });
        const message = await messageReceived;

        expect(message.kind).toBe('profile_reject');
        if (message.kind === 'profile_reject') {
            expect(message.reason).toBe('rate_limit');
        }
    });
});

// ─── onReveal ────────────────────────────────────────────────────────────────

describe('WsClientTransport — onReveal', () => {
    it('fires when the host sends a REVEAL message', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const reveal: WireCommitmentReveal = {
            id: 'commitment-1',
            value: { die: 6 },
            nonce: 'nonce-1',
        };
        const revealReceived = new Promise<WireCommitmentReveal>((resolve) => {
            const unsubscribe = transport.onReveal((message) => {
                unsubscribe();
                resolve(message);
            });
        });

        server.sendToPlayer(playerId, { type: 'REVEAL', reveal });
        const receivedReveal = await revealReceived;

        expect(receivedReveal).toEqual(reveal);
    });
});

// ─── onDisconnected ───────────────────────────────────────────────────────────

describe('WsClientTransport — onDisconnected', () => {
    it('fires when the server closes the connection', async () => {
        const { server, transport } = await makeClientTransport({ maxRetries: 0 });

        const disconnectReason = new Promise<string>((resolve) => {
            const unsubscribe = transport.onDisconnected((reason) => {
                unsubscribe();
                resolve(reason);
            });
        });

        await server.close();
        // Remove server from cleanup list (already closed)
        const idx = servers.indexOf(server);
        if (idx !== -1) servers.splice(idx, 1);

        const reason = await disconnectReason;
        expect(reason.length).toBeGreaterThan(0);
    });
});

// ─── onLatencyUpdate ─────────────────────────────────────────────────────────

describe('WsClientTransport — onLatencyUpdate', () => {
    it('fires with latencyMs >= 0 when a PONG is received', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const latencies: number[] = [];
        transport.onLatencyUpdate((ms) => latencies.push(ms));
        const baseline = latencies.length;

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() - 5,
        });

        await vi.waitFor(() => {
            expect(latencies.length).toBeGreaterThan(baseline);
        });

        const [lastLatency] = latencies.slice(-1);

        expect(lastLatency).toBeGreaterThanOrEqual(0);
    });

    it('fires automatically when the server responds to the initial PING', async () => {
        const { transport } = await makeClientTransport();

        const latency = await new Promise<number>((resolve) => {
            const unsubscribe = transport.onLatencyUpdate((ms) => {
                unsubscribe();
                resolve(ms);
            });
        });

        expect(latency).toBeGreaterThanOrEqual(0);
    });

    it('does not fire after unsubscribe', async () => {
        const { server, playerId, conn, transport } = await makeClientTransport();

        const latencies: number[] = [];
        const unsub = transport.onLatencyUpdate((ms) => latencies.push(ms));
        unsub();

        const pongDelivered = waitForConnectionMessage(conn, (message) => message.type === 'PONG');

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() - 5,
        });
        await pongDelivered;

        expect(latencies).toHaveLength(0);
    });

    it('clamps latency to 0 when a PONG sentAt is in the future', async () => {
        const { server, playerId, transport } = await makeClientTransport();

        const latencies: number[] = [];
        transport.onLatencyUpdate((ms) => latencies.push(ms));

        server.sendToPlayer(playerId, {
            type: 'PONG',
            sentAt: performance.now() + 1_000,
        });

        await vi.waitFor(() => {
            expect(latencies.some((latencyMs) => latencyMs === 0)).toBe(true);
        });
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
        let capturedOnMessage: (msg: unknown) => void = (): void => {};
        let didCaptureOnMessage = false;
        const stubConn = {
            send: (): void => {},
            onMessage: (handler: (msg: unknown) => void): (() => void) => {
                didCaptureOnMessage = true;
                capturedOnMessage = handler;
                return (): void => {};
            },
            onDisconnected: (): (() => void) => (): void => {},
        } as unknown as ServerConnection;

        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));

        const snapshotFired: unknown[] = [];
        const sideChannelFired: unknown[] = [];
        const revealFired: unknown[] = [];
        const lobbyStateFired: unknown[] = [];
        const latencyFired: unknown[] = [];

        transport.onSnapshotReceived((s) => snapshotFired.push(s));
        transport.onSideChannelReceived((m) => sideChannelFired.push(m));
        transport.onReveal((reveal) => revealFired.push(reveal));
        transport.onLobbyStateChanged((s) => lobbyStateFired.push(s));
        transport.onLatencyUpdate((ms) => latencyFired.push(ms));

        transport.dispose();

        // Push a PONG message through the captured handler — nothing should fire.
        expect(didCaptureOnMessage).toBe(true);

        capturedOnMessage({
            type: 'PONG',
            sentAt: performance.now() - 1,
        });
        capturedOnMessage({
            type: 'REVEAL',
            reveal: { id: 'commitment-1', value: 'hidden', nonce: 'nonce-1' },
        });

        expect(snapshotFired).toHaveLength(0);
        expect(sideChannelFired).toHaveLength(0);
        expect(revealFired).toHaveLength(0);
        expect(lobbyStateFired).toHaveLength(0);
        expect(latencyFired).toHaveLength(0);
    });
});

// ─── Pre-subscriber snapshot latch (reconnect resync) ─────────────────────────

describe('WsClientTransport — pre-subscriber snapshot latch', () => {
    function makeCapturingStub(): {
        stubConn: ServerConnection;
        emit: (msg: unknown) => void;
    } {
        let capturedOnMessage: (msg: unknown) => void = (): void => {};
        const stubConn = {
            send: (): void => {},
            onMessage: (handler: (msg: unknown) => void): (() => void) => {
                capturedOnMessage = handler;
                return (): void => {};
            },
            onDisconnected: (): (() => void) => (): void => {},
        } as unknown as ServerConnection;
        return { stubConn, emit: (msg) => capturedOnMessage(msg) };
    }

    it('replays a snapshot routed before any subscriber to the first onSnapshotReceived subscriber', () => {
        // Reconnect resync: the host answers a mid-match rejoin with a snapshot
        // that can arrive before LobbyManager wires onSnapshotReceived. Nothing
        // re-sends it (action-driven games have no ticker), so dropping it here
        // strands the rejoined client without a match state.
        const { stubConn, emit } = makeCapturingStub();
        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        const snapshot = makeSnapshot(toPlayerId('p1'));
        const checksum = crc32Json(snapshot);

        emit({ type: 'SNAPSHOT', snapshot, checksum });

        const received: { snapshot: PlayerSnapshot; checksum: number }[] = [];
        transport.onSnapshotReceived((s, c) => received.push({ snapshot: s, checksum: c }));

        expect(received).toEqual([{ snapshot, checksum }]);
    });

    it('consumes the latch — a second subscriber gets no replay', () => {
        const { stubConn, emit } = makeCapturingStub();
        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        const snapshot = makeSnapshot(toPlayerId('p1'));

        emit({ type: 'SNAPSHOT', snapshot, checksum: crc32Json(snapshot) });
        transport.onSnapshotReceived(() => {});

        const late: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => late.push(s));

        expect(late).toEqual([]);
    });

    it('latches only the newest snapshot when several arrive before a subscriber', () => {
        const { stubConn, emit } = makeCapturingStub();
        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        const older = makeSnapshot(toPlayerId('p1'));
        const newer = { ...makeSnapshot(toPlayerId('p1')), tick: 11 };

        emit({ type: 'SNAPSHOT', snapshot: older, checksum: crc32Json(older) });
        emit({ type: 'SNAPSHOT', snapshot: newer, checksum: crc32Json(newer) });

        const received: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => received.push(s));

        expect(received).toEqual([newer]);
    });

    it('does not latch when a subscriber already exists', () => {
        const { stubConn, emit } = makeCapturingStub();
        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        const snapshot = makeSnapshot(toPlayerId('p1'));

        const first: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => first.push(s));
        emit({ type: 'SNAPSHOT', snapshot, checksum: crc32Json(snapshot) });

        const late: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => late.push(s));

        expect(first).toEqual([snapshot]);
        expect(late).toEqual([]);
    });

    it('dispose clears an unconsumed latched snapshot', () => {
        const { stubConn, emit } = makeCapturingStub();
        const transport = new WsClientTransport(stubConn, toPlayerId('p1'));
        const snapshot = makeSnapshot(toPlayerId('p1'));

        emit({ type: 'SNAPSHOT', snapshot, checksum: crc32Json(snapshot) });
        transport.dispose();

        const received: PlayerSnapshot[] = [];
        transport.onSnapshotReceived((s) => received.push(s));

        expect(received).toEqual([]);
    });
});

// ─── SNAPSHOT_DELTA ───────────────────────────────────────────────────────────

describe('WsClientTransport — SNAPSHOT_DELTA', () => {
    /** Collect every snapshot and checksum the transport hands its subscriber. */
    const collect = (
        transport: ClientTransport,
    ): { snapshots: PlayerSnapshot[]; checksums: number[] } => {
        const snapshots: PlayerSnapshot[] = [];
        const checksums: number[] = [];
        transport.onSnapshotReceived((snapshot, checksum) => {
            snapshots.push(snapshot);
            checksums.push(checksum);
        });
        return { snapshots, checksums };
    };

    /** Resolves once `count` snapshots have landed on `snapshots`. */
    const waitForCount = async (snapshots: readonly unknown[], count: number): Promise<void> => {
        await vi.waitFor(() => {
            expect(snapshots.length).toBeGreaterThanOrEqual(count);
        });
    };

    const advance = (from: PlayerSnapshot, tick: number): SnapshotDelta => ({
        fromTick: from.tick,
        toTick: tick,
        entries: [
            { path: 'tick', kind: 'changed', after: tick },
            { path: 'isMyTurn', kind: 'changed', after: !from.isMyTurn },
        ],
    });

    it('hands its subscriber the whole snapshot the delta produces', async () => {
        // `ClientTransport.onSnapshotReceived` promises a whole projection, so
        // the reconstruction lives here rather than above the transport: no
        // consumer of the contract learns that a delta was on the wire.
        const { hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);

        const baseline = makeSnapshot(playerId);
        hostTransport.sendSnapshot(playerId, baseline);
        await waitForCount(snapshots, 1);
        hostTransport.sendSnapshotDelta(playerId, advance(baseline, 11));
        await waitForCount(snapshots, 2);

        expect(snapshots[1]).toEqual({ ...baseline, tick: 11, isMyTurn: false });
    });

    it('passes the frame checksum through rather than measuring the rebuild', async () => {
        // Measuring would not give the host's number: `ServerMessageSchema`
        // rebuilds a parsed snapshot in the SCHEMA's key order, so the baseline
        // here — and every rebuild from it — is keyed differently from the host
        // projector's object, and `crc32Json` is order-sensitive. The frame's
        // own checksum is what the host stamped, over the delta it sent.
        const { hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots, checksums } = collect(transport);

        const baseline = makeSnapshot(playerId);
        hostTransport.sendSnapshot(playerId, baseline);
        await waitForCount(snapshots, 1);
        const delta = advance(baseline, 11);
        hostTransport.sendSnapshotDelta(playerId, delta);
        await waitForCount(snapshots, 2);

        expect(checksums[1]).toBe(crc32Json(delta));
        expect(checksums[1]).not.toBe(crc32Json(snapshots[1]));
    });

    it('chains deltas: the second applies to what the first produced', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);

        const baseline = makeSnapshot(playerId);
        hostTransport.sendSnapshot(playerId, baseline);
        await waitForCount(snapshots, 1);
        hostTransport.sendSnapshotDelta(playerId, advance(baseline, 11));
        await waitForCount(snapshots, 2);
        hostTransport.sendSnapshotDelta(playerId, {
            fromTick: 11,
            toTick: 12,
            entries: [{ path: 'tick', kind: 'changed', after: 12 }],
        });
        await waitForCount(snapshots, 3);

        expect(snapshots[2]?.tick).toBe(12);
    });

    it('asks the host for a full re-sync when a delta arrives with no baseline', async () => {
        const { server, hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);

        const resync = waitForServerInboundMessage(
            server,
            (_from, msg) => msg.type === 'ACTION' && msg.action.type === 'engine:sync_request',
        );
        hostTransport.sendSnapshotDelta(playerId, advance(makeSnapshot(playerId), 11));

        expect((await resync).from).toBe(playerId);
        // Nothing partial reached the subscriber while that was in flight.
        expect(snapshots).toEqual([]);
    });

    it('asks for a full re-sync when the delta will not apply, and delivers nothing', async () => {
        const { server, hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);

        const baseline = makeSnapshot(playerId);
        hostTransport.sendSnapshot(playerId, baseline);
        await waitForCount(snapshots, 1);

        const resync = waitForServerInboundMessage(
            server,
            (_from, msg) => msg.type === 'ACTION' && msg.action.type === 'engine:sync_request',
        );
        // A baseline tick that is not the held one — the common desync.
        hostTransport.sendSnapshotDelta(playerId, {
            fromTick: 99,
            toTick: 100,
            entries: [{ path: 'tick', kind: 'changed', after: 100 }],
        });

        await resync;
        expect(snapshots).toHaveLength(1);
    });

    it('asks only once while a re-sync is outstanding', async () => {
        // A broken chain would otherwise ask on EVERY beat, and each request
        // makes the host broadcast a full snapshot to every viewer, not just to
        // the asker — so an unlatched request turns one client's desync into a
        // host-wide cost.
        const { server, hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);
        const requests: ClientMessage[] = [];
        server.onMessage((_from, msg) => {
            if (msg.type === 'ACTION' && msg.action.type === 'engine:sync_request') {
                requests.push(msg);
            }
        });

        const stale = (tick: number): SnapshotDelta => ({
            fromTick: 99,
            toTick: tick,
            entries: [{ path: 'tick', kind: 'changed', after: tick }],
        });
        hostTransport.sendSnapshotDelta(playerId, stale(100));
        hostTransport.sendSnapshotDelta(playerId, stale(101));
        hostTransport.sendSnapshotDelta(playerId, stale(102));
        // A frame the client DOES publish, sent last. The socket is ordered, so
        // observing it proves all three refusals were routed first — where a
        // fixed sleep would only prove the clock advanced, and on a slow runner
        // would assert "asked once" without the later two having arrived at all.
        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await waitForCount(snapshots, 1);

        expect(requests).toHaveLength(1);
    });

    it('asks again after a keyframe answered the previous request', async () => {
        const { server, hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);
        const requests: ClientMessage[] = [];
        server.onMessage((_from, msg) => {
            if (msg.type === 'ACTION' && msg.action.type === 'engine:sync_request') {
                requests.push(msg);
            }
        });

        const stale = (tick: number): SnapshotDelta => ({
            fromTick: 99,
            toTick: tick,
            entries: [{ path: 'tick', kind: 'changed', after: tick }],
        });
        hostTransport.sendSnapshotDelta(playerId, stale(100));
        await vi.waitFor(() => {
            expect(requests).toHaveLength(1);
        });

        // The keyframe the host answers with clears the latch AND re-baselines.
        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await waitForCount(snapshots, 1);

        hostTransport.sendSnapshotDelta(playerId, stale(200));
        await vi.waitFor(() => {
            expect(requests).toHaveLength(2);
        });
    });

    it('re-baselines on a keyframe, so the next delta applies to it', async () => {
        const { hostTransport, playerId, transport } = await makeClientTransport();
        const { snapshots } = collect(transport);

        hostTransport.sendSnapshot(playerId, makeSnapshot(playerId));
        await waitForCount(snapshots, 1);
        const keyframe = { ...makeSnapshot(playerId), tick: 50 };
        hostTransport.sendSnapshot(playerId, keyframe);
        await waitForCount(snapshots, 2);
        hostTransport.sendSnapshotDelta(playerId, advance(keyframe, 51));
        await waitForCount(snapshots, 3);

        expect(snapshots[2]?.tick).toBe(51);
    });

    it('replays the reconstruction to a subscriber that arrives after it, exactly once', async () => {
        // The latch covers the reconnect re-sync, where the host's answer can
        // land before `LobbyManager` wires its listener. A delta beat has to
        // latch the snapshot it PRODUCES, not the delta.
        const { conn, hostTransport, playerId, transport } = await makeClientTransport();

        const baseline = makeSnapshot(playerId);
        hostTransport.sendSnapshot(playerId, baseline);
        hostTransport.sendSnapshotDelta(playerId, advance(baseline, 11));
        // Waited on the frame itself rather than on a sleep: the transport
        // subscribed to the connection in its constructor, so by the time this
        // resolves the delta has already been routed and latched. A sleep would
        // only prove the clock advanced.
        await waitForConnectionMessage(conn, (msg) => msg.type === 'SNAPSHOT_DELTA');

        const { snapshots } = collect(transport);
        await waitForCount(snapshots, 1);
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.tick).toBe(11);
    });
});
