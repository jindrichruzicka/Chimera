/**
 * networking/provider/InMemoryMultiplayerProvider.test.ts
 *
 * Written first (red) per TDD mandate — InMemoryMultiplayerProvider.ts does not exist yet.
 *
 * Verifies all acceptance criteria from issue #204:
 *   1. InMemoryMultiplayerProvider satisfies MultiplayerProvider structurally
 *   2. Host can send a snapshot via sendSnapshot() and client receives it
 *   3. Client can send an action via sendAction() and host receives it
 *   4. Side-channel messages round-trip (host → client, client → host)
 *   5. dispose() cleans up without throwing
 *   6. onPlayerJoined fires when a client joins
 *   7. close() on hosted session fires onDisconnected on client
 *   8. disconnect() on joined session fires onPlayerLeft on host
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T4 (issue #204)
 */

import { describe, it, expect, vi } from 'vitest';

import { InMemoryMultiplayerProvider } from './InMemoryMultiplayerProvider.js';
import { playerId as toPlayerId } from './MultiplayerProvider.js';
import { DEFAULT_MAX_SPECTATORS } from './spectator-policy.js';

import type {
    MultiplayerProvider,
    PlayerSnapshot,
    LobbyPlayerEntry,
    SideChannelMessage,
    DisconnectReason,
} from './MultiplayerProvider.js';
import type { PlayerId, EngineAction } from '@chimera-engine/simulation/contracts';
import type { WireCommitmentReveal } from '@chimera-engine/simulation/foundation/messages.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 1,
        viewerId,
        players: {},
        entities: {},
        phase: 'active',
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeAction(playerId: PlayerId): EngineAction {
    return {
        type: 'test:noop',
        playerId,
        tick: 1,
        payload: {},
    };
}

function makeChatSideChannel(text: string): SideChannelMessage {
    return {
        kind: 'chat',
        payload: {
            id: '',
            senderId: toPlayerId('p1'),
            text,
            scope: { kind: 'lobby' },
            timestamp: 0,
        },
    };
}

// ─── Structural compliance ────────────────────────────────────────────────────

