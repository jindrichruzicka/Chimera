/**
 * electron/main/runtime/StateBroadcaster.test.ts
 *
 * Unit tests for StateBroadcaster.
 *
 * StateBroadcaster projects each broadcast() call before delegating to HostTransport.sendSnapshot().
 * It must have zero imports from networking/provider/local/ or ws.
 *
 * Architecture: §4.6, §4.14 — StateProjector / StateBroadcaster
 * Task: F11-T02 (issue #239), issue #436
 *
 * Invariants covered:
 *   #3  — StateBroadcaster sends only PlayerSnapshot to HostTransport.
 *   #8  — StateProjector.project() is the mandatory outbound snapshot gate.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { StateBroadcaster } from './StateBroadcaster.js';
import { createNoopLogger } from '../logging/logger.js';
import { playerId as toPlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import type { HostTransport, PlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';
import { gamePhase } from '@chimera/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera/simulation/projection/StateProjector.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function makeSnapshot(viewerId: PlayerId): BaseGameSnapshot {
    return {
        tick: 1,
        seed: 123,
        players: { [viewerId]: { id: viewerId } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
    };
}

function makeProjectedSnapshot(viewerId: PlayerId): PlayerSnapshot {
    return {
        tick: 1,
        viewerId,
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        commitments: {},
        undoMeta: { canUndo: true, canRedo: false },
    };
}

function makeProjector(projected: PlayerSnapshot): StateProjector<BaseGameSnapshot> {
    return {
        project: vi.fn<
            (snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => PlayerSnapshot
        >(() => projected),
    };
}

const PLAYER_A = toPlayerId('player-a');
const PLAYER_B = toPlayerId('player-b');

// ── broadcast() ────────────────────────────────────────────────────────────────

describe('StateBroadcaster.broadcast', () => {
    it('projects the full snapshot for the viewer before sending it', () => {
        const transport = makeTransport();
        const projected = makeProjectedSnapshot(PLAYER_A);
        const projector = makeProjector(projected);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(projector.project).toHaveBeenCalledOnce();
        expect(projector.project).toHaveBeenCalledWith(snapshot, PLAYER_A);
        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        expect(transport.sendSnapshot).toHaveBeenCalledWith(PLAYER_A, projected);
        expect(transport.sendSnapshot).not.toHaveBeenCalledWith(PLAYER_A, snapshot);
    });

    it('calls transport.sendSnapshot exactly once per broadcast() call', () => {
        const transport = makeTransport();
        const projector = makeProjector(makeProjectedSnapshot(PLAYER_A));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);
        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(projector.project).toHaveBeenCalledTimes(2);
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it('passes different viewerIds to different broadcast() calls', () => {
        const transport = makeTransport();
        const projectedA = makeProjectedSnapshot(PLAYER_A);
        const projectedB = makeProjectedSnapshot(PLAYER_B);
        const projector: StateProjector<BaseGameSnapshot> = {
            project: vi.fn((snapshot, viewerId) =>
                viewerId === PLAYER_A ? projectedA : projectedB,
            ),
        };
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const snapshotA = makeSnapshot(PLAYER_A);
        const snapshotB = makeSnapshot(PLAYER_B);

        broadcaster.broadcast(snapshotA, PLAYER_A);
        broadcaster.broadcast(snapshotB, PLAYER_B);

        expect(projector.project).toHaveBeenNthCalledWith(1, snapshotA, PLAYER_A);
        expect(projector.project).toHaveBeenNthCalledWith(2, snapshotB, PLAYER_B);
        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(1, PLAYER_A, projectedA);
        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(2, PLAYER_B, projectedB);
    });

    it('does not call any other transport method', () => {
        const transport = makeTransport();
        const projector = makeProjector(makeProjectedSnapshot(PLAYER_A));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        broadcaster.broadcast(makeSnapshot(PLAYER_A), PLAYER_A);

        expect(transport.broadcastLobbyState).not.toHaveBeenCalled();
        expect(transport.sendSideChannel).not.toHaveBeenCalled();
    });
});

// ── dispose() ─────────────────────────────────────────────────────────────────

describe('StateBroadcaster.dispose', () => {
    it('silently ignores broadcast() calls after dispose()', () => {
        const transport = makeTransport();
        const projector = makeProjector(makeProjectedSnapshot(PLAYER_A));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.dispose();
        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(projector.project).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).not.toHaveBeenCalled();
    });

    it('does not throw when disposed multiple times', () => {
        const transport = makeTransport();
        const projector = makeProjector(makeProjectedSnapshot(PLAYER_A));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        expect(() => {
            broadcaster.dispose();
            broadcaster.dispose();
        }).not.toThrow();
    });

    it('allows broadcast() calls before dispose()', () => {
        const transport = makeTransport();
        const projected = makeProjectedSnapshot(PLAYER_A);
        const projector = makeProjector(projected);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);
        broadcaster.dispose();

        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        expect(transport.sendSnapshot).toHaveBeenCalledWith(PLAYER_A, projected);
    });
});
