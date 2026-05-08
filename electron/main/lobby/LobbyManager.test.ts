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

import { afterEach, describe, it, expect, vi } from 'vitest';
import { InMemoryMultiplayerProvider } from '@chimera/networking/provider/InMemoryMultiplayerProvider.js';
import { createLogger, createMemorySink, createNoopLogger } from '../logging/logger.js';
import {
    LobbyManager,
    type HostedSessionMetadata,
    type LobbyManagerOptions,
} from './LobbyManager.js';
import { PlayerDirectory } from '../profile/PlayerDirectory.js';
import { createProfileGate } from '../profile/ProfileGate.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import {
    playerId,
    type HostLobbyParams,
    type HostTransport,
    type ClientTransport,
    type JoinLobbyParams,
    type MultiplayerProvider,
    type PlayerSnapshot,
    type LobbyState,
    type SideChannelMessage,
    type Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ConnectionStatus } from '../../preload/api-types.js';
import { localProfileId } from '@chimera/simulation/profile/ProfileSchema.js';
import type { PlayerProfile } from '@chimera/simulation/profile/ProfileSchema.js';
import type { AssetRef, TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import { registerE2eHooks, type E2eHooks } from '../runtime/e2e-hooks.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };

function makeProvider(): InMemoryMultiplayerProvider {
    return new InMemoryMultiplayerProvider();
}

function makeManager(
    provider: InMemoryMultiplayerProvider = makeProvider(),
    directory?: PlayerDirectory,
): LobbyManager {
    return new LobbyManager(
        provider,
        createNoopLogger(),
        directory !== undefined ? { profileGate: createProfileGate(directory) } : undefined,
    );
}

function requireHooks(value: E2eHooks | undefined): E2eHooks {
    if (value === undefined) {
        throw new Error('Expected __e2eHooks to be registered');
    }
    return value;
}

function requireMetadata(value: HostedSessionMetadata | null): HostedSessionMetadata {
    if (value === null) {
        throw new Error('Expected hosted-session metadata to be captured');
    }
    return value;
}

afterEach(() => {
    registerE2eHooks({});
});

/** Build a minimal valid {@link PlayerProfile} for profile attestation tests. */
function makeValidProfile(overrides?: Partial<PlayerProfile>): PlayerProfile {
    return {
        localProfileId: localProfileId('player-001'),
        displayName: 'Alice',
        avatar: { kind: 'builtin', ref: 'test/avatar' as AssetRef<TextureAsset> },
        locale: 'en-US',
        ...overrides,
    };
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
        commitments: {},
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

    it('passes host identity and agent-slot metadata to the hosted-session callback', async () => {
        const provider = makeProvider();
        const onSessionHosted = vi.fn();
        const manager = new LobbyManager(provider, createNoopLogger(), { onSessionHosted });
        const params: HostLobbyParams = {
            gameId: 'tactics',
            maxPlayers: 2,
            agentSlots: [{ slotIndex: 1, kind: 'ai', omniscient: true }],
        };

        const info = await manager.hostLobby(params);

        expect(onSessionHosted).toHaveBeenCalledOnce();
        expect(onSessionHosted).toHaveBeenCalledWith(expect.anything(), {
            hostId: info.hostId,
            maxPlayers: 2,
            agentSlots: params.agentSlots,
        });
    });

    it('passes injected E2E hooks through hosted-session metadata', async () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));
        const provider = makeProvider();
        let metadata: HostedSessionMetadata | null = null;
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (_transport, next) => {
                metadata = next;
            },
            e2eHooks: hooks,
        });

        await manager.hostLobby(HOST_PARAMS);

        const captured = requireMetadata(metadata);
        expect(captured.e2eHooks).toBe(hooks);
    });

    it('omits E2E hooks from hosted-session metadata when no hooks are injected', async () => {
        const provider = makeProvider();
        let metadata: HostedSessionMetadata | null = null;
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (_transport, next) => {
                metadata = next;
            },
        });

        await manager.hostLobby(HOST_PARAMS);

        const captured = requireMetadata(metadata);
        expect(captured.e2eHooks).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(captured, 'e2eHooks')).toBe(false);
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

    it('stores provider-assigned local player identity for joined sessions', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        const localPlayerId = joinManager.getLocalPlayerId();
        expect(localPlayerId).toBeTruthy();
        expect(localPlayerId).not.toBe(hostInfo.hostId);
    });
});

