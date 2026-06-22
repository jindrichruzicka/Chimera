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
import { GAME_SNAPSHOT_CHANNEL } from '../../preload/apis/game-api.js';
import { playerId as toPlayerId } from '@chimera/networking';
import type { HostTransport, PlayerId } from '@chimera/networking';
import { crc32Json } from '@chimera/simulation/foundation/crc32.js';
import { gamePhase } from '@chimera/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera/simulation/projection/StateProjector.js';
import type { E2eHooks } from './e2e-hooks.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTransport(): HostTransport {
    return {
        sendSnapshot: vi.fn(),
        sendTick: vi.fn(),
        broadcastLobbyState: vi.fn(),
        sendSideChannel: vi.fn(),
        sendReveal: vi.fn(),
        onActionReceived: vi.fn(() => () => {}),
        onReadyStateUpdate: vi.fn(() => () => {}),
        onPlayerAttributeUpdate: vi.fn(() => () => {}),
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
        gameResult: null,
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
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: true, canRedo: false },
        isMyTurn: true,
    };
}

function makeProjector(projected: PlayerSnapshot): StateProjector<BaseGameSnapshot> {
    return {
        project: vi.fn<
            (snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => PlayerSnapshot
        >(() => projected),
    };
}

function makeE2eHooks(): E2eHooks {
    const state = {
        lastHostSnapshot: null as PlayerSnapshot | null,
        lastChecksum: 0,
        broadcastChecksums: {} as Record<string, number>,
        currentTick: 0,
        lastSavedSlotId: null as string | null,
        lastSavedTick: null as number | null,
    };
    return {
        get lastHostSnapshot() {
            return state.lastHostSnapshot;
        },
        get lastChecksum() {
            return state.lastChecksum;
        },
        get broadcastChecksums() {
            return { ...state.broadcastChecksums };
        },
        get currentTick() {
            return state.currentTick;
        },
        get lastSavedSlotId() {
            return state.lastSavedSlotId;
        },
        set lastSavedSlotId(value: string | null) {
            state.lastSavedSlotId = value;
        },
        get lastSavedTick() {
            return state.lastSavedTick;
        },
        set lastSavedTick(value: number | null) {
            state.lastSavedTick = value;
        },
        firstPlayerRole: 'host',
        directGameLobbyCode: null,
        onBroadcastChecksum(tick, viewerId, checksum): void {
            state.currentTick = tick;
            state.lastChecksum = checksum;
            state.broadcastChecksums[viewerId] = checksum;
        },
        onTick(tick, checksum, snapshot): void {
            state.currentTick = tick;
            state.lastChecksum = checksum;
            state.broadcastChecksums[snapshot.viewerId] = checksum;
            state.lastHostSnapshot = snapshot;
        },
        onClockTick(tick): void {
            state.currentTick = tick;
        },
        pushWsFrame(): void {
            // no-op in this test double — StateBroadcaster does not call pushWsFrame
        },
        wsFrames: undefined,
        // no-op in this test double — StateBroadcaster does not call dispatchTick
        dispatchTick: () => {},
        // no-op in this test double — StateBroadcaster does not call triggerCrashSave
        triggerCrashSave: () => {},
        // no-op in this test double — StateBroadcaster does not call deliverChat
        deliverChat: () => {},
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

    it('projects the host-player snapshot before pushing it to host renderer IPC', () => {
        const transport = makeTransport();
        const hostProjected = makeProjectedSnapshot(PLAYER_A);
        const remoteProjected = makeProjectedSnapshot(PLAYER_B);
        const projector: StateProjector<BaseGameSnapshot> = {
            project: vi.fn((snapshot, viewerId) =>
                viewerId === PLAYER_A ? hostProjected : remoteProjected,
            ),
        };
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        const hostWebContents = {
            send: vi.fn<(channel: string, snapshot: PlayerSnapshot) => void>(),
        };
        const hostSnapshot = makeSnapshot(PLAYER_A);
        const remoteSnapshot = makeSnapshot(PLAYER_B);

        broadcaster.registerRendererRecipient({
            viewerId: PLAYER_A,
            sendSnapshot: (snapshot) => {
                hostWebContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
            },
        });

        broadcaster.broadcast(hostSnapshot, PLAYER_A);
        broadcaster.broadcast(remoteSnapshot, PLAYER_B);

        expect(projector.project).toHaveBeenNthCalledWith(1, hostSnapshot, PLAYER_A);
        expect(projector.project).toHaveBeenNthCalledWith(2, remoteSnapshot, PLAYER_B);
        expect(hostWebContents.send).toHaveBeenCalledOnce();
        expect(hostWebContents.send).toHaveBeenCalledWith(GAME_SNAPSHOT_CHANNEL, hostProjected);
        expect(hostWebContents.send).not.toHaveBeenCalledWith(GAME_SNAPSHOT_CHANNEL, hostSnapshot);
        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(1, PLAYER_A, hostProjected);
        expect(transport.sendSnapshot).toHaveBeenNthCalledWith(2, PLAYER_B, remoteProjected);
    });

    it('updates E2E hooks with the projected host snapshot and checksum', () => {
        const transport = makeTransport();
        const projected = makeProjectedSnapshot(PLAYER_A);
        const projector = makeProjector(projected);
        const hooks = makeE2eHooks();
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            hostViewerId: PLAYER_A,
            e2eHooks: hooks,
        });
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(hooks.currentTick).toBe(projected.tick);
        expect(hooks.lastChecksum).toBe(crc32Json(projected));
        expect(hooks.broadcastChecksums[PLAYER_A]).toBe(crc32Json(projected));
        expect(hooks.lastHostSnapshot).toBe(projected);
        expect(hooks.lastHostSnapshot).not.toBe(snapshot);
    });

    it('updates E2E checksum but not host snapshot for non-host viewer snapshots', () => {
        const transport = makeTransport();
        const projected = makeProjectedSnapshot(PLAYER_B);
        const projector = makeProjector(projected);
        const hooks = makeE2eHooks();
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            hostViewerId: PLAYER_A,
            e2eHooks: hooks,
        });

        broadcaster.broadcast(makeSnapshot(PLAYER_B), PLAYER_B);

        expect(hooks.currentTick).toBe(projected.tick);
        expect(hooks.lastChecksum).toBe(crc32Json(projected));
        expect(hooks.broadcastChecksums[PLAYER_B]).toBe(crc32Json(projected));
        expect(hooks.lastHostSnapshot).toBeNull();
    });

    it('broadcastTick sends only the tick without projecting or sending a full snapshot', () => {
        const transport = makeTransport();
        const projector = makeProjector(makeProjectedSnapshot(PLAYER_A));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        broadcaster.broadcastTick(42, PLAYER_A);

        expect(projector.project).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).not.toHaveBeenCalled();
        expect(transport.sendTick).toHaveBeenCalledOnce();
        expect(transport.sendTick).toHaveBeenCalledWith(PLAYER_A, 42);
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
