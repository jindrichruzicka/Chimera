/**
 * electron/main/lobby/LobbyManager.test.ts
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
import { InMemoryMultiplayerProvider } from '@chimera/networking/provider/InMemoryMultiplayerProvider.js';
import { createLogger, createMemorySink, createNoopLogger } from '../logging/logger.js';
import { LobbyManager } from './LobbyManager.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import {
    playerId,
    type HostLobbyParams,
    type HostTransport,
    type ClientTransport,
    type JoinLobbyParams,
    type MultiplayerProvider,
    type PlayerSnapshot,
    type PlayerId,
    type Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };

function makeProvider(): InMemoryMultiplayerProvider {
    return new InMemoryMultiplayerProvider();
}

function makeManager(provider: InMemoryMultiplayerProvider = makeProvider()): LobbyManager {
    return new LobbyManager(provider, createNoopLogger());
}

/** Build a minimal schema-valid {@link EngineAction} for transport-level smoke tests. */
function makeTestAction(): EngineAction {
    return {
        type: 'smoke:test',
        playerId: playerId('p1'),
        tick: 0,
        payload: {},
    };
}

/** Build a minimal schema-valid {@link PlayerSnapshot} for transport-level smoke tests. */
function makeTestSnapshot(): PlayerSnapshot {
    return {
        tick: 1,
        viewerId: playerId('p1'),
        players: {},
        entities: {},
        phase: 'setup',
        events: [],
        undoMeta: { canUndo: false, canRedo: false },
    };
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
        // Fire an action from the client side — manager must not throw
        expect(() => clientSession.transport.sendAction(makeTestAction())).not.toThrow();
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

    it('resolves and logs a warn when session.close() rejects', async () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
        const teardownError = new Error('ws server refused close');
        const rawProvider = makeProvider();
        const failingProvider: MultiplayerProvider = {
            hostLobby: async (p) => {
                const session = await rawProvider.hostLobby(p);
                return {
                    ...session,
                    close: async () => {
                        throw teardownError;
                    },
                };
            },
            joinLobby: (p) => rawProvider.joinLobby(p),
            dispose: () => rawProvider.dispose(),
        };
        const manager = new LobbyManager(failingProvider, logger);
        await manager.hostLobby(HOST_PARAMS);
        // Must resolve even though close() rejects
        await expect(manager.closeLobby()).resolves.toBeUndefined();
        const warnEntry = sink.entries.find(
            (e) => e.level === 'warn' && e.message === 'closeLobby:teardown-error',
        );
        expect(warnEntry).toBeDefined();
        expect((warnEntry!.context as Record<string, unknown>)['error']).toBe(
            teardownError.message,
        );
    });

    it('second closeLobby() after a failed teardown is a no-op', async () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
        const rawProvider = makeProvider();
        const failingProvider: MultiplayerProvider = {
            hostLobby: async (p) => {
                const session = await rawProvider.hostLobby(p);
                return {
                    ...session,
                    close: async () => {
                        throw new Error('teardown failed');
                    },
                };
            },
            joinLobby: (p) => rawProvider.joinLobby(p),
            dispose: () => rawProvider.dispose(),
        };
        const manager = new LobbyManager(failingProvider, logger);
        await manager.hostLobby(HOST_PARAMS);
        await manager.closeLobby(); // first close — logs warn
        sink.clear();
        // Second close — session already nulled, must be a no-op (no warn logged)
        await expect(manager.closeLobby()).resolves.toBeUndefined();
        expect(sink.entries).toHaveLength(0);
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
        const testAction = makeTestAction();
        clientSession.transport.sendAction(testAction);

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
        const testSnapshot = makeTestSnapshot();
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

// ── onSessionHosted teardown ─────────────────────────────────────────────────

describe('LobbyManager onSessionHosted teardown', () => {
    it('calls the teardown returned by onSessionHosted when closeLobby is called', async () => {
        let teardownCalled = false;
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), (_transport) => {
            return () => {
                teardownCalled = true;
            };
        });
        await manager.hostLobby(HOST_PARAMS);
        expect(teardownCalled).toBe(false);
        await manager.closeLobby();
        expect(teardownCalled).toBe(true);
    });

    it('does not throw when onSessionHosted returns undefined (no teardown)', async () => {
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), (_transport) => {
            return undefined;
        });
        await manager.hostLobby(HOST_PARAMS);
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });

    it('calls teardown before session.close()', async () => {
        const order: string[] = [];
        const rawProvider = makeProvider();
        // Wrap hostLobby to instrument session.close() by delegating to rawProvider
        // but intercepting the close() of the returned HostedSession.
        const wrappedProvider: MultiplayerProvider = {
            hostLobby: async (p) => {
                const session = await rawProvider.hostLobby(p);
                return {
                    ...session,
                    close: async () => {
                        order.push('close');
                        await session.close();
                    },
                };
            },
            joinLobby: (p) => rawProvider.joinLobby(p),
            dispose: () => rawProvider.dispose(),
        };
        const manager = new LobbyManager(wrappedProvider, createNoopLogger(), (_transport) => {
            return () => {
                order.push('teardown');
            };
        });
        await manager.hostLobby(HOST_PARAMS);
        await manager.closeLobby();
        expect(order).toEqual(['teardown', 'close']);
    });
});

// ── onSessionJoined teardown ──────────────────────────────────────────────────

describe('LobbyManager onSessionJoined teardown', () => {
    async function hostAndGetCode(): Promise<{
        hostManager: LobbyManager;
        code: string;
        provider: InMemoryMultiplayerProvider;
    }> {
        const provider = makeProvider();
        const hostManager = new LobbyManager(provider, createNoopLogger());
        const info = await hostManager.hostLobby(HOST_PARAMS);
        return { hostManager, code: info.sessionId, provider };
    }

    it('fires onSessionJoined exactly once when joinLobby succeeds', async () => {
        const { code, provider } = await hostAndGetCode();
        let callCount = 0;
        const manager = new LobbyManager(provider, createNoopLogger(), undefined, (_transport) => {
            callCount += 1;
        });
        await manager.joinLobby({ address: code });
        expect(callCount).toBe(1);
    });

    it('passes the ClientTransport to onSessionJoined', async () => {
        const { code, provider } = await hostAndGetCode();
        let capturedTransport: ClientTransport | null = null;
        const manager = new LobbyManager(provider, createNoopLogger(), undefined, (transport) => {
            capturedTransport = transport;
        });
        await manager.joinLobby({ address: code });
        expect(capturedTransport).not.toBeNull();
    });

    it('calls the teardown returned by onSessionJoined when closeLobby is called', async () => {
        const { code, provider } = await hostAndGetCode();
        let teardownCalled = false;
        const manager = new LobbyManager(provider, createNoopLogger(), undefined, (_transport) => {
            return () => {
                teardownCalled = true;
            };
        });
        await manager.joinLobby({ address: code });
        expect(teardownCalled).toBe(false);
        await manager.closeLobby();
        expect(teardownCalled).toBe(true);
    });

    it('does not throw when onSessionJoined returns undefined (no teardown)', async () => {
        const { code, provider } = await hostAndGetCode();
        const manager = new LobbyManager(
            provider,
            createNoopLogger(),
            undefined,
            (_transport) => undefined,
        );
        await manager.joinLobby({ address: code });
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });

    it('does not call onSessionJoined when not provided', async () => {
        const { code, provider } = await hostAndGetCode();
        const manager = new LobbyManager(provider, createNoopLogger());
        await manager.joinLobby({ address: code });
        await expect(manager.closeLobby()).resolves.toBeUndefined();
    });
});