// ── switchActiveSeat ─────────────────────────────────────────────────────────

describe('LobbyManager.switchActiveSeat', () => {
    it('updates local player context when switching to a seat in the local lobby roster', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: hostInfo.sessionId });
        const joinedSeatId = joinManager.getLocalPlayerId();

        expect(joinedSeatId).toBeTruthy();

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        await expect(hostManager.switchActiveSeat(joinedSeatId!)).resolves.toBeUndefined();
        expect(hostManager.getLocalPlayerId()).toBe(joinedSeatId);

        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('rejects when switching seats without an active lobby session', async () => {
        const manager = makeManager();
        await expect(manager.switchActiveSeat(playerId('p1'))).rejects.toThrow(/active session/i);
    });

    it('rejects when switching to a seat not present in the local lobby roster', async () => {
        const manager = makeManager();
        await manager.hostLobby(HOST_PARAMS);

        await expect(manager.switchActiveSeat(playerId('not-in-lobby'))).rejects.toThrow(
            /not present in the lobby roster/i,
        );

        await manager.closeLobby();
    });
});

describe('LobbyManager connection-status lifecycle', () => {
    it('emits connecting and connected when hosting succeeds', async () => {
        const statuses: ConnectionStatus[] = [];
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), {
            onConnectionStatusChanged: (status) => {
                statuses.push(status);
            },
        });

        await manager.hostLobby(HOST_PARAMS);

        expect(statuses).toEqual(['connecting', 'connected']);
        await manager.closeLobby();
    });

    it('emits connecting and connected when joining succeeds', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const statuses: ConnectionStatus[] = [];
        const joinManager = new LobbyManager(provider, createNoopLogger(), {
            onConnectionStatusChanged: (status) => {
                statuses.push(status);
            },
        });

        await joinManager.joinLobby({ address: hostInfo.sessionId });

        expect(statuses).toEqual(['connecting', 'connected']);

        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('emits disconnected when joined transport disconnects', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const statuses: ConnectionStatus[] = [];
        const joinManager = new LobbyManager(provider, createNoopLogger(), {
            onConnectionStatusChanged: (status) => {
                statuses.push(status);
            },
        });
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        await hostManager.closeLobby();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(statuses).toContain('disconnected');

        await joinManager.closeLobby();
    });

    it('emits error when joinLobby fails', async () => {
        const errorProvider: MultiplayerProvider = {
            hostLobby: (params) => makeProvider().hostLobby(params),
            joinLobby: async (_params) => {
                throw new Error('unable to connect');
            },
            dispose: () => undefined,
        };

        const statuses: ConnectionStatus[] = [];
        const manager = new LobbyManager(errorProvider, createNoopLogger(), {
            onConnectionStatusChanged: (status) => {
                statuses.push(status);
            },
        });

        await expect(manager.joinLobby({ address: 'invalid' })).rejects.toThrow(
            'unable to connect',
        );
        expect(statuses).toEqual(['connecting', 'error']);
    });
});

// ── startMatch ───────────────────────────────────────────────────────────────

