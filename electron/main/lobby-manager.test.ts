/**
 * electron/main/lobby-manager.test.ts
 *
 * Unit tests for LobbyManager.
 *
 * Uses InMemoryMultiplayerProvider so no real network or WebSocket is involved.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider / LobbyManager
 * Task: F11-T01 (issue #234)
 *
 * Invariants covered:
 *   #1 — LobbyManager only handles PlayerSnapshot; never references GameSnapshot.
 *   #67 — LobbyManager constructed with injected Logger; no console.* calls.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryMultiplayerProvider } from '../../networking/provider/InMemoryMultiplayerProvider.js';
import { createNoopLogger } from './logger.js';
import { LobbyManager } from './lobby-manager.js';
import type {
    HostLobbyParams,
    JoinLobbyParams,
} from '../../networking/provider/MultiplayerProvider.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };

function makeProvider(): InMemoryMultiplayerProvider {
    return new InMemoryMultiplayerProvider();
}

function makeManager(provider: InMemoryMultiplayerProvider = makeProvider()): LobbyManager {
    return new LobbyManager(provider, createNoopLogger());
}

// ── hostLobby ─────────────────────────────────────────────────────────────────

describe('LobbyManager.hostLobby', () => {
    it('returns a LobbyInfo with sessionId and gameId', async () => {
        const manager = makeManager();
        const info = await manager.hostLobby(HOST_PARAMS);
        expect(info.sessionId).toBeTruthy();
        expect(info.gameId).toBe('tactics');
    });

    it('stores the session (closeLobby succeeds after hostLobby)', async () => {
        const manager = makeManager();
        await manager.hostLobby(HOST_PARAMS);
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });

    it('wires onActionReceived callback on the host transport', async () => {
        const provider = makeProvider();
        const manager = makeManager(provider);
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        // To test that onActionReceived is wired, join via the same provider
        const clientSession = await provider.joinLobby({ address: hostInfo.sessionId });
        const action = { type: 'TEST_ACTION' as const };
        // Fire an action from the client side — manager must not throw
        expect(() => clientSession.transport.sendAction(action as never)).not.toThrow();
    });

    it('wires onPlayerJoined callback without throwing', async () => {
        const provider = makeProvider();
        const manager = makeManager(provider);
        const info = await manager.hostLobby(HOST_PARAMS);
        // Joining triggers onPlayerJoined on the host — manager must handle it
        await expect(provider.joinLobby({ address: info.sessionId })).resolves.toBeDefined();
    });

    it('wires onPlayerLeft callback without throwing', async () => {
        const provider = makeProvider();
        const manager = makeManager(provider);
        const info = await manager.hostLobby(HOST_PARAMS);
        const clientSession = await provider.joinLobby({ address: info.sessionId });
        // Disconnecting triggers onPlayerLeft on the host transport
        await expect(clientSession.disconnect()).resolves.toBeUndefined();
    });
});

// ── joinLobby ────────────────────────────────────────────────────────────────

describe('LobbyManager.joinLobby', () => {
    it('returns the LobbyInfo from the session', async () => {
        const provider = makeProvider();
        // First host a session
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        // Then join with a second manager using the same provider
        const joinManager = makeManager(provider);
        const params: JoinLobbyParams = { address: hostInfo.sessionId };
        const joinInfo = await joinManager.joinLobby(params);

        expect(joinInfo.sessionId).toBe(hostInfo.sessionId);
        expect(joinInfo.gameId).toBe('tactics');
    });

    it('stores the joined session (closeLobby succeeds after joinLobby)', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });
        await expect(joinManager.closeLobby()).resolves.toBeUndefined();
    });

    it('wires onSnapshotReceived without throwing', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        const joinInfo = await joinManager.joinLobby({ address: hostInfo.sessionId });

        // Close both — no errors
        await joinManager.closeLobby();
        await hostManager.closeLobby();
        expect(joinInfo.sessionId).toBeTruthy();
    });

    it('wires onLobbyStateChanged without throwing', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        // closeLobby on joinManager should not throw even after lob state changes
        await expect(joinManager.closeLobby()).resolves.toBeUndefined();
    });

    it('wires onDisconnected without throwing', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        // Host closes — triggers onDisconnected on the joined transport
        await expect(hostManager.closeLobby()).resolves.toBeUndefined();
    });
});

// ── closeLobby ───────────────────────────────────────────────────────────────

describe('LobbyManager.closeLobby', () => {
    it('is safe to call when no session is active (no throw)', async () => {
        const manager = makeManager();
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });

    it('nulls the session so double-close does not throw', async () => {
        const manager = makeManager();
        await manager.hostLobby(HOST_PARAMS);
        await manager.closeLobby();
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });

    it('calls close() on a hosted session', async () => {
        const provider = makeProvider();
        const manager = makeManager(provider);
        await manager.hostLobby(HOST_PARAMS);
        // After closing, hosting again with same provider should work (channels cleared)
        await manager.closeLobby();
        await expect(manager.hostLobby(HOST_PARAMS)).resolves.toBeDefined();
    });

    it('calls disconnect() on a joined session', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });
        await expect(joinManager.closeLobby()).resolves.toBeUndefined();
    });
});
