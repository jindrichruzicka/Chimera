/**
 * electron/main/__tests__/session-ticket-claims.integration.test.ts
 *
 * Integration test for the F68 #822 session-ticket loop, composing the same
 * pieces `electron/main/index.ts` wires in production — snapshot recorder →
 * SessionTicketStore → `resolveJoinClaims` — around a real LobbyManager and
 * InMemoryMultiplayerProvider (no real network, FS, or Electron IPC):
 *
 *   1. A client that received a matchId-carrying snapshot presents that
 *      `{matchId, playerId}` claim on its next joinLobby.
 *   2. A fresh client presents no claims at all (no `claims` key — presenting
 *      `[]` would opt it out of the host's claimless join-order fallback).
 *   3. Tickets for other games are not presented.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryMultiplayerProvider } from '@chimera-engine/networking/provider/InMemoryMultiplayerProvider.js';
import type {
    HostLobbyParams,
    HostTransport,
    JoinLobbyParams,
    MultiplayerProvider,
    PlayerSnapshot,
    SeatClaim,
} from '@chimera-engine/networking';
import { playerId } from '@chimera-engine/networking';
import { createNoopLogger } from '../logging/logger.js';
import { LobbyManager } from '../lobby/LobbyManager.js';
import { InMemorySessionTicketStore } from '../session/InMemorySessionTicketStore.js';
import type { SessionTicketStore } from '../session/SessionTicketStore.js';
import { createSnapshotTicketRecorder } from '../session/snapshot-ticket-recorder.js';

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };
const GAME_ID = 'tactics';

/** Mirror of the `resolveJoinClaims` wiring in `electron/main/index.ts`. */
function makeClaimsResolver(
    store: SessionTicketStore,
    gameId: string,
): () => Promise<readonly SeatClaim[] | undefined> {
    return async () => {
        const tickets = await store.claims();
        const relevant = tickets.filter((ticket) => ticket.gameId === gameId);
        return relevant.length > 0
            ? relevant.map(({ matchId, playerId: seat }) => ({ matchId, playerId: seat }))
            : undefined;
    };
}

function makeSnapshot(viewerId: string, matchId?: string): PlayerSnapshot {
    return {
        tick: 1,
        viewerId: playerId(viewerId),
        players: {},
        entities: {},
        phase: 'playing',
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...(matchId !== undefined ? { matchId } : {}),
    };
}

async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One "client machine": a LobbyManager wired with the recorder and claims
 * resolver around the given ticket store, joining through a provider wrapper
 * that captures the exact JoinLobbyParams handed down.
 */
function makeClient(
    inner: InMemoryMultiplayerProvider,
    store: SessionTicketStore,
): { manager: LobbyManager; joins: JoinLobbyParams[] } {
    const joins: JoinLobbyParams[] = [];
    const capturing: MultiplayerProvider = {
        hostLobby: (params) => inner.hostLobby(params),
        async joinLobby(params) {
            joins.push(params);
            return inner.joinLobby(params);
        },
        dispose: () => inner.dispose(),
    };
    const recordTicket = createSnapshotTicketRecorder({
        store,
        gameId: GAME_ID,
        now: () => 1_700_000_000_000,
    });
    const manager = new LobbyManager(capturing, createNoopLogger(), {
        onClientSnapshotReceived: (snapshot) => {
            recordTicket(snapshot);
        },
        resolveJoinClaims: makeClaimsResolver(store, GAME_ID),
    });
    return { manager, joins };
}

describe('session-ticket claims loop (#822)', () => {
    it('a client that received a matchId-carrying snapshot presents that claim on its next join', async () => {
        const provider = new InMemoryMultiplayerProvider();
        let hostTransport: HostTransport | null = null;
        const hostManager = new LobbyManager(provider, createNoopLogger(), {
            onSessionHosted: (transport) => {
                hostTransport = transport;
            },
        });
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const store = new InMemorySessionTicketStore();
        const client = makeClient(provider, store);

        // First join: fresh client — no claims key at all.
        await client.manager.joinLobby({ address: hostInfo.sessionId });
        expect(client.joins[0] !== undefined && 'claims' in client.joins[0]).toBe(false);

        // Host sends the client a snapshot carrying the match identity (#820).
        const seat = client.manager.getLocalPlayerId();
        expect(seat).not.toBeNull();
        expect(hostTransport).not.toBeNull();
        hostTransport!.sendSnapshot(seat!, makeSnapshot(String(seat), 'match-restored'));
        await flushMicrotasks();

        // Rejoin: the remembered seat is presented as a JOIN claim.
        await client.manager.closeLobby();
        await client.manager.joinLobby({ address: hostInfo.sessionId });

        expect(client.joins[1]?.claims).toStrictEqual([
            { matchId: 'match-restored', playerId: String(seat) },
        ]);

        await client.manager.closeLobby();
        await hostManager.closeLobby();
    });

    it('a fresh client presents no claims', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hostManager = new LobbyManager(provider, createNoopLogger());
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const client = makeClient(provider, new InMemorySessionTicketStore());
        await client.manager.joinLobby({ address: hostInfo.sessionId });

        expect(client.joins[0] !== undefined && 'claims' in client.joins[0]).toBe(false);

        await client.manager.closeLobby();
        await hostManager.closeLobby();
    });

    it('tickets recorded for another game are not presented', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const hostManager = new LobbyManager(provider, createNoopLogger());
        const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

        const store = new InMemorySessionTicketStore();
        await store.record({
            matchId: 'match-other',
            playerId: 'p-elsewhere',
            gameId: 'some-other-game',
            updatedAt: 1,
        });
        const client = makeClient(provider, store);

        await client.manager.joinLobby({ address: hostInfo.sessionId });

        // Other-game tickets say nothing about this game's sessions — the key
        // must stay absent so the claimless fallback remains available.
        expect(client.joins[0] !== undefined && 'claims' in client.joins[0]).toBe(false);

        await client.manager.closeLobby();
        await hostManager.closeLobby();
    });
});