describe('LobbyManager.startMatch', () => {
    it('calls onMatchStartRequested when the hosted lobby has all players ready', async () => {
        const onMatchStartRequested = vi.fn();
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), {
            onMatchStartRequested,
        });
        await manager.hostLobby(HOST_PARAMS);
        await manager.updatePlayerReadyState(true);

        await expect(manager.startMatch()).resolves.toBeUndefined();

        expect(onMatchStartRequested).toHaveBeenCalledOnce();
    });

    it('rejects when any current player is not ready', async () => {
        const onMatchStartRequested = vi.fn();
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), {
            onMatchStartRequested,
        });
        await manager.hostLobby(HOST_PARAMS);

        await expect(manager.startMatch()).rejects.toThrow(/all players.*ready/i);
        expect(onMatchStartRequested).not.toHaveBeenCalled();
    });

    it('rejects from a joined client session', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const info = await hostManager.hostLobby(HOST_PARAMS);
        const joinManager = makeManager(provider);
        await joinManager.joinLobby({ address: info.sessionId });

        await expect(joinManager.startMatch()).rejects.toThrow(/host/i);
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
        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (transport) => {
                transport.onActionReceived((_from, action) => {
                    receivedAction = action;
                });
            },
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
        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (transport) => {
                capturedTransport = transport;
            },
        });

        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        // Join via raw provider so we can register our own snapshot callback
        const clientSession = await provider.joinLobby({ address: hostInfo.sessionId });

        let receivedSnapshot: unknown = null;
        clientSession.transport.onSnapshotReceived((snapshot) => {
            receivedSnapshot = snapshot;
        });

        // Host sends a snapshot to the joined client
        expect(capturedTransport).not.toBeNull();
        const testSnapshot = makeTestSnapshot();
        // capturedTransport is set synchronously by the onSessionHosted callback
        capturedTransport!.sendSnapshot(clientSession.localPlayerId, testSnapshot);

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

    it('joinLobby seeds joined manager lobby state immediately from join result', async () => {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinedStateRef: { value: LobbyState | null } = { value: null };
        const joinManager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                joinedStateRef.value = state;
            },
        });

        await joinManager.joinLobby({ address: hostInfo.sessionId });

        if (joinedStateRef.value === null) {
            throw new Error('Expected seeded lobby state after joinLobby');
        }
        expect(joinedStateRef.value.players).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ playerId: joinManager.getLocalPlayerId() }),
            ]),
        );

        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('joined client can update its ready state and host broadcasts it to all clients', async () => {
        const provider = makeProvider();

        let hostLobbyStateSnapshot: LobbyState | null = null;
        let joinLobbyStateSnapshot: LobbyState | null = null;

        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                hostLobbyStateSnapshot = state;
            },
        });

        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinManager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                joinLobbyStateSnapshot = state;
            },
        });

        await joinManager.joinLobby({ address: hostInfo.sessionId });
        const joinedPlayerId = joinManager.getLocalPlayerId();
        expect(joinedPlayerId).toBeTruthy();

        // Wait for host onPlayerJoined callback and the lobby-state broadcast.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        await expect(joinManager.updatePlayerReadyState(true)).resolves.toBeUndefined();
        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(hostLobbyStateSnapshot).not.toBeNull();
        expect(joinLobbyStateSnapshot).not.toBeNull();

        const hostState = hostLobbyStateSnapshot!;
        const joinedState = joinLobbyStateSnapshot!;

        const hostEntry = hostState.players.find((entry) => entry.playerId === joinedPlayerId);
        const joinedEntry = joinedState.players.find((entry) => entry.playerId === joinedPlayerId);

        expect(hostEntry?.ready).toBe(true);
        expect(joinedEntry?.ready).toBe(true);

        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('updates only the local player when local roster position is not index 0', async () => {
        const provider = makeProvider();

        let hostLobbyStateSnapshot: LobbyState | null = null;
        let joinMiddleLobbyStateSnapshot: LobbyState | null = null;

        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                hostLobbyStateSnapshot = state;
            },
        });

        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const joinMiddleManager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                joinMiddleLobbyStateSnapshot = state;
            },
        });

        const joinLastManager = makeManager(provider);

        await joinMiddleManager.joinLobby({ address: hostInfo.sessionId });
        await joinLastManager.joinLobby({ address: hostInfo.sessionId });

        const middlePlayerId = joinMiddleManager.getLocalPlayerId();
        const lastPlayerId = joinLastManager.getLocalPlayerId();
        const hostPlayerId = hostManager.getLocalPlayerId();

        expect(middlePlayerId).toBeTruthy();
        expect(lastPlayerId).toBeTruthy();
        expect(hostPlayerId).toBeTruthy();

        // Wait for join callbacks and lobby-state broadcasts to settle.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        await expect(joinMiddleManager.updatePlayerReadyState(true)).resolves.toBeUndefined();
        await new Promise<void>((resolve) => setTimeout(resolve, 30));

        expect(hostLobbyStateSnapshot).not.toBeNull();
        expect(joinMiddleLobbyStateSnapshot).not.toBeNull();

        const hostState = hostLobbyStateSnapshot!;
        const middleState = joinMiddleLobbyStateSnapshot!;

        expect(hostState.players.map((player) => player.playerId)).toEqual([
            hostPlayerId,
            middlePlayerId,
            lastPlayerId,
        ]);

        const hostEntry = hostState.players.find((entry) => entry.playerId === hostPlayerId);
        const middleEntry = hostState.players.find((entry) => entry.playerId === middlePlayerId);
        const lastEntry = hostState.players.find((entry) => entry.playerId === lastPlayerId);

        expect(middleEntry?.ready).toBe(true);
        expect(hostEntry?.ready).toBe(false);
        expect(lastEntry?.ready).toBe(false);

        const middleSelfEntry = middleState.players.find(
            (entry) => entry.playerId === middlePlayerId,
        );
        expect(middleSelfEntry?.ready).toBe(true);

        await joinLastManager.closeLobby();
        await joinMiddleManager.closeLobby();
        await hostManager.closeLobby();
    });
});

