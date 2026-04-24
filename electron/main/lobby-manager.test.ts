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
    HostTransport,
    JoinLobbyParams,
    MultiplayerProvider,
    PlayerId,
    Unsubscribe,
} from '../../networking/provider/MultiplayerProvider.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };

function makeProvider(): InMemoryMultiplayerProvider {
    return new InMemoryMultiplayerProvider();
}

function makeManager(provider: InMemoryMultiplayerProvider = makeProvider()): LobbyManager {
    return new LobbyManager(provider, createNoopLogger());
}

/**
 * A minimal MultiplayerProvider wrapper that counts active host-transport
 * subscriptions. Used to verify that closeLobby() invokes all Unsubscribes.
 */
function makeTrackingProvider(inner: InMemoryMultiplayerProvider = makeProvider()): {
    provider: MultiplayerProvider;
    activeHostSubs: () => number;
    activeClientSubs: () => number;
} {
    function wrapUnsub(unsub: Unsubscribe, counter: { count: number }): Unsubscribe {
        counter.count += 1;
        return (): void => {
            counter.count -= 1;
            unsub();
        };
    }

    const hostCounter = { count: 0 };
    const clientCounter = { count: 0 };

    const provider: MultiplayerProvider = {
        async hostLobby(params) {
            const session = await inner.hostLobby(params);
            const origTransport = session.transport;
            const wrappedTransport: HostTransport = {
                ...origTransport,
                onActionReceived: (cb) =>
                    wrapUnsub(origTransport.onActionReceived(cb), hostCounter),
                onSideChannelReceived: (cb) =>
                    wrapUnsub(origTransport.onSideChannelReceived(cb), hostCounter),
                onPlayerJoined: (cb) => wrapUnsub(origTransport.onPlayerJoined(cb), hostCounter),
                onPlayerLeft: (cb) => wrapUnsub(origTransport.onPlayerLeft(cb), hostCounter),
            };
            return { ...session, transport: wrappedTransport };
        },
        async joinLobby(params) {
            const session = await inner.joinLobby(params);
            const origTransport = session.transport;
            return {
                ...session,
                transport: {
                    ...origTransport,
                    onSnapshotReceived: (cb) =>
                        wrapUnsub(origTransport.onSnapshotReceived(cb), clientCounter),
                    onSideChannelReceived: (cb) =>
                        wrapUnsub(origTransport.onSideChannelReceived(cb), clientCounter),
                    onLobbyStateChanged: (cb) =>
                        wrapUnsub(origTransport.onLobbyStateChanged(cb), clientCounter),
                    onDisconnected: (cb) =>
                        wrapUnsub(origTransport.onDisconnected(cb), clientCounter),
                },
            };
        },
        dispose() {
            inner.dispose();
        },
    };

    return {
        provider,
        activeHostSubs: () => hostCounter.count,
        activeClientSubs: () => clientCounter.count,
    };
}

// ── hostLobby ─────────────────────────────────────────────────────────────────

