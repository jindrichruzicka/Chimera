/**
 * networking/provider/MultiplayerProvider.restore.contract.test.ts
 *
 * Shared contract suite for the restored-session seams (F68/#821): host-id
 * reclaim via `HostLobbyParams.restore`, seat reclaim via
 * `JoinLobbyParams.claims`, and the claimless join-order fallback.
 *
 * Runs against BOTH LocalWebSocketProvider and InMemoryMultiplayerProvider —
 * both invocations live at the bottom of THIS file (importing a test file
 * elsewhere would re-register its suites). Deliberately separate from the
 * legacy `testMultiplayerProviderContract` so LocalWebSocketProvider is not
 * wired into that suite here (out of #821's scope).
 *
 * Architecture: §4.14 — Multiplayer Provider & WebSocket
 * Task: F68 / #821
 *
 * Invariants upheld:
 *   #38/#39/#47 — provider-concrete imports stay inside networking/provider/
 */

import { describe, it, expect, afterEach } from 'vitest';

import { InMemoryMultiplayerProvider } from './InMemoryMultiplayerProvider.js';
import { LocalWebSocketProvider } from './local/LocalWebSocketProvider.js';
import { playerId as toPlayerId } from './MultiplayerProvider.js';
import type { HostedSession, MultiplayerProvider, SeatClaim } from './MultiplayerProvider.js';

// ─── Shared fixture ───────────────────────────────────────────────────────────

const savedHost = toPlayerId('saved-host');
const seatA = toPlayerId('seat-a');
const seatB = toPlayerId('seat-b');
const restoredSeatIds: readonly string[] = [savedHost, seatA, seatB];

const restore = {
    matchId: 'match-1',
    hostPlayerId: savedHost,
    // Non-host human seats, slotIndex-ascending (the caller contract).
    humanSeats: [seatA, seatB],
} as const;

const claimFor = (playerId: string, matchId = 'match-1'): SeatClaim => ({ matchId, playerId });

// ─── Contract test helper ─────────────────────────────────────────────────────

/**
 * Runs the restored-session seam contract against any conforming
 * implementation.
 */
export function testProviderRestoreContract(
    implName: string,
    factory: () => MultiplayerProvider,
): void {
    describe(`MultiplayerProvider restore contract — ${implName} (#821)`, () => {
        let provider: MultiplayerProvider | null = null;

        afterEach(() => {
            provider?.dispose();
            provider = null;
        });

        /** Host a lobby pre-seeded with the shared restored-session fixture. */
        function hostRestored(): Promise<HostedSession> {
            provider = factory();
            return provider.hostLobby({
                gameId: 'restore-contract',
                maxPlayers: 4,
                restore,
            });
        }

        it('mints the saved host id for the host and every joiner', async () => {
            const hosted = await hostRestored();
            expect(hosted.lobbyInfo.hostId).toBe(savedHost);

            const joined = await provider!.joinLobby({ address: hosted.lobbyCode });
            expect(joined.initialLobbyState.info.hostId).toBe(savedHost);
        });

        it('grants a claim whose matchId matches the restored session', async () => {
            const hosted = await hostRestored();
            const joined = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatB)],
            });
            expect(joined.localPlayerId).toBe(seatB);
        });

        it('mints a fresh id for a stale-matchId claim — never a restored seat', async () => {
            const hosted = await hostRestored();
            const joined = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA, 'some-other-match')],
            });
            expect(restoredSeatIds).not.toContain(joined.localPlayerId);
        });

        it('fills restored seats in slotIndex order for claimless joins, then mints fresh', async () => {
            const hosted = await hostRestored();
            const first = await provider!.joinLobby({ address: hosted.lobbyCode });
            const second = await provider!.joinLobby({ address: hosted.lobbyCode });
            const third = await provider!.joinLobby({ address: hosted.lobbyCode });
            expect(first.localPlayerId).toBe(seatA);
            expect(second.localPlayerId).toBe(seatB);
            expect(restoredSeatIds).not.toContain(third.localPlayerId);
        });

        it('does not let a connected seat be double-claimed', async () => {
            const hosted = await hostRestored();
            const holder = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA)],
            });
            expect(holder.localPlayerId).toBe(seatA);

            const intruder = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA)],
            });
            expect(restoredSeatIds).not.toContain(intruder.localPlayerId);
        });

        it('degrades out-of-bounds claims to a fresh id — never a crash or a seat', async () => {
            const hosted = await hostRestored();
            // 17 entries (over the 16 cap), every id overlong (over the 64 cap):
            // the sanitizer drops them all, and the empty-but-presented claims
            // must still suppress the claimless seat fallback.
            const bogus = Array.from({ length: 17 }, (_, i) =>
                claimFor(`${'x'.repeat(65)}-seat-${i}`, 'y'.repeat(65)),
            );
            const joined = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: bogus,
            });
            expect(restoredSeatIds).not.toContain(joined.localPlayerId);
        });

        it('does not grant a never-connected restored seat to a bare reconnectPlayerId', async () => {
            // Restored seats are reclaimed via matchId-proof claims; the
            // reconnect path only reclaims identities that actually connected
            // this session, so a stale ticket cannot hijack a saved seat. The
            // claimless join falls back to the lowest free seat instead.
            const hosted = await hostRestored();
            const joined = await provider!.joinLobby({
                address: hosted.lobbyCode,
                reconnectPlayerId: seatB,
            });
            expect(joined.localPlayerId).toBe(seatA);
        });

        it('honors a matchId-proof claim after the seat holder disconnected', async () => {
            const hosted = await hostRestored();
            const holder = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA)],
            });
            expect(holder.localPlayerId).toBe(seatA);
            await holder.disconnect();

            const reclaimer = await provider!.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA)],
            });
            expect(reclaimer.localPlayerId).toBe(seatA);
        });

        it('leaves non-restored lobbies untouched', async () => {
            provider = factory();
            const hosted = await provider.hostLobby({
                gameId: 'restore-contract',
                maxPlayers: 4,
            });
            expect(hosted.lobbyInfo.hostId).toBeTruthy();
            expect(hosted.lobbyInfo.hostId).not.toBe(savedHost);

            const joined = await provider.joinLobby({
                address: hosted.lobbyCode,
                claims: [claimFor(seatA)],
            });
            expect(restoredSeatIds).not.toContain(joined.localPlayerId);
        });
    });
}

// ─── Invocations — both providers, this file only ─────────────────────────────

testProviderRestoreContract('InMemoryMultiplayerProvider', () => new InMemoryMultiplayerProvider());
testProviderRestoreContract('LocalWebSocketProvider', () => new LocalWebSocketProvider());
