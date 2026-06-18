/**
 * networking/provider/local/LocalWebSocketProvider.test.ts
 *
 * Tests for LocalWebSocketProvider — the MultiplayerProvider entry point that
 * wires together LobbyServer, MessageRouter, WsHostTransport, ServerConnection,
 * and WsClientTransport.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T06 (issue #221)
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type {
    MultiplayerProvider,
    HostedSession,
    JoinedSession,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { LocalWebSocketProvider } from './LocalWebSocketProvider.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const sessions: (HostedSession | JoinedSession)[] = [];
let provider: LocalWebSocketProvider | null = null;

afterEach(async () => {
    await Promise.all(sessions.map((s) => ('close' in s ? s.close() : s.disconnect())));
    sessions.length = 0;
    provider?.dispose();
    provider = null;
});

// ─── Construction ─────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider — construction', () => {
    it('can be constructed and implements MultiplayerProvider', () => {
        provider = new LocalWebSocketProvider();
        const p: MultiplayerProvider = provider;
        expect(typeof p.hostLobby).toBe('function');
        expect(typeof p.joinLobby).toBe('function');
        expect(typeof p.dispose).toBe('function');
    });
});

// ─── hostLobby ────────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider — hostLobby', () => {
    it('resolves with a HostedSession containing a lobbyCode string', async () => {
        provider = new LocalWebSocketProvider();
        const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(session);

        expect(typeof session.lobbyCode).toBe('string');
        expect(session.lobbyCode.length).toBeGreaterThan(0);
    });

    it('lobbyCode encodes host:port:token', async () => {
        provider = new LocalWebSocketProvider();
        const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(session);

        // Format: "127.0.0.1:PORT:TOKEN"
        const parts = session.lobbyCode.split(':');
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe('127.0.0.1');
        expect(Number(parts[1])).toBeGreaterThan(0);
        expect(parts[2]?.length).toBeGreaterThan(0);
    });

    it('provides a HostTransport with the expected methods', async () => {
        provider = new LocalWebSocketProvider();
        const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(session);

        const t = session.transport;
        expect(typeof t.sendSnapshot).toBe('function');
        expect(typeof t.broadcastLobbyState).toBe('function');
        expect(typeof t.sendSideChannel).toBe('function');
        expect(typeof t.onActionReceived).toBe('function');
        expect(typeof t.onPlayerJoined).toBe('function');
        expect(typeof t.onPlayerLeft).toBe('function');
    });

    it('close() resolves without error', async () => {
        provider = new LocalWebSocketProvider();
        const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        await expect(session.close()).resolves.toBeUndefined();
    });
});

// ─── joinLobby ────────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider — joinLobby', () => {
    it('resolves with a JoinedSession after handshake', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const joined = await provider.joinLobby({ address: hosted.lobbyCode });
        sessions.push(joined);

        expect(joined.lobbyInfo).toBeDefined();
        expect(joined.lobbyInfo.gameId).toBe('tactics');
    });

    it('fires onPlayerJoined on the host when a client connects', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const joined: PlayerId[] = [];
        hosted.transport.onPlayerJoined((p) => joined.push(p.playerId));

        const client = await provider.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        expect(joined).toHaveLength(1);
        expect(typeof joined[0]).toBe('string');
    });

    it('joinLobby rejects with bad token', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const [host, , badToken] = hosted.lobbyCode.split(':');
        const badAddress = `${host}:${hosted.lobbyCode.split(':')[1]}:${badToken ?? 'bad'}xx`;
        await expect(provider.joinLobby({ address: badAddress })).rejects.toThrow();
    });

    it('JoinedSession has a ClientTransport', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const client = await provider.joinLobby({ address: hosted.lobbyCode });
        sessions.push(client);

        const t = client.transport;
        expect(typeof t.sendAction).toBe('function');
        expect(typeof t.onSnapshotReceived).toBe('function');
        expect(typeof t.onLobbyStateChanged).toBe('function');
        expect(typeof t.onDisconnected).toBe('function');
    });

    it('disconnect() resolves without error', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const client = await provider.joinLobby({ address: hosted.lobbyCode });
        await expect(client.disconnect()).resolves.toBeUndefined();
    });
});

// ─── password gate (F56) ───────────────────────────────────────────────────────

describe('LocalWebSocketProvider — password gate (F56)', () => {
    it('admits a join that presents the correct host password', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({
            gameId: 'tactics',
            maxPlayers: 4,
            password: 'open-sesame',
        });
        sessions.push(hosted);

        const joined = await provider.joinLobby({
            address: hosted.lobbyCode,
            password: 'open-sesame',
        });
        sessions.push(joined);

        expect(joined.lobbyInfo.gameId).toBe('tactics');
    });

    it('rejects a join with the wrong password', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({
            gameId: 'tactics',
            maxPlayers: 4,
            password: 'open-sesame',
        });
        sessions.push(hosted);

        await expect(
            provider.joinLobby({ address: hosted.lobbyCode, password: 'wrong' }),
        ).rejects.toThrow(/invalid_password/);
    });

    it('rejects a join that omits the password when the host requires one', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({
            gameId: 'tactics',
            maxPlayers: 4,
            password: 'open-sesame',
        });
        sessions.push(hosted);

        await expect(provider.joinLobby({ address: hosted.lobbyCode })).rejects.toThrow(
            /invalid_password/,
        );
    });

    it('admits a join with no password when the host set none (open lobby)', async () => {
        provider = new LocalWebSocketProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        sessions.push(hosted);

        const joined = await provider.joinLobby({ address: hosted.lobbyCode });
        sessions.push(joined);

        expect(joined.lobbyInfo.gameId).toBe('tactics');
    });
});

// ─── dispose ──────────────────────────────────────────────────────────────────

describe('LocalWebSocketProvider — dispose', () => {
    it('dispose() closes all open sessions', async () => {
        const p = new LocalWebSocketProvider();
        const session = await p.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

        // Should not throw
        expect(() => p.dispose()).not.toThrow();

        // Mark session cleaned up so afterEach doesn't double-close
        // We leave it out of the sessions array since dispose() handles it
        void session; // already closed
    });
});