describe('InMemoryMultiplayerProvider', () => {
    it('satisfies MultiplayerProvider structurally', () => {
        const provider: MultiplayerProvider = new InMemoryMultiplayerProvider();
        expect(provider).toBeDefined();
        expect(typeof provider.hostLobby).toBe('function');
        expect(typeof provider.joinLobby).toBe('function');
        expect(typeof provider.dispose).toBe('function');
    });

    // ─── hostLobby ────────────────────────────────────────────────────────────

    describe('hostLobby', () => {
        it('resolves to a HostedSession with a lobbyCode string', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            expect(typeof session.lobbyCode).toBe('string');
            expect(session.lobbyCode.length).toBeGreaterThan(0);
        });

        it('transport has all required HostTransport methods', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const session = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const t = session.transport;
            expect(typeof t.sendSnapshot).toBe('function');
            expect(typeof t.broadcastLobbyState).toBe('function');
            expect(typeof t.sendSideChannel).toBe('function');
            expect(typeof t.onActionReceived).toBe('function');
            expect(typeof t.onSideChannelReceived).toBe('function');
            expect(typeof t.onPlayerJoined).toBe('function');
            expect(typeof t.onPlayerLeft).toBe('function');
        });

        it('each hostLobby call produces a unique lobbyCode', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const s1 = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
            const s2 = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 2 });
            expect(s1.lobbyCode).not.toBe(s2.lobbyCode);
        });

        it('each provider instance has an independent ID counter', async () => {
            // If idCounter were module-scoped (shared), sequential hostLobby() calls
            // across different instances would consume different counter values and
            // produce different lobbyCode suffixes. With instance-scoped counters,
            // each fresh instance starts at 1 and produces the same first lobbyCode.
            const providerA = new InMemoryMultiplayerProvider();
            const providerB = new InMemoryMultiplayerProvider();

            const hostedA = await providerA.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const hostedB = await providerB.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            expect(hostedA.lobbyCode).toBe(hostedB.lobbyCode);
        });
    });

    // ─── joinLobby ────────────────────────────────────────────────────────────

    describe('joinLobby', () => {
        it('resolves to a JoinedSession when given a valid lobbyCode as address', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            expect(joined.lobbyInfo.gameId).toBe('tactics');
            expect(typeof joined.transport.sendAction).toBe('function');
        });

        it('rejects when the address does not match any active session', async () => {
            const provider = new InMemoryMultiplayerProvider();
            await expect(provider.joinLobby({ address: 'nonexistent-code' })).rejects.toThrow();
        });

        it('fires onPlayerJoined on the host transport when a client joins', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const joinedPlayers: LobbyPlayerEntry[] = [];
            hosted.transport.onPlayerJoined((player) => {
                joinedPlayers.push(player);
            });

            await provider.joinLobby({ address: hosted.lobbyCode });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(joinedPlayers).toHaveLength(1);
            expect(typeof joinedPlayers[0]?.playerId).toBe('string');
        });
    });

    // ─── Snapshot delivery ────────────────────────────────────────────────────

    describe('snapshot delivery', () => {
        it('host sendSnapshot is received by the matching client', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const received: PlayerSnapshot[] = [];
            joined.transport.onSnapshotReceived((snap) => received.push(snap));

            const snapshot = makeSnapshot(joined.localPlayerId);
            hosted.transport.sendSnapshot(joined.localPlayerId, snapshot);

            expect(received).toHaveLength(1);
            expect(received[0]?.tick).toBe(1);
        });

        it('snapshot sent to a different playerId is not received by this client', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            await provider.joinLobby({ address: hosted.lobbyCode });

            const received: PlayerSnapshot[] = [];
            const joined2 = await provider.joinLobby({ address: hosted.lobbyCode });
            joined2.transport.onSnapshotReceived((snap) => received.push(snap));

            // Send snapshot to a completely different, unregistered playerId
            hosted.transport.sendSnapshot(
                toPlayerId('unrelated-player'),
                makeSnapshot(toPlayerId('unrelated-player')),
            );

            expect(received).toHaveLength(0);
        });

        it('unsubscribing from onSnapshotReceived stops delivery', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const received: PlayerSnapshot[] = [];
            const unsub = joined.transport.onSnapshotReceived((snap) => received.push(snap));
            unsub();

            hosted.transport.sendSnapshot(joined.localPlayerId, makeSnapshot(joined.localPlayerId));
            expect(received).toHaveLength(0);
        });
    });

    // ─── Action receipt ───────────────────────────────────────────────────────

    describe('action receipt', () => {
        it('client sendAction is received by the host', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let receivedFrom!: PlayerId;
            let receivedAction!: EngineAction;
            hosted.transport.onActionReceived((from, action) => {
                receivedFrom = from;
                receivedAction = action;
            });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            const action = makeAction(joined.localPlayerId);
            joined.transport.sendAction(action);

            expect(receivedFrom).toBe(joined.localPlayerId);
            expect(receivedAction.type).toBe('test:noop');
        });

        it('unsubscribing from onActionReceived stops delivery', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const actions: EngineAction[] = [];
            const unsub = hosted.transport.onActionReceived((_from, action) => {
                actions.push(action);
            });
            unsub();

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            joined.transport.sendAction(makeAction(toPlayerId('p1')));

            expect(actions).toHaveLength(0);
        });
    });

    // ─── Spectate-target receipt ────────────────────────────────────────────────

    describe('spectate-target receipt', () => {
        it('client sendSpectateTarget is received by the host with the connection-derived sender', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let receivedFrom!: PlayerId;
            let receivedTarget!: PlayerId;
            hosted.transport.onSpectateTargetUpdate((from, targetPlayerId) => {
                receivedFrom = from;
                receivedTarget = targetPlayerId;
            });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            joined.transport.sendSpectateTarget(toPlayerId('seat-2'));

            expect(receivedFrom).toBe(joined.localPlayerId);
            expect(receivedTarget).toBe(toPlayerId('seat-2'));
        });

        it('unsubscribing from onSpectateTargetUpdate stops delivery', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const targets: PlayerId[] = [];
            const unsub = hosted.transport.onSpectateTargetUpdate((_from, targetPlayerId) => {
                targets.push(targetPlayerId);
            });
            unsub();

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            joined.transport.sendSpectateTarget(toPlayerId('seat-2'));

            expect(targets).toHaveLength(0);
        });
    });

    // ─── Side-channel ─────────────────────────────────────────────────────────

    describe('side-channel', () => {
        it('host sendSideChannel broadcast is received by connected clients', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const received: SideChannelMessage[] = [];
            joined.transport.onSideChannelReceived((msg) => received.push(msg));

            const msg = makeChatSideChannel('hello');
            hosted.transport.sendSideChannel('broadcast', msg);

            expect(received).toHaveLength(1);
            expect(received[0]?.kind).toBe('chat');
        });

        it('client sendSideChannel is received by the host', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let fromHost!: PlayerId;
            let receivedMsg!: SideChannelMessage;
            hosted.transport.onSideChannelReceived((from, msg) => {
                fromHost = from;
                receivedMsg = msg;
            });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            const msg = makeChatSideChannel('ping');
            joined.transport.sendSideChannel(msg);

            expect(fromHost).toBe(joined.localPlayerId);
            expect(receivedMsg.kind).toBe('chat');
        });
    });

    // ─── Lobby state broadcast ────────────────────────────────────────────────

    describe('lobby state broadcast', () => {
        it('joinLobby seeds initialLobbyState immediately with the joined player included', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            expect(joined.initialLobbyState.info.sessionId).toBe(hosted.lobbyCode);
            expect(joined.initialLobbyState.players).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ playerId: joined.localPlayerId }),
                ]),
            );
        });

        it('second join initialLobbyState includes previously joined players under rapid joins', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            const joinedA = await provider.joinLobby({ address: hosted.lobbyCode });
            const joinedB = await provider.joinLobby({ address: hosted.lobbyCode });

            expect(joinedB.initialLobbyState.players).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ playerId: hosted.lobbyInfo.hostId }),
                    expect.objectContaining({ playerId: joinedA.localPlayerId }),
                    expect.objectContaining({ playerId: joinedB.localPlayerId }),
                ]),
            );
        });

        it('host onPlayerJoined callback runs after await joinLobby continuation', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let callbackFired = false;
            hosted.transport.onPlayerJoined(() => {
                callbackFired = true;
            });

            await provider.joinLobby({ address: hosted.lobbyCode });

            expect(callbackFired).toBe(false);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(callbackFired).toBe(true);
        });

        it('host broadcastLobbyState is received by the client', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let joinedPlayerId!: PlayerId;
            hosted.transport.onPlayerJoined((p) => {
                joinedPlayerId = p.playerId;
            });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const states: unknown[] = [];
            joined.transport.onLobbyStateChanged((s) => states.push(s));

            hosted.transport.broadcastLobbyState({
                info: {
                    sessionId: hosted.lobbyCode,
                    hostId: toPlayerId('host-1'),
                    gameId: 'tactics',
                },
                players: [{ playerId: joinedPlayerId, displayName: 'Alice', ready: false }],
            });

            expect(states).toHaveLength(1);
        });
    });

    // ─── Disconnect handling ──────────────────────────────────────────────────

    describe('disconnect handling', () => {
        it('close() on hosted session fires onDisconnected on the client', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const reasons: DisconnectReason[] = [];
            joined.transport.onDisconnected((r) => reasons.push(r));

            await hosted.close();
            expect(reasons).toHaveLength(1);
            expect(reasons[0]).toBe('host_closed');
        });

        it('disconnect() on joined session fires onPlayerLeft on the host', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

            let leftPlayerId!: PlayerId;
            let leftReason!: DisconnectReason;
            hosted.transport.onPlayerLeft((id, reason) => {
                leftPlayerId = id;
                leftReason = reason;
            });

            const joined = await provider.joinLobby({ address: hosted.lobbyCode });
            await joined.disconnect();

            expect(leftPlayerId).toBe(joined.localPlayerId);
            expect(leftReason).toBe('normal');
        });
    });

    // ─── dispose ─────────────────────────────────────────────────────────────

    describe('dispose', () => {
        it('dispose() closes all active sessions without throwing', async () => {
            const provider = new InMemoryMultiplayerProvider();
            await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            await provider.hostLobby({ gameId: 'chess', maxPlayers: 2 });
            expect(() => provider.dispose()).not.toThrow();
        });

        it('dispose() is idempotent — calling twice does not throw', () => {
            const provider = new InMemoryMultiplayerProvider();
            expect(() => {
                provider.dispose();
                provider.dispose();
            }).not.toThrow();
        });

        it('dispose() fires onDisconnected on all connected clients', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const reasons: DisconnectReason[] = [];
            joined.transport.onDisconnected((r) => reasons.push(r));

            provider.dispose();
            expect(reasons).toHaveLength(1);
        });

        it('joinLobby rejects after the session is disposed', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const code = hosted.lobbyCode;
            provider.dispose();
            await expect(provider.joinLobby({ address: code })).rejects.toThrow();
        });
    });

    // ─── isBrowsable ─────────────────────────────────────────────────────────

    describe('isBrowsable', () => {
        it('InMemoryMultiplayerProvider does not implement BrowsableProvider', async () => {
            // Tested via the isBrowsable() helper imported from MultiplayerProvider
            // The structural assertion is: InMemoryMultiplayerProvider has no listLobbies()
            const provider = new InMemoryMultiplayerProvider();
            expect(typeof (provider as unknown as Record<string, unknown>)['listLobbies']).not.toBe(
                'function',
            );
        });
    });

    // ─── Reveal delivery ──────────────────────────────────────────────────────

    describe('reveal delivery', () => {
        function makeReveal(): WireCommitmentReveal {
            return { id: 'commitment-1', value: 42, nonce: 'abc' };
        }

        it('host sendReveal unicast is received by the target client only', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joinedA = await provider.joinLobby({ address: hosted.lobbyCode });
            const joinedB = await provider.joinLobby({ address: hosted.lobbyCode });

            const receivedByA: WireCommitmentReveal[] = [];
            const receivedByB: WireCommitmentReveal[] = [];
            joinedA.transport.onReveal((r) => receivedByA.push(r));
            joinedB.transport.onReveal((r) => receivedByB.push(r));

            const reveal = makeReveal();
            hosted.transport.sendReveal(joinedA.localPlayerId, reveal);

            expect(receivedByA).toHaveLength(1);
            expect(receivedByA[0]).toEqual(reveal);
            expect(receivedByB).toHaveLength(0);
        });

        it('host sendReveal broadcast is received by all clients', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joinedA = await provider.joinLobby({ address: hosted.lobbyCode });
            const joinedB = await provider.joinLobby({ address: hosted.lobbyCode });

            const receivedByA: WireCommitmentReveal[] = [];
            const receivedByB: WireCommitmentReveal[] = [];
            joinedA.transport.onReveal((r) => receivedByA.push(r));
            joinedB.transport.onReveal((r) => receivedByB.push(r));

            const reveal = makeReveal();
            hosted.transport.sendReveal('broadcast', reveal);

            expect(receivedByA).toHaveLength(1);
            expect(receivedByB).toHaveLength(1);
        });

        it('unsubscribing from onReveal stops delivery', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const received: WireCommitmentReveal[] = [];
            const unsub = joined.transport.onReveal((r) => received.push(r));
            unsub();

            hosted.transport.sendReveal(joined.localPlayerId, makeReveal());
            expect(received).toHaveLength(0);
        });
    });

    // ─── Unsub helpers are callable without side effects ─────────────────────

    describe('unsubscribe helpers', () => {
        it('all onX methods return a callable Unsubscribe function', async () => {
            const provider = new InMemoryMultiplayerProvider();
            const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
            const joined = await provider.joinLobby({ address: hosted.lobbyCode });

            const hostUnsubs = [
                hosted.transport.onActionReceived(vi.fn()),
                hosted.transport.onSideChannelReceived(vi.fn()),
                hosted.transport.onPlayerJoined(vi.fn()),
                hosted.transport.onPlayerLeft(vi.fn()),
            ];

            const clientUnsubs = [
                joined.transport.onSnapshotReceived(vi.fn()),
                joined.transport.onSideChannelReceived(vi.fn()),
                joined.transport.onReveal(vi.fn()),
                joined.transport.onLobbyStateChanged(vi.fn()),
                joined.transport.onDisconnected(vi.fn()),
                joined.transport.onLatencyUpdate(vi.fn()),
            ];

            expect(() => {
                for (const unsub of [...hostUnsubs, ...clientUnsubs]) unsub();
            }).not.toThrow();
        });
    });
});

