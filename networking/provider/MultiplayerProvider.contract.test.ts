/**
 * networking/provider/MultiplayerProvider.contract.test.ts
 *
 * Reusable contract test suite for the MultiplayerProvider interface.
 *
 * Exports `testMultiplayerProviderContract(name, factory)` — a helper that
 * runs the full behavioural contract against any conforming implementation.
 * Re-run in F10 against LocalWebSocketProvider to prove it satisfies the
 * same invariants as InMemoryMultiplayerProvider.
 *
 * Tests covered:
 *   - snapshot delivery (host → specific client)
 *   - action receipt (client → host)
 *   - side-channel round-trip (both directions)
 *   - lobby state broadcast
 *   - disconnect notification (close / disconnect)
 *   - dispose() idempotency
 *   - isBrowsable() narrowing (false for InMemoryMultiplayerProvider, true for
 *     a provider that adds listLobbies())
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T5 (issue #205)
 *
 * Invariants upheld:
 *   #2 — no simulation/ imports; contract tests live entirely in networking/
 */

import { describe, it, expect } from 'vitest';

import { InMemoryMultiplayerProvider } from './InMemoryMultiplayerProvider.js';
import { SteamNetworkProvider } from './steam/SteamNetworkProvider.js';
import { isBrowsable, playerId as toPlayerId } from './MultiplayerProvider.js';

import type {
    MultiplayerProvider,
    BrowsableProvider,
    PlayerSnapshot,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
} from './MultiplayerProvider.js';
import type { PlayerId, EngineAction } from '@chimera/simulation/engine/types.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 42,
        viewerId,
        players: {},
        entities: {},
        phase: 'contract-test',
        events: [],
        matchResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeAction(playerId: PlayerId): EngineAction {
    return {
        type: 'contract:noop',
        playerId,
        tick: 42,
        payload: {},
    };
}

function makeChatMsg(text: string): SideChannelMessage {
    return {
        kind: 'chat',
        payload: { senderId: toPlayerId('contract-sender'), text, timestamp: 0 },
    };
}

// ─── Contract test helper ─────────────────────────────────────────────────────

/**
 * Runs the full MultiplayerProvider contract suite against any conforming
 * implementation.
 *
 * Usage in F10:
 *   import { testMultiplayerProviderContract } from
 *     './MultiplayerProvider.contract.test.js';
 *   testMultiplayerProviderContract('LocalWebSocketProvider', () => new LocalWebSocketProvider());
 */
