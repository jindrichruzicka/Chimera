/**
 * electron/main/lobby/LobbyManager.joinClaims.test.ts
 *
 * Unit tests for the `resolveJoinClaims` LobbyManager option (F68 #822):
 * joinLobby merges composition-root-supplied seat claims into the params it
 * hands the provider — so a returning client presents its remembered seat on
 * a restored session (#821) — without ever overriding caller-supplied claims,
 * and a resolver failure degrades to a claimless join instead of blocking it.
 *
 * Uses InMemoryMultiplayerProvider so no real network or WebSocket is involved.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryMultiplayerProvider } from '@chimera-engine/networking/provider/InMemoryMultiplayerProvider.js';
import type {
    HostLobbyParams,
    JoinLobbyParams,
    MultiplayerProvider,
    SeatClaim,
} from '@chimera-engine/networking';
import { createNoopLogger } from '../logging/logger.js';
import { LobbyManager, type LobbyManagerOptions } from './LobbyManager.js';

const HOST_PARAMS: HostLobbyParams = { gameId: 'tactics', maxPlayers: 2 };

/**
 * Wraps an InMemoryMultiplayerProvider so tests can observe the exact
 * JoinLobbyParams the manager hands to the provider.
 */
function makeCapturingProvider(inner = new InMemoryMultiplayerProvider()): {
    provider: MultiplayerProvider;
    joins: JoinLobbyParams[];
} {
    const joins: JoinLobbyParams[] = [];
    const provider: MultiplayerProvider = {
        hostLobby: (params) => inner.hostLobby(params),
        async joinLobby(params) {
            joins.push(params);
            return inner.joinLobby(params);
        },
        dispose: () => inner.dispose(),
    };
    return { provider, joins };
}

async function hostAndJoin(
    options: LobbyManagerOptions,
    joinParamsExtra: Partial<JoinLobbyParams> = {},
): Promise<{ joins: JoinLobbyParams[] }> {
    const inner = new InMemoryMultiplayerProvider();
    const { provider, joins } = makeCapturingProvider(inner);

    const hostManager = new LobbyManager(inner, createNoopLogger());
    const hostInfo = await hostManager.hostLobby(HOST_PARAMS);

    const joinManager = new LobbyManager(provider, createNoopLogger(), options);
    await joinManager.joinLobby({ address: hostInfo.sessionId, ...joinParamsExtra });

    await joinManager.closeLobby();
    await hostManager.closeLobby();
    return { joins };
}

describe('LobbyManager.joinLobby — resolveJoinClaims (#822)', () => {
    it('merges resolved claims into the params handed to the provider', async () => {
        const claims: readonly SeatClaim[] = [{ matchId: 'match-a', playerId: 'p-alice' }];

        const { joins } = await hostAndJoin({ resolveJoinClaims: async () => claims });

        expect(joins[0]?.claims).toStrictEqual(claims);
    });

    it('leaves the claims key absent when the resolver returns undefined', async () => {
        const { joins } = await hostAndJoin({ resolveJoinClaims: async () => undefined });

        expect(joins[0] !== undefined && 'claims' in joins[0]).toBe(false);
    });

    it('leaves the claims key absent when no resolver is configured', async () => {
        const { joins } = await hostAndJoin({});

        expect(joins[0] !== undefined && 'claims' in joins[0]).toBe(false);
    });

    it('does not consult the resolver when the caller already supplied claims', async () => {
        const callerClaims: readonly SeatClaim[] = [{ matchId: 'match-b', playerId: 'p-bob' }];
        const resolver = vi.fn(
            async (): Promise<readonly SeatClaim[]> => [
                { matchId: 'match-a', playerId: 'p-alice' },
            ],
        );

        const { joins } = await hostAndJoin(
            { resolveJoinClaims: resolver },
            { claims: callerClaims },
        );

        expect(resolver).not.toHaveBeenCalled();
        expect(joins[0]?.claims).toStrictEqual(callerClaims);
    });

    it('proceeds with a claimless join when the resolver rejects', async () => {
        const { joins } = await hostAndJoin({
            resolveJoinClaims: async () => {
                throw new Error('ticket store on fire');
            },
        });

        expect(joins).toHaveLength(1);
        expect(joins[0] !== undefined && 'claims' in joins[0]).toBe(false);
    });
});
