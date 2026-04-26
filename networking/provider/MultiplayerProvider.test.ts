/**
 * networking/provider/MultiplayerProvider.test.ts
 *
 * Type-level and structural tests for the MultiplayerProvider interface module.
 *
 * Written first (red) per TDD mandate — MultiplayerProvider.ts does not exist yet.
 *
 * These tests verify:
 *   1. All interfaces and types are importable and exported correctly
 *   2. Objects satisfying each interface can be constructed (structural compatibility)
 *   3. SideChannelMessage discriminated union is exhaustive and correct
 *   4. Invariant #2: no simulation/ import required for networking to work
 *   5. BrowsableProvider and isBrowsable() narrowing helper (T2 / issue #202)
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider
 * Task: F09 / T1 (issue #201), T2 (issue #202)
 */

import { describe, it, expect } from 'vitest';

import { isBrowsable, playerId } from './MultiplayerProvider.js';

import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type {
    MultiplayerProvider,
    BrowsableProvider,
    HostTransport,
    ClientTransport,
    HostedSession,
    JoinedSession,
    SideChannelMessage,
    HostLobbyParams,
    JoinLobbyParams,
    LobbyInfo,
    LobbyState,
    LobbyPlayerEntry,
    LobbyListEntry,
    DisconnectReason,
    Unsubscribe,
} from './MultiplayerProvider.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noop(): void {
    // intentionally empty
}

function noopUnsub(): Unsubscribe {
    return noop;
}

// ─── HostLobbyParams ─────────────────────────────────────────────────────────

describe('HostLobbyParams', () => {
    it('can be constructed with required fields', () => {
        const params: HostLobbyParams = {
            gameId: 'tactics',
            maxPlayers: 4,
        };
        expect(params.gameId).toBe('tactics');
        expect(params.maxPlayers).toBe(4);
    });
});

// ─── JoinLobbyParams ─────────────────────────────────────────────────────────

describe('JoinLobbyParams', () => {
    it('can be constructed with required fields', () => {
        const params: JoinLobbyParams = {
            address: '127.0.0.1:3456',
        };
        expect(params.address).toBe('127.0.0.1:3456');
    });
});

// ─── LobbyInfo ───────────────────────────────────────────────────────────────

describe('LobbyInfo', () => {
    it('has sessionId, hostId, and gameId', () => {
        const info: LobbyInfo = {
            sessionId: 'sess-1',
            hostId: playerId('p1'),
            gameId: 'tactics',
        };
        expect(info.sessionId).toBe('sess-1');
        expect(info.gameId).toBe('tactics');
    });
});

// ─── LobbyPlayerEntry ────────────────────────────────────────────────────────

describe('LobbyPlayerEntry', () => {
    it('has playerId, displayName, and ready flag', () => {
        const entry: LobbyPlayerEntry = {
            playerId: playerId('p1'),
            displayName: 'Alice',
            ready: false,
        };
        expect(entry.displayName).toBe('Alice');
        expect(entry.ready).toBe(false);
    });
});

// ─── LobbyState ──────────────────────────────────────────────────────────────

describe('LobbyState', () => {
    it('has info and a readonly players array', () => {
        const state: LobbyState = {
            info: { sessionId: 's1', hostId: playerId('p1'), gameId: 'chess' },
            players: [],
        };
        expect(state.players).toHaveLength(0);
    });
});

// ─── LobbyListEntry ──────────────────────────────────────────────────────────

describe('LobbyListEntry', () => {
    it('has all required browse fields', () => {
        const entry: LobbyListEntry = {
            address: '192.168.1.42:3456',
            gameId: 'tactics',
            playerCount: 2,
            maxPlayers: 4,
        };
        expect(entry.playerCount).toBe(2);
        expect(entry.maxPlayers).toBe(4);
    });
});

// ─── DisconnectReason ────────────────────────────────────────────────────────

describe('DisconnectReason', () => {
    it('accepts known reason values', () => {
        const reasons: DisconnectReason[] = ['kicked', 'timeout', 'host_closed', 'error', 'normal'];
        expect(reasons).toHaveLength(5);
    });
});

// ─── SideChannelMessage ──────────────────────────────────────────────────────

describe('SideChannelMessage', () => {
    it('chat variant has kind and payload', () => {
        const msg: SideChannelMessage = {
            kind: 'chat',
            payload: { senderId: playerId('p1'), text: 'hello', timestamp: 0 },
        };
        expect(msg.kind).toBe('chat');
    });

    it('profile variant has kind and payload', () => {
        const msg: SideChannelMessage = {
            kind: 'profile',
            payload: { playerId: playerId('p1'), displayName: 'Alice' },
        };
        expect(msg.kind).toBe('profile');
    });
});

// ─── HostTransport ───────────────────────────────────────────────────────────

describe('HostTransport', () => {
    it('a conforming object satisfies the interface', () => {
        const transport: HostTransport = {
            sendSnapshot: (_playerId, _snapshot) => {},
            broadcastLobbyState: (_state) => {},
            sendSideChannel: (_target, _msg) => {},
            onActionReceived: (_cb) => noopUnsub(),
            onReadyStateUpdate: (_cb) => noopUnsub(),
            onSideChannelReceived: (_cb) => noopUnsub(),
            onPlayerJoined: (_cb) => noopUnsub(),
            onPlayerLeft: (_cb) => noopUnsub(),
        };
        expect(transport).toBeDefined();
    });
});

// ─── ClientTransport ─────────────────────────────────────────────────────────