export function testMultiplayerProviderContract(
    implName: string,
    factory: () => MultiplayerProvider,
): void {
    describe(`MultiplayerProvider contract — ${implName}`, () => {
        // ── hostLobby ────────────────────────────────────────────────────────

        describe('hostLobby', () => {
            it('resolves to a HostedSession with a non-empty lobbyCode', async () => {
                const provider = factory();
                const session = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                expect(typeof session.lobbyCode).toBe('string');
                expect(session.lobbyCode.length).toBeGreaterThan(0);
                provider.dispose();
            });

            it('each hostLobby call produces a unique lobbyCode', async () => {
                const provider = factory();
                const s1 = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
                const s2 = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
                expect(s1.lobbyCode).not.toBe(s2.lobbyCode);
                provider.dispose();
            });

            it('HostTransport exposes all required subscription methods', async () => {
                const provider = factory();
                const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
                const t = session.transport;
                expect(typeof t.sendSnapshot).toBe('function');
                expect(typeof t.broadcastLobbyState).toBe('function');
                expect(typeof t.sendSideChannel).toBe('function');
                expect(typeof t.onActionReceived).toBe('function');
                expect(typeof t.onSideChannelReceived).toBe('function');
                expect(typeof t.onPlayerJoined).toBe('function');
                expect(typeof t.onPlayerLeft).toBe('function');
                provider.dispose();
            });
        });

        // ── joinLobby ────────────────────────────────────────────────────────

        describe('joinLobby', () => {
            it('resolves to a JoinedSession for a valid lobbyCode', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                expect(typeof joined.transport.sendAction).toBe('function');
                expect(typeof joined.transport.onSnapshotReceived).toBe('function');
                provider.dispose();
            });

            it('rejects when the address does not match any active session', async () => {
                const provider = factory();
                await expect(provider.joinLobby({ address: 'no-such-session' })).rejects.toThrow();
                provider.dispose();
            });

            it('fires onPlayerJoined on the host transport', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined: LobbyPlayerEntry[] = [];
                hosted.transport.onPlayerJoined((p) => joined.push(p));

                await provider.joinLobby({ address: hosted.lobbyCode });
                await new Promise<void>((resolve) => setTimeout(resolve, 0));

                expect(joined).toHaveLength(1);
                expect(typeof joined[0]?.playerId).toBe('string');
                provider.dispose();
            });

            it('onPlayerJoined does not fire synchronously inside joinLobby()', async () => {
                // Invariant: the host callback must not execute during the synchronous
                // body of joinLobby(). Consumers cannot register handlers on a
                // JoinedSession they have not yet received, so firing inside joinLobby()
                // would silently drop any host-side response (e.g. broadcastLobbyState).
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joinedPlayers: LobbyPlayerEntry[] = [];
                hosted.transport.onPlayerJoined((p) => joinedPlayers.push(p));

                // Call joinLobby but do NOT await it yet
                const joinPromise = provider.joinLobby({ address: hosted.lobbyCode });

                // If onPlayerJoined fired synchronously (inside joinLobby body),
                // joinedPlayers would already have 1 entry here — that is the bug.
                expect(joinedPlayers).toHaveLength(0);

                await joinPromise;
                provider.dispose();
            });

            it('ClientTransport exposes all required subscription methods', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                const t = joined.transport;
                expect(joined.initialLobbyState.info.sessionId).toBe(hosted.lobbyCode);
                expect(joined.initialLobbyState.players).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ playerId: joined.localPlayerId }),
                    ]),
                );
                expect(typeof t.sendAction).toBe('function');
                expect(typeof t.sendSideChannel).toBe('function');
                expect(typeof t.onSnapshotReceived).toBe('function');
                expect(typeof t.onSideChannelReceived).toBe('function');
                expect(typeof t.onLobbyStateChanged).toBe('function');
                expect(typeof t.onDisconnected).toBe('function');
                provider.dispose();
            });

            it('second joined session seeds initialLobbyState with full known roster', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joinedA = await provider.joinLobby({ address: hosted.lobbyCode });
                const joinedB = await provider.joinLobby({ address: hosted.lobbyCode });

                expect(joinedB.initialLobbyState.players).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ playerId: hosted.lobbyInfo.hostId }),
                        expect.objectContaining({ playerId: joinedA.localPlayerId }),
                        expect.objectContaining({ playerId: joinedB.localPlayerId }),
                    ]),
                );

                provider.dispose();
            });
        });

        // ── Snapshot delivery ─────────────────────────────────────────────────

        describe('snapshot delivery', () => {
            it('sendSnapshot is received by the matching client via onSnapshotReceived', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const received: PlayerSnapshot[] = [];
                joined.transport.onSnapshotReceived((s) => received.push(s));

                hosted.transport.sendSnapshot(
                    joined.localPlayerId,
                    makeSnapshot(joined.localPlayerId),
                );

                expect(received).toHaveLength(1);
                expect(received[0]?.tick).toBe(42);
                provider.dispose();
            });

            it('unsubscribing from onSnapshotReceived stops further delivery', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const received: PlayerSnapshot[] = [];
                const unsub = joined.transport.onSnapshotReceived((s) => received.push(s));
                unsub();

                hosted.transport.sendSnapshot(
                    joined.localPlayerId,
                    makeSnapshot(joined.localPlayerId),
                );
                expect(received).toHaveLength(0);
                provider.dispose();
            });

            it('sendTick is received by the matching client via onTickReceived', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const received: number[] = [];
                joined.transport.onTickReceived((tick) => received.push(tick));

                hosted.transport.sendTick(joined.localPlayerId, 77);

                expect(received).toEqual([77]);
                provider.dispose();
            });

            it('unsubscribing from onTickReceived stops tick delivery', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const received: number[] = [];
                const unsub = joined.transport.onTickReceived((tick) => received.push(tick));
                unsub();

                hosted.transport.sendTick(joined.localPlayerId, 78);

                expect(received).toHaveLength(0);
                provider.dispose();
            });
        });

        // ── Action receipt ────────────────────────────────────────────────────

        describe('action receipt', () => {
            it('client sendAction is received by the host via onActionReceived', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                let fromId!: PlayerId;
                let receivedAction!: EngineAction;
                hosted.transport.onActionReceived((from, action) => {
                    fromId = from;
                    receivedAction = action;
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                joined.transport.sendAction(makeAction(joined.localPlayerId));

                expect(fromId).toBe(joined.localPlayerId);
                expect(receivedAction.type).toBe('contract:noop');
                provider.dispose();
            });

            it('unsubscribing from onActionReceived stops further delivery', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const actions: EngineAction[] = [];
                const unsub = hosted.transport.onActionReceived((_from, a) => actions.push(a));
                unsub();

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                joined.transport.sendAction(makeAction(toPlayerId('p1')));

                expect(actions).toHaveLength(0);
                provider.dispose();
            });
        });

        // ── Side-channel ──────────────────────────────────────────────────────

        describe('side-channel', () => {
            it('host sendSideChannel broadcast is received by the client', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const received: SideChannelMessage[] = [];
                joined.transport.onSideChannelReceived((m) => received.push(m));

                hosted.transport.sendSideChannel('broadcast', makeChatMsg('hello'));

                expect(received).toHaveLength(1);
                expect(received[0]?.kind).toBe('chat');
                provider.dispose();
            });

            it('client sendSideChannel is received by the host', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                let fromHost!: PlayerId;
                let receivedMsg!: SideChannelMessage;
                hosted.transport.onSideChannelReceived((from, msg) => {
                    fromHost = from;
                    receivedMsg = msg;
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                joined.transport.sendSideChannel(makeChatMsg('ping'));

                expect(fromHost).toBe(joined.localPlayerId);
                expect(receivedMsg.kind).toBe('chat');
                provider.dispose();
            });

            it('host sendSideChannel unicast is received only by the target client', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joinedA = await provider.joinLobby({ address: hosted.lobbyCode });
                const joinedB = await provider.joinLobby({ address: hosted.lobbyCode });

                const receivedA: SideChannelMessage[] = [];
                const receivedB: SideChannelMessage[] = [];
                joinedA.transport.onSideChannelReceived((m) => receivedA.push(m));
                joinedB.transport.onSideChannelReceived((m) => receivedB.push(m));

                // Unicast to clientA only
                hosted.transport.sendSideChannel(joinedA.localPlayerId, makeChatMsg('private'));

                expect(receivedA).toHaveLength(1);
                expect(receivedA[0]?.kind).toBe('chat');
                expect(receivedB).toHaveLength(0);
                provider.dispose();
            });
        });

        // ── Lobby state broadcast ─────────────────────────────────────────────

        describe('lobby state broadcast', () => {
            it('broadcastLobbyState is received by the client via onLobbyStateChanged', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const states: unknown[] = [];
                joined.transport.onLobbyStateChanged((s) => states.push(s));

                hosted.transport.broadcastLobbyState({
                    info: {
                        sessionId: hosted.lobbyCode,
                        hostId: toPlayerId('host'),
                        gameId: 'contract-test',
                    },
                    players: [
                        {
                            playerId: joined.localPlayerId,
                            displayName: 'Alice',
                            ready: false,
                        },
                    ],
                });

                expect(states).toHaveLength(1);
                provider.dispose();
            });
        });

        // ── Disconnect notification ───────────────────────────────────────────

        describe('disconnect notification', () => {
            it('close() on hosted session fires onDisconnected on the client', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const reasons: DisconnectReason[] = [];
                joined.transport.onDisconnected((r) => reasons.push(r));

                await hosted.close();

                expect(reasons).toHaveLength(1);
                expect(reasons[0]).toBe('host_closed');
                provider.dispose();
            });

            it('disconnect() on joined session fires onPlayerLeft on the host', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });

                let leftId!: PlayerId;
                let leftReason!: DisconnectReason;
                hosted.transport.onPlayerLeft((id, r) => {
                    leftId = id;
                    leftReason = r;
                });

                const joined = await provider.joinLobby({ address: hosted.lobbyCode });
                await joined.disconnect();

                expect(leftId).toBe(joined.localPlayerId);
                expect(leftReason).toBe('normal');
                provider.dispose();
            });
        });

        // ── dispose() idempotency ─────────────────────────────────────────────

        describe('dispose() idempotency', () => {
            it('dispose() does not throw even when no sessions are active', () => {
                const provider = factory();
                expect(() => provider.dispose()).not.toThrow();
            });

            it('dispose() can be called multiple times without throwing', () => {
                const provider = factory();
                expect(() => {
                    provider.dispose();
                    provider.dispose();
                    provider.dispose();
                }).not.toThrow();
            });

            it('dispose() fires onDisconnected on all active client sessions', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const reasons: DisconnectReason[] = [];
                joined.transport.onDisconnected((r) => reasons.push(r));

                provider.dispose();
                expect(reasons).toHaveLength(1);
            });

            it('joinLobby rejects after dispose()', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const code = hosted.lobbyCode;
                provider.dispose();
                await expect(provider.joinLobby({ address: code })).rejects.toThrow();
            });
        });

        // ── Unsubscribe helpers ───────────────────────────────────────────────

        describe('Unsubscribe helpers', () => {
            it('all onX subscription methods return callable Unsubscribe functions', async () => {
                const provider = factory();
                const hosted = await provider.hostLobby({
                    gameId: 'contract-test',
                    maxPlayers: 4,
                });
                const joined = await provider.joinLobby({ address: hosted.lobbyCode });

                const unsubs = [
                    hosted.transport.onActionReceived(() => {}),
                    hosted.transport.onSideChannelReceived(() => {}),
                    hosted.transport.onPlayerJoined(() => {}),
                    hosted.transport.onPlayerLeft(() => {}),
                    joined.transport.onSnapshotReceived(() => {}),
                    joined.transport.onSideChannelReceived(() => {}),
                    joined.transport.onReveal(() => {}),
                    joined.transport.onLobbyStateChanged(() => {}),
                    joined.transport.onDisconnected(() => {}),
                    joined.transport.onLatencyUpdate(() => {}),
                ];

                expect(() => {
                    for (const unsub of unsubs) unsub();
                }).not.toThrow();

                provider.dispose();
            });
        });
    });
}

// ─── Run contract suite against InMemoryMultiplayerProvider ──────────────────

testMultiplayerProviderContract(
    'InMemoryMultiplayerProvider',
    () => new InMemoryMultiplayerProvider(),
);

// ─── isBrowsable() narrowing ─────────────────────────────────────────────────

describe('isBrowsable() narrowing', () => {
    it('returns false for InMemoryMultiplayerProvider — does not implement BrowsableProvider', () => {
        const provider = new InMemoryMultiplayerProvider();
        expect(isBrowsable(provider)).toBe(false);
    });

    it('returns true for a stub that adds listLobbies()', () => {
        const provider: MultiplayerProvider & BrowsableProvider = {
            hostLobby: async () => {
                throw new Error('noop');
            },
            joinLobby: async () => {
                throw new Error('noop');
            },
            dispose: () => {},
            listLobbies: async () => [],
        };
        expect(isBrowsable(provider)).toBe(true);
    });

    it('returns true for SteamNetworkProvider — implements BrowsableProvider', () => {
        const steam = new SteamNetworkProvider();
        expect(isBrowsable(steam)).toBe(true);
    });
});