// ─── Spectator admission (join classifier — Invariant #114) ──────────────────

describe('InMemoryMultiplayerProvider — spectator admission (Invariant #114)', () => {
    it('defaults JoinedSession.role to "player" with no classifier', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

        const joined = await provider.joinLobby({ address: hosted.lobbyCode });

        expect(joined.role).toBe('player');
    });

    it('admits a classified spectator with JoinedSession.role === "spectator"', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));

        const joined = await provider.joinLobby({ address: hosted.lobbyCode });

        expect(joined.role).toBe('spectator');
    });

    it('rejects with match_in_progress when the classifier rejects', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ reject: 'match_in_progress' }));

        await expect(provider.joinLobby({ address: hosted.lobbyCode })).rejects.toMatchObject({
            reason: 'match_in_progress',
        });
    });

    it('rejects with spectators_disabled when the classifier rejects', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ reject: 'spectators_disabled' }));

        await expect(provider.joinLobby({ address: hosted.lobbyCode })).rejects.toMatchObject({
            reason: 'spectators_disabled',
        });
    });

    it('keeps a spectator out of the lobby roster and does not consume player capacity', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 1 });

        // A normal player fills the single seat.
        const player = await provider.joinLobby({ address: hosted.lobbyCode });

        // Every further join is a spectator; a full player lobby still admits it.
        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));
        const spectator = await provider.joinLobby({ address: hosted.lobbyCode });

        expect(spectator.role).toBe('spectator');
        const rosterIds = spectator.initialLobbyState.players.map((p) => p.playerId);
        expect(rosterIds).toContain(player.localPlayerId);
        expect(rosterIds).not.toContain(spectator.localPlayerId);
    });

    it('excludes spectators from host broadcasts (parity with LobbyServer.broadcast)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });

        const player = await provider.joinLobby({ address: hosted.lobbyCode });
        const playerStates: unknown[] = [];
        player.transport.onLobbyStateChanged((s) => playerStates.push(s));

        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));
        const spectator = await provider.joinLobby({ address: hosted.lobbyCode });
        const spectatorStates: unknown[] = [];
        spectator.transport.onLobbyStateChanged((s) => spectatorStates.push(s));

        hosted.transport.broadcastLobbyState(player.initialLobbyState);

        // The seated player receives the broadcast; the spectator (no seat) does not.
        expect(playerStates).toHaveLength(1);
        expect(spectatorStates).toHaveLength(0);
    });

    it('delivers unicast snapshots and ticks to a spectator (perspective-broadcast transport pin)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));

        const spectator = await provider.joinLobby({ address: hosted.lobbyCode });
        const snapshots: unknown[] = [];
        const ticks: number[] = [];
        spectator.transport.onSnapshotReceived((snap) => snapshots.push(snap));
        spectator.transport.onTickReceived((tick) => ticks.push(tick));

        hosted.transport.sendSnapshot(
            spectator.localPlayerId,
            makeSnapshot(spectator.localPlayerId),
        );
        hosted.transport.sendTick(spectator.localPlayerId, 7);

        expect(snapshots).toHaveLength(1);
        expect(ticks).toEqual([7]);
    });

    it('notifies the host of a joining spectator with role="spectator"', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));

        const joined: LobbyPlayerEntry[] = [];
        hosted.transport.onPlayerJoined((player) => joined.push(player));

        await provider.joinLobby({ address: hosted.lobbyCode });
        // playerJoinedCbs fire on the next macrotask.
        await new Promise((r) => setTimeout(r, 0));

        expect(joined).toHaveLength(1);
        expect(joined[0]?.role).toBe('spectator');
    });

    it('enforces the maxSpectators cap', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hosted = await provider.hostLobby({ gameId: 'tactics', maxPlayers: 4 });
        hosted.transport.setJoinClassifier(() => ({ role: 'spectator' }));

        for (let i = 0; i < DEFAULT_MAX_SPECTATORS; i += 1) {
            const s = await provider.joinLobby({ address: hosted.lobbyCode });
            expect(s.role).toBe('spectator');
        }

        await expect(provider.joinLobby({ address: hosted.lobbyCode })).rejects.toMatchObject({
            reason: 'match_in_progress',
        });
    });
});
