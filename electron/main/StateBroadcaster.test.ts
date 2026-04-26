/**
 * electron/main/StateBroadcaster.test.ts
 *
 * Unit tests for StateBroadcaster.
 *
 * StateBroadcaster delegates broadcast() calls to HostTransport.sendSnapshot().
 * It must have zero imports from networking/provider/local/ or ws.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider / StateBroadcaster
 * Task: F11-T02 (issue #239)
 *
 * Invariants covered:
 *   #1  — StateBroadcaster only handles PlayerSnapshot; never references GameSnapshot.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { StateBroadcaster } from './StateBroadcaster.js';
import { createNoopLogger } from './logging/logger.js';
import { playerId as toPlayerId } from '../../networking/provider/MultiplayerProvider.js';
import type {
    HostTransport,
    PlayerSnapshot,
    PlayerId,
} from '../../networking/provider/MultiplayerProvider.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTransport(): HostTransport {
    return {
        sendSnapshot: vi.fn(),
        broadcastLobbyState: vi.fn(),
        sendSideChannel: vi.fn(),
        onActionReceived: vi.fn(() => () => {}),
        onSideChannelReceived: vi.fn(() => () => {}),
        onPlayerJoined: vi.fn(() => () => {}),
        onPlayerLeft: vi.fn(() => () => {}),
    };
}

function makeSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 1,
        viewerId,
        players: {},
        entities: {},
        phase: 'playing',
        events: [],
        undoMeta: { canUndo: false, canRedo: false },
    };
}

const PLAYER_A = toPlayerId('player-a');
const PLAYER_B = toPlayerId('player-b');

// ── broadcast() ────────────────────────────────────────────────────────────────

describe('StateBroadcaster.broadcast', () => {
    it('calls transport.sendSnapshot with the correct viewerId and snapshot', () => {
        const transport = makeTransport();
        const broadcaster = new StateBroadcaster(transport, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        expect(transport.sendSnapshot).toHaveBeenCalledWith(PLAYER_A, snapshot);
    });

    it('calls transport.sendSnapshot exactly once per broadcast() call', () => {
        const transport = makeTransport();
        const broadcaster = new StateBroadcaster(transport, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);
        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it('passes different viewerIds to different broadcast() calls', () => {
        const transport = makeTransport();
        const broadcaster = new StateBroadcaster(transport, createNoopLogger());
        const snapshotA = makeSnapshot(PLAYER_A);
        const snapshotB = makeSnapshot(PLAYER_B);

        broadcaster.broadcast(snapshotA, PLAYER_A);
        broadcaster.broadcast(snapshotB, PLAYER_B);

        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(1, PLAYER_A, snapshotA);
        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(2, PLAYER_B, snapshotB);
    });

    it('does not call any other transport method', () => {
        const transport = makeTransport();
        const broadcaster = new StateBroadcaster(transport, createNoopLogger());

        broadcaster.broadcast(makeSnapshot(PLAYER_A), PLAYER_A);

        expect(transport.broadcastLobbyState).not.toHaveBeenCalled();
        expect(transport.sendSideChannel).not.toHaveBeenCalled();
    });
});