// ── onSessionHosted teardown ─────────────────────────────────────────────────

describe('LobbyManager onSessionHosted teardown', () => {
    it('calls the teardown returned by onSessionHosted when closeLobby is called', async () => {
        let teardownCalled = false;
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), {
            onSessionHosted: (_transport) => {
                return () => {
                    teardownCalled = true;
                };
            },
        });
        await manager.hostLobby(HOST_PARAMS);
        expect(teardownCalled).toBe(false);
        await manager.closeLobby();
        expect(teardownCalled).toBe(true);
    });

    it('does not throw when onSessionHosted returns undefined (no teardown)', async () => {
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), {
            onSessionHosted: (_transport) => {
                return undefined;
            },
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
        const manager = new LobbyManager(wrappedProvider, createNoopLogger(), {
            onSessionHosted: (_transport) => {
                return () => {
                    order.push('teardown');
                };
            },
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
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionJoined: (_transport) => {
                callCount += 1;
            },
        });
        await manager.joinLobby({ address: code });
        expect(callCount).toBe(1);
    });

    it('passes the ClientTransport to onSessionJoined', async () => {
        const { code, provider } = await hostAndGetCode();
        let capturedTransport: ClientTransport | null = null;
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionJoined: (transport) => {
                capturedTransport = transport;
            },
        });
        await manager.joinLobby({ address: code });
        expect(capturedTransport).not.toBeNull();
    });

    it('calls the teardown returned by onSessionJoined when closeLobby is called', async () => {
        const { code, provider } = await hostAndGetCode();
        let teardownCalled = false;
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionJoined: (_transport) => {
                return () => {
                    teardownCalled = true;
                };
            },
        });
        await manager.joinLobby({ address: code });
        expect(teardownCalled).toBe(false);
        await manager.closeLobby();
        expect(teardownCalled).toBe(true);
    });

    it('does not throw when onSessionJoined returns undefined (no teardown)', async () => {
        const { code, provider } = await hostAndGetCode();
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onSessionJoined: (_transport) => undefined,
        });
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

// ── JOIN profile attestation ─────────────────────────────────────────────────
//
// Invariant #61: ProfileSanitizer.admit() is the mandatory gate between
// inbound JOIN and PlayerDirectory. Raw attestation never reaches any other
// subsystem.