describe('LobbyManager.hostLobby', () => {
    it('returns a LobbyInfo with sessionId and gameId', async () => {
        const manager = makeManager();
        const info = await manager.hostLobby(HOST_PARAMS);
        expect(info.sessionId).toBeTruthy();
        expect(info.gameId).toBe('tactics');
    });

    it('returns a provider-assigned hostId (not the hardcoded "host" literal)', async () => {
        const manager = makeManager();
        const info = await manager.hostLobby(HOST_PARAMS);
        expect(info.hostId).toBeTruthy();
        expect(info.hostId).not.toBe('host');
    });

    it('returns distinct hostIds for separate hosted sessions', async () => {
        const provider = makeProvider();
        const manager1 = new LobbyManager(provider, createNoopLogger());
        const info1 = await manager1.hostLobby(HOST_PARAMS);
        await manager1.closeLobby();
        const manager2 = new LobbyManager(provider, createNoopLogger());
        const info2 = await manager2.hostLobby(HOST_PARAMS);
        expect(info1.hostId).not.toBe(info2.hostId);
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

    it('throws when a session is already active', async () => {
        const manager = makeManager();
        await manager.hostLobby(HOST_PARAMS);
        await expect(manager.hostLobby(HOST_PARAMS)).rejects.toThrow(/session already active/i);
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

    it('throws when a session is already active', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });
        // A second join on the same manager should reject
        await expect(joinManager.joinLobby({ address: hostInfo.sessionId })).rejects.toThrow(
            /session already active/i,
        );
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

    it('unsubscribes all host transport subscriptions on close', async () => {
        const inner = makeProvider();
        const { provider, activeHostSubs } = makeTrackingProvider(inner);
        const manager = new LobbyManager(provider, createNoopLogger());
        await manager.hostLobby(HOST_PARAMS);
        // LobbyManager wires 4 host callbacks: onActionReceived, onPlayerJoined,
        // onPlayerLeft, onSideChannelReceived (the latter may be absent if not wired — 3+ minimum)
        expect(activeHostSubs()).toBeGreaterThan(0);
        await manager.closeLobby();
        expect(activeHostSubs()).toBe(0);
    });

    it('unsubscribes all client transport subscriptions on close', async () => {
        const inner = makeProvider();
        const { provider, activeClientSubs } = makeTrackingProvider(inner);
        const hostInfo = await inner.hostLobby(HOST_PARAMS);

        const joinManager = new LobbyManager(provider, createNoopLogger());
        await joinManager.joinLobby({ address: hostInfo.lobbyCode });
        expect(activeClientSubs()).toBeGreaterThan(0);
        await joinManager.closeLobby();
        expect(activeClientSubs()).toBe(0);
    });

    it('re-hosting after close starts with zero subscriptions from the previous session', async () => {
        const inner = makeProvider();
        const { provider, activeHostSubs } = makeTrackingProvider(inner);
        const manager = new LobbyManager(provider, createNoopLogger());

        await manager.hostLobby(HOST_PARAMS);
        const afterFirst = activeHostSubs();
        await manager.closeLobby();
        expect(activeHostSubs()).toBe(0);

        await manager.hostLobby(HOST_PARAMS);
        // Second hosting should have same subscription count as the first
        expect(activeHostSubs()).toBe(afterFirst);
        await manager.closeLobby();
        expect(activeHostSubs()).toBe(0);
    });
});

// ── Provider-swap smoke test ──────────────────────────────────────────────────
//
// Proves LobbyManager is provider-agnostic: swapping LocalWebSocketProvider
// for InMemoryMultiplayerProvider requires zero changes to LobbyManager.
// (Invariant #2 — networking/provider/local/ must not appear in this file)

describe('LobbyManager provider-swap smoke test', () => {
    it('host receives action sent by client via transport callbacks', async () => {
        const provider = makeProvider();

        // Capture the HostTransport via the onSessionHosted callback
        let receivedAction: unknown = null;
        const hostManager = new LobbyManager(provider, createNoopLogger(), (transport) => {
            transport.onActionReceived((_from, action) => {
                receivedAction = action;
            });
        });

        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        // Join with a second manager via the same provider instance
        const joinManager = makeManager(provider);
        const joinInfo = await joinManager.joinLobby({ address: hostInfo.sessionId });
        expect(joinInfo.sessionId).toBe(hostInfo.sessionId);

        // Client sends an action — host transport should deliver it
        const clientSession = await provider.joinLobby({ address: hostInfo.sessionId });
        const testAction = { type: 'SMOKE_TEST' as const };
        clientSession.transport.sendAction(testAction as never);

        // Allow microtask queue to flush
        await Promise.resolve();

        expect(receivedAction).toEqual(testAction);

        // Teardown
        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('client receives snapshot sent by host via transport callbacks', async () => {
        const provider = makeProvider();

        let capturedTransport: HostTransport | null = null;
        let capturedClientId: PlayerId | null = null;
        const hostManager = new LobbyManager(provider, createNoopLogger(), (transport) => {
            capturedTransport = transport;
            transport.onPlayerJoined((player) => {
                capturedClientId = player.playerId;
            });
        });

        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        // Join via raw provider so we can register our own snapshot callback
        const clientSession = await provider.joinLobby({ address: hostInfo.sessionId });

        let receivedSnapshot: unknown = null;
        clientSession.transport.onSnapshotReceived((snapshot) => {
            receivedSnapshot = snapshot;
        });

        // Allow microtask queue (onPlayerJoined fires via queueMicrotask)
        await Promise.resolve();

        // Host sends a snapshot to the joined client
        expect(capturedClientId).not.toBeNull();
        expect(capturedTransport).not.toBeNull();
        const testSnapshot = { tick: 1 } as never;
        // capturedTransport is set synchronously by the onSessionHosted callback
        capturedTransport!.sendSnapshot(capturedClientId!, testSnapshot);

        expect(receivedSnapshot).toEqual(testSnapshot);

        // Teardown
        await clientSession.disconnect();
        await hostManager.closeLobby();
    });

    it('both managers close without errors after host-join flow (full lifecycle)', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        await expect(joinManager.closeLobby()).resolves.toBeUndefined();
        await expect(hostManager.closeLobby()).resolves.toBeUndefined();
    });
});
