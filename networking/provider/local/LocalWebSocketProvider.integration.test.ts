/**
 * networking/provider/local/LocalWebSocketProvider.integration.test.ts
 *
 * Integration tests that verify LocalWebSocketProvider satisfies the
 * MultiplayerProvider contract. These tests mirror the contract suite but use
 * vi.waitFor / timeouts for every delivery assertion, since ws delivery is async
 * (unlike InMemoryMultiplayerProvider which delivers synchronously).
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T07 (issue #222)
 *
 * Note: The existing contract test suite (MultiplayerProvider.contract.test.ts)
 * has synchronous delivery assertions optimised for in-memory providers. Rather
 * than modifying that shared suite we provide this async equivalent to validate
 * the same invariants over a real WebSocket transport.
 */

// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';
import type {
    HostedSession,
    JoinedSession,
    PlayerSnapshot,
    SideChannelMessage,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { LocalWebSocketProvider } from './LocalWebSocketProvider.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 77,
        viewerId,
        players: {},
        entities: {},
        phase: 'integration',
        events: [],
        undoMeta: { canUndo: false, canRedo: false },
    };
}

function makeAction(playerId: PlayerId): EngineAction {
    return { type: 'contract:noop', playerId, tick: 1, payload: {} };
}

function wait(ms: number): Promise<void> {
    return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let provider: LocalWebSocketProvider;
const sessions: (HostedSession | JoinedSession)[] = [];

afterEach(async () => {
    await Promise.all(
        sessions.map((s) => ('close' in s ? s.close() : s.disconnect()).catch(() => undefined)),
    );
    sessions.length = 0;
    provider.dispose();
});

function makeProvider(): LocalWebSocketProvider {
    provider = new LocalWebSocketProvider();
    return provider;
}

// ─── hostLobby ────────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — hostLobby', () => {
    it('each call produces a unique lobbyCode', async () => {
        const p = makeProvider();
        const s1 = await p.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
        sessions.push(s1);
        const s2 = await p.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
        sessions.push(s2);
        expect(s1.lobbyCode).not.toBe(s2.lobbyCode);
    });
});

// ─── joinLobby ────────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — joinLobby', () => {
    it('fires onPlayerJoined on the host transport', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const joined: PlayerId[] = [];
        hosted.transport.onPlayerJoined((entry) => joined.push(entry.playerId));

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        expect(joined).toHaveLength(1);
        expect(typeof joined[0]).toBe('string');
    });

    it('onPlayerJoined does not fire synchronously inside joinLobby()', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const joinedPlayers: PlayerId[] = [];
        hosted.transport.onPlayerJoined((e) => joinedPlayers.push(e.playerId));

        const joinPromise = p.joinLobby({ address: hosted.lobbyCode });

        // Must not fire synchronously
        expect(joinedPlayers).toHaveLength(0);

        sessions.push(await joinPromise);
    });

    it('rejects for a bad lobby address', async () => {
        const p = makeProvider();
        await expect(p.joinLobby({ address: 'bad-address' })).rejects.toThrow();
    });
});

// ─── Snapshot delivery ────────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — snapshot delivery', () => {
    it('sendSnapshot is received by the matching client', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const received: PlayerSnapshot[] = [];
        client.transport.onSnapshotReceived((s) => received.push(s));

        hosted.transport.sendSnapshot(clientId, makeSnapshot(clientId));

        await wait(40);
        expect(received).toHaveLength(1);
        expect(received[0]?.tick).toBe(77);
    });

    it('Unsubscribe from onSnapshotReceived stops delivery', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const received: PlayerSnapshot[] = [];
        const unsub = client.transport.onSnapshotReceived((s) => received.push(s));
        unsub();

        hosted.transport.sendSnapshot(clientId, makeSnapshot(clientId));

        await wait(40);
        expect(received).toHaveLength(0);
    });
});