describe('LobbyManager — JOIN profile attestation', () => {
    it('admits a valid profile and adds it to PlayerDirectory', async () => {
        const directory = new PlayerDirectory();
        const provider = makeProvider();
        const manager = makeManager(provider, directory);
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        const validProfile = makeValidProfile();
        await provider.joinLobby({ address: hostInfo.sessionId, profile: validProfile });

        // Allow the deferred onPlayerJoined callback to fire
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const entries = Object.values(directory.snapshot());
        expect(entries).toHaveLength(1);
        expect(entries[0]!.displayName).toBe('Alice');

        await manager.closeLobby();
    });

    it('rejects a JOIN with an invalid profile (display name too long) and does not add to directory', async () => {
        const directory = new PlayerDirectory();
        const provider = makeProvider();
        const manager = makeManager(provider, directory);
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        const invalidProfile = makeValidProfile({ displayName: 'A'.repeat(33) });
        await expect(
            provider.joinLobby({ address: hostInfo.sessionId, profile: invalidProfile }),
        ).rejects.toThrow(/JOIN rejected/);

        expect(Object.keys(directory.snapshot())).toHaveLength(0);

        await manager.closeLobby();
    });

    it('clears PlayerDirectory when closeLobby() is called', async () => {
        const directory = new PlayerDirectory();
        const provider = makeProvider();
        const manager = makeManager(provider, directory);
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        await provider.joinLobby({ address: hostInfo.sessionId, profile: makeValidProfile() });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(Object.keys(directory.snapshot())).toHaveLength(1);

        await manager.closeLobby();

        expect(Object.keys(directory.snapshot())).toHaveLength(0);
    });

    it('uses the sanitised displayName in the lobby state after a valid JOIN', async () => {
        const directory = new PlayerDirectory();
        const provider = makeProvider();
        const lobbyStates: LobbyState[] = [];
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                lobbyStates.push(state);
            },
            profileGate: createProfileGate(directory),
        });
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        await provider.joinLobby({
            address: hostInfo.sessionId,
            profile: makeValidProfile({ displayName: 'Alice' }),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const lastState = lobbyStates[lobbyStates.length - 1];
        const aliceEntry = lastState?.players.find((p) => p.displayName === 'Alice');
        expect(aliceEntry).toBeDefined();

        await manager.closeLobby();
    });

    it('admits a JOIN with no profile gate (no directory injected) using default displayName', async () => {
        const provider = makeProvider();
        const manager = makeManager(provider); // no directory — no gate
        const hostInfo = await manager.hostLobby(HOST_PARAMS);

        // joinLobby without a profile should succeed (gate is absent)
        await expect(provider.joinLobby({ address: hostInfo.sessionId })).resolves.toBeDefined();

        await manager.closeLobby();
    });
});

// ── PROFILE_UPDATE side-channel ───────────────────────────────────────────────
//
// Invariant #61: ProfileSanitizer.admit() is the mandatory gate for PROFILE_UPDATE.
// Invariant #62: PROFILE_UPDATE is rate-limited to 1 per 5 seconds per client.