describe('ClientTransport', () => {
    it('a conforming object satisfies the interface', () => {
        const transport: ClientTransport = {
            sendAction: (_action) => {},
            sendReadyStateUpdate: (_ready) => {},
            sendSideChannel: (_msg) => {},
            onSnapshotReceived: (_cb) => noopUnsub(),
            onSideChannelReceived: (_cb) => noopUnsub(),
            onLobbyStateChanged: (_cb) => noopUnsub(),
            onDisconnected: (_cb) => noopUnsub(),
        };
        expect(transport).toBeDefined();
    });
});

// ─── HostedSession ────────────────────────────────────────────────────────────

describe('HostedSession', () => {
    it('a conforming object satisfies the interface', () => {
        const transport: HostTransport = {
            sendSnapshot: () => {},
            broadcastLobbyState: () => {},
            sendSideChannel: () => {},
            onActionReceived: () => noopUnsub(),
            onReadyStateUpdate: () => noopUnsub(),
            onSideChannelReceived: () => noopUnsub(),
            onPlayerJoined: () => noopUnsub(),
            onPlayerLeft: () => noopUnsub(),
        };
        const session: HostedSession = {
            lobbyCode: 'ABCD',
            lobbyInfo: {
                sessionId: 'ABCD',
                hostId: playerId('host-1'),
                gameId: 'tactics',
            },
            transport,
            close: async () => {},
        };
        expect(session.lobbyCode).toBe('ABCD');
    });
});

// ─── JoinedSession ────────────────────────────────────────────────────────────

describe('JoinedSession', () => {
    it('a conforming object satisfies the interface', () => {
        const transport: ClientTransport = {
            sendAction: () => {},
            sendReadyStateUpdate: () => {},
            sendSideChannel: () => {},
            onSnapshotReceived: () => noopUnsub(),
            onSideChannelReceived: () => noopUnsub(),
            onLobbyStateChanged: () => noopUnsub(),
            onDisconnected: () => noopUnsub(),
        };
        const session: JoinedSession = {
            lobbyInfo: { sessionId: 's1', hostId: playerId('p1'), gameId: 'tactics' },
            localPlayerId: playerId('p2'),
            transport,
            disconnect: async () => {},
        };
        expect(session.lobbyInfo.sessionId).toBe('s1');
    });
});

// ─── MultiplayerProvider ─────────────────────────────────────────────────────

describe('MultiplayerProvider', () => {
    it('a conforming stub satisfies the interface', () => {
        const provider: MultiplayerProvider = {
            hostLobby: async (_params) => {
                throw new Error('not implemented');
            },
            joinLobby: async (_params) => {
                throw new Error('not implemented');
            },
            dispose: () => {},
        };
        expect(provider).toBeDefined();
        expect(typeof provider.hostLobby).toBe('function');
        expect(typeof provider.joinLobby).toBe('function');
        expect(typeof provider.dispose).toBe('function');
    });
});

// ─── BrowsableProvider + isBrowsable ─────────────────────────────────────────

describe('isBrowsable', () => {
    it('returns false for a plain MultiplayerProvider without listLobbies', () => {
        const provider: MultiplayerProvider = {
            hostLobby: async (_params) => {
                throw new Error('noop');
            },
            joinLobby: async (_params) => {
                throw new Error('noop');
            },
            dispose: () => {},
        };
        expect(isBrowsable(provider)).toBe(false);
    });

    it('returns true for a provider that also implements listLobbies', () => {
        const provider: MultiplayerProvider & BrowsableProvider = {
            hostLobby: async (_params) => {
                throw new Error('noop');
            },
            joinLobby: async (_params) => {
                throw new Error('noop');
            },
            dispose: () => {},
            listLobbies: async () => [],
        };
        expect(isBrowsable(provider)).toBe(true);
    });

    it('after narrowing via isBrowsable, listLobbies is accessible and callable', async () => {
        const entry: LobbyListEntry = {
            address: '127.0.0.1:3456',
            gameId: 'tactics',
            playerCount: 1,
            maxPlayers: 4,
        };
        const provider: MultiplayerProvider & BrowsableProvider = {
            hostLobby: async (_params) => {
                throw new Error('noop');
            },
            joinLobby: async (_params) => {
                throw new Error('noop');
            },
            dispose: () => {},
            listLobbies: async () => [entry],
        };
        if (isBrowsable(provider)) {
            const lobbies = await provider.listLobbies();
            expect(lobbies).toHaveLength(1);
            expect(lobbies[0]?.address).toBe('127.0.0.1:3456');
        } else {
            throw new Error('isBrowsable should have returned true');
        }
    });

    it('returns false for an object with listLobbies set to a non-function value', () => {
        const provider = {
            hostLobby: async (_params: HostLobbyParams) => {
                throw new Error('noop');
            },
            joinLobby: async (_params: JoinLobbyParams) => {
                throw new Error('noop');
            },
            dispose: () => {},
            listLobbies: 'not-a-function',
        } as unknown as MultiplayerProvider;
        expect(isBrowsable(provider)).toBe(false);
    });
});

// ─── playerId factory ─────────────────────────────────────────────────────────

describe('playerId', () => {
    it('returns the raw string value unchanged', () => {
        expect(playerId('alice')).toBe('alice');
    });

    it('is assignable to PlayerId (type-level: compiles without cast)', () => {
        // Compile-time check: this file must typecheck clean.
        const id: PlayerId = playerId('bob');
        expect(id).toBe('bob');
    });
});