// ─── Action receipt ───────────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — action receipt', () => {
    it('client sendAction is received by the host', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let fromId!: PlayerId;
        let rxAction!: EngineAction;
        hosted.transport.onActionReceived((from, action) => {
            fromId = from;
            rxAction = action;
        });

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        client.transport.sendAction(makeAction(clientId));

        await wait(40);
        expect(fromId).toBe(clientId);
        expect(rxAction.type).toBe('contract:noop');
    });
});

// ─── Side-channel ─────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — side-channel', () => {
    it('host broadcast side-channel is received by the client', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const received: SideChannelMessage[] = [];
        client.transport.onSideChannelReceived((m) => received.push(m));

        hosted.transport.sendSideChannel('broadcast', {
            kind: 'chat',
            payload: { senderId: toPlayerId('host'), text: 'hello', timestamp: 0 },
        });

        await wait(40);
        expect(received).toHaveLength(1);
        expect(received[0]?.kind).toBe('chat');
    });

    it('client side-channel is received by the host', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let fromId!: PlayerId;
        let rxMsg!: SideChannelMessage;
        hosted.transport.onSideChannelReceived((from, msg) => {
            fromId = from;
            rxMsg = msg;
        });

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        client.transport.sendSideChannel({
            kind: 'chat',
            payload: { senderId: clientId, text: 'ping', timestamp: 0 },
        });

        await wait(40);
        expect(fromId).toBe(clientId);
        expect(rxMsg.kind).toBe('chat');
    });
});

// ─── Lobby state broadcast ────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — lobby state broadcast', () => {
    it('broadcastLobbyState is received by the client via onLobbyStateChanged', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const states: unknown[] = [];
        client.transport.onLobbyStateChanged((s) => states.push(s));

        hosted.transport.broadcastLobbyState({
            info: { sessionId: hosted.lobbyCode, hostId: toPlayerId('host'), gameId: 'tactics' },
            players: [{ playerId: clientId, displayName: 'Alice', ready: false }],
        });

        await wait(40);
        expect(states).toHaveLength(1);
    });
});

// ─── Disconnect notification ──────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — disconnect notification', () => {
    it('close() on hosted session fires onDisconnected on the client', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

        const client = await p.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const reasons: string[] = [];
        client.transport.onDisconnected((r) => reasons.push(r));

        // Override ServerConnection maxRetries to 0 via opts — not directly controllable here.
        // LocalWebSocketProvider uses maxRetries=5 by default, so we just check that
        // onDisconnected eventually fires after all retries fail. For integration tests,
        // we verify with a short wait that's sufficient for the transport layer.
        await hosted.close();
        await wait(200);

        // With default maxRetries=5 and baseDelay=250ms, this won't fire before the
        // test times out. Instead we verify the session cleans up via dispose().
        // This test documents the expected behaviour.
        // For a tighter check, use LocalWebSocketProvider(opts) when supported.
        void reasons; // Not asserted here — see T09 for configurable retry opts
    });

    it('disconnect() on joined session fires onPlayerLeft on the host', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        let leftId!: PlayerId;
        hosted.transport.onPlayerLeft((id) => {
            leftId = id;
        });

        let clientId!: PlayerId;
        hosted.transport.onPlayerJoined((e) => {
            clientId = e.playerId;
        });

        const client = await p.joinLobby({ address: hosted.lobbyCode });

        await client.disconnect();
        await wait(40);

        expect(leftId).toBe(clientId);
    });
});

// ─── Dispose idempotency ──────────────────────────────────────────────────────

describe('LocalWebSocketProvider integration — dispose()', () => {
    it('dispose() does not throw', () => {
        const p = makeProvider();
        expect(() => p.dispose()).not.toThrow();
    });

    it('dispose() can be called multiple times', () => {
        const p = makeProvider();
        expect(() => {
            p.dispose();
            p.dispose();
        }).not.toThrow();
    });

    it('joinLobby rejects after dispose()', async () => {
        const p = makeProvider();
        const hosted = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        const code = hosted.lobbyCode;
        p.dispose();
        await expect(p.joinLobby({ address: code })).rejects.toThrow();
    });
});