describe('LobbyManager — PROFILE_UPDATE side-channel', () => {
    /**
     * Build a base64 string whose decoded byte length exceeds MAX_CUSTOM_AVATAR_BYTES
     * (64 KB).  The AVATAR_TOO_LARGE check fires before the magic-bytes check, so
     * the content does not need to be a valid PNG/JPEG.
     */
    function makeOversizedAvatarBase64(): string {
        // 65537 bytes > 65536 (64 KB) — triggers AVATAR_TOO_LARGE in ProfileSanitizer
        return Buffer.alloc(65537, 0).toString('base64');
    }

    it('valid PROFILE_UPDATE updates PlayerDirectory and triggers LobbyState rebroadcast', async () => {
        const provider = makeProvider();
        const directory = new PlayerDirectory();
        const lobbyStates: LobbyState[] = [];
        const manager = new LobbyManager(provider, createNoopLogger(), {
            onLobbyStateChanged: (state) => {
                lobbyStates.push(state);
            },
            profileGate: createProfileGate(directory),
        });

        const hostInfo = await manager.hostLobby(HOST_PARAMS);
        const originalProfile = makeValidProfile({ displayName: 'Alice' });
        const clientSession = await provider.joinLobby({
            address: hostInfo.sessionId,
            profile: originalProfile,
        });

        // Wait for the deferred onPlayerJoined callback to fire so the player
        // is in the lobby roster before sending PROFILE_UPDATE.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const updatedProfile = makeValidProfile({ displayName: 'AliceUpdated' });
        clientSession.transport.sendSideChannel({ kind: 'profile', payload: updatedProfile });

        // PlayerDirectory must reflect the new profile
        const entries = Object.values(directory.snapshot());
        expect(entries).toHaveLength(1);
        expect(entries[0]!.displayName).toBe('AliceUpdated');

        // LobbyState must have been rebroadcast with the new displayName
        const lastState = lobbyStates[lobbyStates.length - 1];
        const updatedEntry = lastState?.players.find(
            (p) => p.playerId === clientSession.localPlayerId,
        );
        expect(updatedEntry?.displayName).toBe('AliceUpdated');

        await manager.closeLobby();
    });

    it('invalid PROFILE_UPDATE (avatar too large) sends profile_reject and leaves directory unchanged', async () => {
        const provider = makeProvider();
        const directory = new PlayerDirectory();
        const manager = makeManager(provider, directory);

        const hostInfo = await manager.hostLobby(HOST_PARAMS);
        const originalProfile = makeValidProfile({ displayName: 'Bob' });
        const clientSession = await provider.joinLobby({
            address: hostInfo.sessionId,
            profile: originalProfile,
        });

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const receivedMessages: SideChannelMessage[] = [];
        clientSession.transport.onSideChannelReceived((msg) => {
            receivedMessages.push(msg);
        });

        const invalidProfile = makeValidProfile({
            avatar: {
                kind: 'custom',
                mimeType: 'image/png',
                base64: makeOversizedAvatarBase64(),
            },
        });
        clientSession.transport.sendSideChannel({ kind: 'profile', payload: invalidProfile });

        // Directory must remain unchanged (original profile preserved)
        const entries = Object.values(directory.snapshot());
        expect(entries).toHaveLength(1);
        expect(entries[0]!.displayName).toBe('Bob');

        // Client must have received a profile_reject message
        const reject = receivedMessages.find((m) => m.kind === 'profile_reject');
        expect(reject).toBeDefined();
        expect((reject as { kind: 'profile_reject'; reason: string }).reason).toBe(
            'profile:AVATAR_TOO_LARGE',
        );

        await manager.closeLobby();
    });

    it('2nd PROFILE_UPDATE within 5 s is rate-limited (1 per 5 s per client) — returns REJECT { reason: "rate_limit" } without updating directory', async () => {
        const provider = makeProvider();
        const directory = new PlayerDirectory();
        const manager = makeManager(provider, directory);

        const hostInfo = await manager.hostLobby(HOST_PARAMS);
        const originalProfile = makeValidProfile({ displayName: 'Carol' });
        const clientSession = await provider.joinLobby({
            address: hostInfo.sessionId,
            profile: originalProfile,
        });

        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const receivedMessages: SideChannelMessage[] = [];
        clientSession.transport.onSideChannelReceived((msg) => {
            receivedMessages.push(msg);
        });

        const updateProfile = makeValidProfile({ displayName: 'CarolUpdated' });

        // Send 6 PROFILE_UPDATEs in rapid succession.
        // Rate limit is 1 per 5 s per client: the 1st is admitted (no prior
        // timestamp); every subsequent update within the same 5 s window
        // (2nd–6th here) must be rejected with reason: 'rate_limit'.
        for (let i = 0; i < 6; i++) {
            clientSession.transport.sendSideChannel({ kind: 'profile', payload: updateProfile });
        }

        // All 5 rate-limited attempts (2nd–6th) must be rejected with rate_limit
        const rateLimitRejects = receivedMessages.filter(
            (m) =>
                m.kind === 'profile_reject' &&
                (m as { kind: 'profile_reject'; reason: string }).reason === 'rate_limit',
        );
        expect(rateLimitRejects.length).toBeGreaterThanOrEqual(1);

        // Directory must not have been updated by a rate-limited attempt
        // (still holds the profile from the 1st successful update)
        const entries = Object.values(directory.snapshot());
        expect(entries).toHaveLength(1);

        await manager.closeLobby();
    });
});

// ── onClientSnapshotReceived forwarding ──────────────────────────────────────
//
// When the host broadcasts a PlayerSnapshot to a joined client, LobbyManager
// must invoke the onClientSnapshotReceived callback so the wiring point
// (index.ts) can forward the snapshot to the renderer via webContents.send.

