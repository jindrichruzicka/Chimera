/**
 * electron/main/__tests__/obfuscation.integration.test.ts
 *
 * Integration test for IPC payload obfuscation.
 *
 * Verifies that StateBroadcaster correctly masks owner-only fields when
 * projecting GameSnapshot to PlayerSnapshot via a real StateProjector wired
 * with visibility rules. The test captures the IPC-delivered payload and
 * asserts it passes assertNoLeakedFields — ensuring no opponent's owner-only
 * fields leak through any IPC channel (Invariant #3, F28 coverage).
 *
 * Architecture: §4.6 (StateProjector / VisibilityRules), §4.14 (StateBroadcaster)
 * Invariants verified:
 *   #3  — Only PlayerSnapshot crosses IPC boundary; GameSnapshot stays host-local
 *   #8  — StateProjector.project() is the mandatory gate for outbound snapshots
 *   #67 — Logger and mocks only; no assertion on exact log calls
 *
 * Tests written first (red confirmed before implementation).
 */

import { describe, expect, it, vi } from 'vitest';
import type {
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { DefaultStateProjector } from '@chimera/simulation/projection/StateProjector.js';
import { assertNoLeakedFields } from '@chimera/simulation/projection/assertNoLeakedFields.js';
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';
import type { HostTransport } from '@chimera/networking/provider/MultiplayerProvider.js';
import { createNoopLogger } from '../logging/logger.js';
import { StateBroadcaster } from '../runtime/StateBroadcaster.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';

// ──── Test data models ──────────────────────────────────────────────────────────

/**
 * Extended player state with owner-only field for testing masking.
 * Non-owners should not see the `secretPlan` field.
 */
interface TestPlayerState extends BasePlayerState {
    readonly name: string;
    readonly secretPlan: string; // owner-only
}

interface TestGameSnapshot extends BaseGameSnapshot {
    readonly players: Record<PlayerId, TestPlayerState>;
}

// ──── Helpers ──────────────────────────────────────────────────────────────────

const HOST_PLAYER_ID = toPlayerId('host-player');
const OPPONENT_PLAYER_ID = toPlayerId('opponent-player');
const ALL_PLAYER_IDS = [HOST_PLAYER_ID, OPPONENT_PLAYER_ID] as const;

function makeTestSnapshot(): TestGameSnapshot {
    return {
        tick: 5,
        seed: 12345,
        phase: gamePhase('playing'),
        turnNumber: 1,
        timers: {},
        events: [],
        players: {
            [HOST_PLAYER_ID]: {
                id: HOST_PLAYER_ID,
                name: 'Host',
                secretPlan: 'build-towers', // host's owner-only data
            },
            [OPPONENT_PLAYER_ID]: {
                id: OPPONENT_PLAYER_ID,
                name: 'Opponent',
                secretPlan: 'rush-attack', // opponent's owner-only data (must be masked from host)
            },
        },
        entities: {},
        matchResult: null,
    };
}

function makeTransport(): HostTransport {
    return {
        sendSnapshot: vi.fn(),
        broadcastLobbyState: vi.fn(),
        sendSideChannel: vi.fn(),
        sendReveal: vi.fn(),
        onActionReceived: vi.fn(() => () => {}),
        onReadyStateUpdate: vi.fn(() => () => {}),
        onSideChannelReceived: vi.fn(() => () => {}),
        onPlayerJoined: vi.fn(() => () => {}),
        onPlayerLeft: vi.fn(() => () => {}),
        setProfileGate: vi.fn(),
    };
}

/**
 * Visibility rules for testing: mask opponent's secretPlan (owner-only field).
 * Host sees their own secretPlan but not opponent's.
 */
const maskingVisibilityRules: VisibilityRules<TestGameSnapshot, BaseEntityState, TestPlayerState> =
    {
        isEntityVisible() {
            return true;
        },
        maskEntity(entity) {
            return entity;
        },
        maskPlayerState(player, viewer) {
            // Mask opponent's owner-only field
            if (player.id !== viewer) {
                return {
                    id: player.id,
                    name: player.name,
                    secretPlan: null as unknown as string, // null sentinel for masked field
                };
            }
            // Owner sees their own secretPlan
            return player;
        },
        filterEvents(events) {
            return events;
        },
    };

// ──── Integration tests ────────────────────────────────────────────────────────

describe('StateBroadcaster IPC payload obfuscation (F28 coverage)', () => {
    it('uses DefaultStateProjector to mask owner-only fields before sending IPC snapshot', () => {
        const transport = makeTransport();
        const projector = new DefaultStateProjector(maskingVisibilityRules);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        const snapshot = makeTestSnapshot();

        // Broadcast host's view
        broadcaster.broadcast(snapshot, HOST_PLAYER_ID);

        // Capture the IPC payload sent to host
        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        const [_, hostPayload] = (transport.sendSnapshot as any).mock.calls[0];

        // Host's own secretPlan should be visible
        expect(hostPayload.players[HOST_PLAYER_ID]).toBeDefined();
        expect(hostPayload.players[HOST_PLAYER_ID].secretPlan).toBe('build-towers');

        // Opponent's secretPlan should be masked (not in owner context)
        // After masking, assertNoLeakedFields should pass
        assertNoLeakedFields(hostPayload, HOST_PLAYER_ID, ALL_PLAYER_IDS);
    });

    it('ensures no opponent owner-only fields leak through broadcaster IPC when host receives its own snapshot', () => {
        const transport = makeTransport();
        const projector = new DefaultStateProjector(maskingVisibilityRules);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        const snapshot = makeTestSnapshot();

        broadcaster.broadcast(snapshot, HOST_PLAYER_ID);

        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        const [recipientId, payload] = (transport.sendSnapshot as any).mock.calls[0];

        expect(recipientId).toBe(HOST_PLAYER_ID);

        // This is the critical assertion: the sent snapshot must pass assertNoLeakedFields
        // so that any regression in VisibilityRules wiring or StateProjector would be caught
        assertNoLeakedFields(payload as PlayerSnapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS);
    });

    it('applies projection gate to both remote transport and local renderer recipients', () => {
        const transport = makeTransport();
        const projector = new DefaultStateProjector(maskingVisibilityRules);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        const hostWebContents = {
            send: vi.fn<(channel: string, snapshot: PlayerSnapshot) => void>(),
        };

        const GAME_SNAPSHOT_CHANNEL = 'game-snapshot';

        broadcaster.registerRendererRecipient({
            viewerId: HOST_PLAYER_ID,
            sendSnapshot: (snapshot) => {
                hostWebContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
            },
        });

        const snapshot = makeTestSnapshot();
        broadcaster.broadcast(snapshot, HOST_PLAYER_ID);

        // Verify transport.sendSnapshot was called
        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        const [_, transportPayload] = (transport.sendSnapshot as any).mock.calls[0];

        // Verify renderer recipient was called
        expect(hostWebContents.send).toHaveBeenCalledOnce();
        const [channel, rendererPayload] = (hostWebContents.send as any).mock.calls[0];
        expect(channel).toBe(GAME_SNAPSHOT_CHANNEL);

        // Both transport and renderer payloads must pass assertNoLeakedFields
        assertNoLeakedFields(transportPayload as PlayerSnapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS);
        assertNoLeakedFields(rendererPayload as PlayerSnapshot, HOST_PLAYER_ID, ALL_PLAYER_IDS);
    });
});