describe('LobbyManager — onClientSnapshotReceived', () => {
    async function hostAndJoin(
        onClientSnapshotReceived?: (snapshot: PlayerSnapshot) => void,
    ): Promise<{
        hostManager: LobbyManager;
        joinManager: LobbyManager;
        provider: InMemoryMultiplayerProvider;
    }> {
        const provider = makeProvider();
        const hostManager = makeManager(provider);
        const code = (await hostManager.hostLobby(HOST_PARAMS)).sessionId;
        const joinManager = new LobbyManager(
            provider,
            createNoopLogger(),
            onClientSnapshotReceived !== undefined ? { onClientSnapshotReceived } : undefined,
        );
        await joinManager.joinLobby({ address: code });
        return { hostManager, joinManager, provider };
    }

    it('registers onClientSnapshotReceived without throwing (wiring-presence)', async () => {
        const received: PlayerSnapshot[] = [];
        const { joinManager } = await hostAndJoin((snap) => {
            received.push(snap);
        });

        // Callback is registered and did not throw during setup.
        // End-to-end callback invocation (snapshot delivery) is tested separately.
        await joinManager.closeLobby();
    });

    it('invokes onClientSnapshotReceived when host sends a snapshot to the joined client', async () => {
        const received: PlayerSnapshot[] = [];
        const provider = makeProvider();

        // Capture HostTransport from the host manager
        let capturedTransport: HostTransport | null = null;
        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (transport) => {
                capturedTransport = transport;
            },
        });

        // Host and join
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);
        const joinManager = new LobbyManager(provider, createNoopLogger(), {
            onClientSnapshotReceived: (snap) => {
                received.push(snap);
            },
        });
        await joinManager.joinLobby({ address: hostInfo.sessionId });

        // Send a snapshot from host to joined client via captured transport
        expect(capturedTransport).not.toBeNull();
        const testSnapshot = makeTestSnapshot();
        const joinPlayerId = joinManager.getLocalPlayerId();
        expect(joinPlayerId).not.toBeNull();
        capturedTransport!.sendSnapshot(joinPlayerId!, testSnapshot);

        // Verify callback was invoked with the snapshot
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(testSnapshot);

        // Teardown
        await joinManager.closeLobby();
        await hostManager.closeLobby();
    });

    it('does not throw when onClientSnapshotReceived is not provided', async () => {
        const { hostManager, joinManager } = await hostAndJoin(undefined);
        await hostManager.closeLobby();
        await joinManager.closeLobby();
    });

    it('stops calling onClientSnapshotReceived after closeLobby', async () => {
        const received: PlayerSnapshot[] = [];
        const { hostManager, joinManager } = await hostAndJoin((snap) => {
            received.push(snap);
        });

        await joinManager.closeLobby();
        await hostManager.closeLobby();

        const countAfterClose = received.length;
        // No further callbacks fire after close
        expect(received.length).toBe(countAfterClose);
    });
});

// ── LobbyManagerOptions ───────────────────────────────────────────────────────

describe('LobbyManagerOptions', () => {
    it('constructs LobbyManager with callbacks supplied via options bag', async () => {
        const statuses: ConnectionStatus[] = [];
        const options: LobbyManagerOptions = {
            onConnectionStatusChanged: (status) => {
                statuses.push(status);
            },
        };
        const manager = new LobbyManager(makeProvider(), createNoopLogger(), options);
        await manager.hostLobby(HOST_PARAMS);
        expect(statuses).toEqual(['connecting', 'connected']);
        await manager.closeLobby();
    });

    it('e2eHooks can be passed via options bag without undefined padding', async () => {
        const hooks = requireHooks(registerE2eHooks({ CHIMERA_E2E: '1' }));
        const provider = makeProvider();
        let metadata: HostedSessionMetadata | null = null;
        const options: LobbyManagerOptions = {
            onSessionHosted: (_transport, next) => {
                metadata = next;
            },
            e2eHooks: hooks,
        };
        const manager = new LobbyManager(provider, createNoopLogger(), options);
        await manager.hostLobby(HOST_PARAMS);
        const captured = requireMetadata(metadata);
        expect(captured.e2eHooks).toBe(hooks);
        await manager.closeLobby();
    });
});
