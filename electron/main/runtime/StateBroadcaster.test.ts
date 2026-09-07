/**
 * electron/main/runtime/StateBroadcaster.test.ts
 *
 * Unit tests for StateBroadcaster.
 *
 * StateBroadcaster projects each broadcast() call before delegating to HostTransport.sendSnapshot().
 * It must have zero imports from networking/provider/local/ or ws.
 *
 * Architecture: §4.6, §4.14 — StateProjector / StateBroadcaster
 * Task: F11-T02
 *
 * Invariants covered:
 *   #3  — StateBroadcaster sends only PlayerSnapshot to HostTransport.
 *   #8  — StateProjector.project() is the mandatory outbound snapshot gate.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { StateBroadcaster } from './StateBroadcaster.js';
import type { SpectatorViewSource } from './StateBroadcaster.js';
import { createLogger, createMemorySink, createNoopLogger } from '../logging/logger.js';
import { GAME_SNAPSHOT_CHANNEL } from '../../preload/apis/game-api.js';
import { playerId as toPlayerId } from '@chimera-engine/networking';
import type { HostTransport, PlayerId } from '@chimera-engine/networking';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import { diffSnapshots } from '@chimera-engine/simulation/foundation/snapshot-diff.js';
import {
    applySnapshotDelta,
    toSnapshotDelta,
} from '@chimera-engine/simulation/foundation/snapshot-delta.js';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera-engine/simulation/projection/StateProjector.js';
import type { E2eHooks } from './e2e-hooks.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTransport(): HostTransport {
    return {
        sendSnapshot: vi.fn(),
        sendSnapshotDelta: vi.fn(),
        sendTick: vi.fn(),
        broadcastLobbyState: vi.fn(),
        sendSideChannel: vi.fn(),
        sendReveal: vi.fn(),
        onActionReceived: vi.fn(() => () => {}),
        onReadyStateUpdate: vi.fn(() => () => {}),
        onPlayerAttributeUpdate: vi.fn(() => () => {}),
        onSpectateTargetUpdate: vi.fn(() => () => {}),
        onSideChannelReceived: vi.fn(() => () => {}),
        onPlayerJoined: vi.fn(() => () => {}),
        onPlayerLeft: vi.fn(() => () => {}),
        setProfileGate: vi.fn(),
        setJoinClassifier: vi.fn(),
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

// ── Spectator perspective fan-out (Invariant #114) ────────────────────────────

const SPEC_1 = toPlayerId('spectator-1');
const SPEC_2 = toPlayerId('spectator-2');

/** Projector double whose projection carries the requested viewerId. */
function makePerViewerProjector(): StateProjector<BaseGameSnapshot> {
    return {
        project: vi.fn<
            (snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => PlayerSnapshot
        >((snapshot, viewerId) => ({
            ...makeProjectedSnapshot(viewerId),
            tick: snapshot.tick,
        })),
    };
}

function makeSpectatorSource(
    pairs: readonly (readonly [PlayerId, PlayerId])[],
): SpectatorViewSource {
    const map = new Map(pairs);
    return {
        entries: () => [...map.entries()],
        followedBy: (spectatorId) => map.get(spectatorId),
    };
}

describe('StateBroadcaster — spectator perspective fan-out (Invariant #114)', () => {
    it('fans out the followed seat projection to each spectator exactly once per wave', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([
            [SPEC_1, PLAYER_A],
            [SPEC_2, PLAYER_B],
        ]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });
        const snapshot = makeSnapshot(PLAYER_A);

        // Stage 7 calls broadcastWave() once per seated viewer with the same
        // snapshot object — the spectator fan-out must not repeat per call.
        broadcaster.broadcastWave(snapshot, PLAYER_A);
        broadcaster.broadcastWave(snapshot, PLAYER_B);

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(4);
        expect(transport.sendSnapshot).toHaveBeenCalledWith(
            SPEC_1,
            expect.objectContaining({ viewerId: PLAYER_A }),
        );
        expect(transport.sendSnapshot).toHaveBeenCalledWith(
            SPEC_2,
            expect.objectContaining({ viewerId: PLAYER_B }),
        );
        expect(projector.project).toHaveBeenCalledWith(snapshot, PLAYER_A);
        expect(projector.project).toHaveBeenCalledWith(snapshot, PLAYER_B);
    });

    it('a point-send broadcast() never reaches spectators (only broadcastWave does)', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([
            [SPEC_1, PLAYER_A],
            [SPEC_2, PLAYER_B],
        ]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });
        const snapshot = makeSnapshot(PLAYER_A);

        // A point-send targets ONE viewer and must not push snapshots to
        // remote spectators.
        broadcaster.broadcast(snapshot, PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        expect(transport.sendSnapshot).toHaveBeenCalledWith(
            PLAYER_A,
            expect.objectContaining({ viewerId: PLAYER_A }),
        );
        expect(transport.sendSnapshot).not.toHaveBeenCalledWith(SPEC_1, expect.anything());
        expect(transport.sendSnapshot).not.toHaveBeenCalledWith(SPEC_2, expect.anything());

        // …and because the point-send never touched the wave marker, the next
        // real wave of the SAME snapshot still fans out to every spectator.
        broadcaster.broadcastWave(snapshot, PLAYER_A);
        expect(transport.sendSnapshot).toHaveBeenCalledWith(SPEC_1, expect.anything());
        expect(transport.sendSnapshot).toHaveBeenCalledWith(SPEC_2, expect.anything());
    });

    it('fans out again when the next wave carries a new snapshot object', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([[SPEC_1, PLAYER_A]]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });

        broadcaster.broadcastWave(makeSnapshot(PLAYER_A), PLAYER_A);
        broadcaster.broadcastWave({ ...makeSnapshot(PLAYER_A), tick: 2 }, PLAYER_A);

        // Counted across BOTH state frames: the property is that a second wave
        // reaches the spectator again, and which frame carries it is the
        // delta path's decision, not this test's.
        const spectatorSends = [
            ...vi.mocked(transport.sendSnapshot).mock.calls,
            ...vi.mocked(transport.sendSnapshotDelta).mock.calls,
        ].filter(([target]) => target === SPEC_1);
        expect(spectatorSends).toHaveLength(2);
    });

    it('broadcastSpectator() unicasts the followed seat projection to one spectator', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([
            [SPEC_1, PLAYER_A],
            [SPEC_2, PLAYER_B],
        ]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });
        const snapshot = makeSnapshot(PLAYER_A);

        broadcaster.broadcastSpectator(snapshot, SPEC_1);

        expect(transport.sendSnapshot).toHaveBeenCalledOnce();
        expect(transport.sendSnapshot).toHaveBeenCalledWith(
            SPEC_1,
            expect.objectContaining({ viewerId: PLAYER_A }),
        );

        // The join-time unicast must not consume the wave fan-out: the next
        // wave of the same snapshot still reaches every spectator.
        broadcaster.broadcastWave(snapshot, PLAYER_A);
        const spectatorSends = (
            transport.sendSnapshot as ReturnType<typeof vi.fn>
        ).mock.calls.filter(([target]) => target === SPEC_1);
        expect(spectatorSends).toHaveLength(2);
    });

    it('broadcastSpectator() sends nothing for an unregistered spectator', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators: makeSpectatorSource([]),
        });

        broadcaster.broadcastSpectator(makeSnapshot(PLAYER_A), SPEC_1);

        expect(projector.project).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).not.toHaveBeenCalled();
    });

    it('forwards clock-only ticks to spectators exactly once per tick value', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([
            [SPEC_1, PLAYER_A],
            [SPEC_2, PLAYER_B],
        ]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });

        broadcaster.broadcastTick(5, PLAYER_A);
        broadcaster.broadcastTick(5, PLAYER_B);
        broadcaster.broadcastTick(6, PLAYER_A);

        expect(transport.sendTick).toHaveBeenCalledWith(SPEC_1, 5);
        expect(transport.sendTick).toHaveBeenCalledWith(SPEC_2, 5);
        expect(transport.sendTick).toHaveBeenCalledWith(SPEC_1, 6);
        const spectatorTicks = (transport.sendTick as ReturnType<typeof vi.fn>).mock.calls.filter(
            ([target]) => target === SPEC_1 || target === SPEC_2,
        );
        expect(spectatorTicks).toHaveLength(4);
    });

    it('stops spectator fan-out after dispose()', () => {
        const transport = makeTransport();
        const projector = makePerViewerProjector();
        const spectators = makeSpectatorSource([[SPEC_1, PLAYER_A]]);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });

        broadcaster.dispose();
        broadcaster.broadcastWave(makeSnapshot(PLAYER_A), PLAYER_A);
        broadcaster.broadcastSpectator(makeSnapshot(PLAYER_A), SPEC_1);
        broadcaster.broadcastTick(5, PLAYER_A);

        expect(transport.sendSnapshot).not.toHaveBeenCalled();
        expect(transport.sendTick).not.toHaveBeenCalled();
    });
});

// ── Per-beat log levels (§4.27) ───────────────────────────────────────────────

describe('StateBroadcaster — per-beat log levels', () => {
    const SPEC_A = toPlayerId('spectator-a');

    /** Every path a realtime beat drives, in one call each. */
    function driveOneBeat(broadcaster: StateBroadcaster): void {
        broadcaster.broadcastWave(makeSnapshot(PLAYER_A), PLAYER_A);
        broadcaster.broadcastTick(7, PLAYER_A);
    }

    it('emits nothing at debug or above on the paths a beat drives', () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'state-broadcaster' },
            sink,
        });
        const broadcaster = new StateBroadcaster(
            makeTransport(),
            makePerViewerProjector(),
            logger,
            { spectators: makeSpectatorSource([[SPEC_A, PLAYER_A]]) },
        );

        driveOneBeat(broadcaster);

        // The file sink's default threshold is `info`, so anything at `debug`
        // or above here is a line written per beat for the length of a match.
        expect(sink.entries.filter((e) => e.level !== 'trace')).toStrictEqual([]);
    });

    it('still records each beat path at trace, so an explicit request gets them', () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'state-broadcaster' },
            sink,
        });
        const broadcaster = new StateBroadcaster(
            makeTransport(),
            makePerViewerProjector(),
            logger,
            { spectators: makeSpectatorSource([[SPEC_A, PLAYER_A]]) },
        );

        driveOneBeat(broadcaster);

        expect(sink.entries.map((e) => e.message)).toStrictEqual([
            'broadcast',
            'spectator broadcast',
            'broadcast tick',
        ]);
    });
});

// ── Outbound snapshot deltas ───────────────────────────────────────────────────

/**
 * A projector driven by a per-viewer script, so a test can move one field of one
 * viewer's projection and leave every other viewer's alone.
 */
function makeScriptedProjector(): {
    projector: StateProjector<BaseGameSnapshot>;
    project: ReturnType<typeof vi.fn>;
    set: (viewerId: PlayerId, snapshot: PlayerSnapshot) => void;
} {
    const scripted = new Map<PlayerId, PlayerSnapshot>();
    const project = vi.fn((_snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => {
        const next = scripted.get(viewerId);
        if (next === undefined) throw new Error(`no projection scripted for ${viewerId}`);
        return next;
    });
    return {
        projector: { project },
        project,
        set: (viewerId, snapshot) => scripted.set(viewerId, snapshot),
    };
}

/** A projected snapshot with one entity at `x`, so a beat can move exactly one path. */
function makeMovingProjection(viewerId: PlayerId, tick: number, x: number): PlayerSnapshot {
    return {
        ...makeProjectedSnapshot(viewerId),
        tick,
        entities: { 'unit-1': { id: 'unit-1', x } } as unknown as PlayerSnapshot['entities'],
    };
}

/** Distinct host snapshot objects, so each wave looks like a new one to the fan-out dedupe. */
const wave = (tick: number): BaseGameSnapshot => ({ ...makeSnapshot(PLAYER_A), tick });

describe('StateBroadcaster — outbound snapshot deltas', () => {
    it('sends a full snapshot to a viewer it has no baseline for', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());

        broadcaster.broadcastWave(wave(1), PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(1);
        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
    });

    it('sends only the changed path on the next beat', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(1);
        expect(transport.sendSnapshotDelta).toHaveBeenCalledTimes(1);
        expect(transport.sendSnapshotDelta).toHaveBeenCalledWith(PLAYER_A, {
            fromTick: 1,
            toTick: 2,
            entries: [
                { path: 'tick', kind: 'changed', after: 2 },
                { path: 'entities.unit-1.x', kind: 'changed', after: 1 },
            ],
        });
    });

    it('chains: the second delta in a run is measured from what the first one delivered', () => {
        // The baseline has to ADVANCE on a delta, not only on a keyframe. Left
        // at the keyframe, every delta after the first carries a `fromTick` the
        // receiver has already moved past — `applySnapshotDelta` refuses it, the
        // viewer asks for a re-sync, and `engine:sync_request` broadcasts a full
        // snapshot to EVERY viewer, once per beat. Counting the sends cannot see
        // that: the counts are identical either way. `fromTick` is the artifact
        // the receiver reads.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        for (const tick of [2, 3, 4]) {
            set(PLAYER_A, makeMovingProjection(PLAYER_A, tick, tick));
            broadcaster.broadcastWave(wave(tick), PLAYER_A);
        }

        const sent = vi.mocked(transport.sendSnapshotDelta).mock.calls.map(([, delta]) => delta);
        expect(sent.map((delta) => [delta.fromTick, delta.toTick])).toEqual([
            [1, 2],
            [2, 3],
            [3, 4],
        ]);
        // And they really do chain: applying them in order from the keyframe
        // reaches the projection the host holds.
        const keyframe = vi.mocked(transport.sendSnapshot).mock.calls[0]?.[1] as PlayerSnapshot;
        const applied = sent.reduce<PlayerSnapshot | null>(
            (held, delta) => (held === null ? null : applySnapshotDelta(held, delta)),
            keyframe,
        );
        expect(applied).toEqual(makeMovingProjection(PLAYER_A, 4, 4));
    });

    it('sends the full snapshot when the delta is exactly the size of the keyframe', () => {
        // The comparator is inclusive, and equal-sized is the case that decides
        // it: a delta that saves nothing should not be preferred to the whole
        // snapshot, which also re-baselines the receiver. The fixture is built
        // to land ON the boundary and asserts that it did.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const padded = (tick: number, pad: string): PlayerSnapshot => ({
            ...makeProjectedSnapshot(PLAYER_A),
            tick,
            entities: {
                'unit-1': { id: 'unit-1', filler: 'f'.repeat(400), pad },
            } as unknown as PlayerSnapshot['entities'],
        });
        const keyframe = padded(1, '');
        const keyframeBytes = JSON.stringify(keyframe).length;
        const deltaBytesFor = (pad: string): number =>
            JSON.stringify(toSnapshotDelta(diffSnapshots(keyframe, padded(2, pad)))).length;
        // Measured from a ONE-character pad, not from none: an empty pad is
        // unchanged between the two projections, so the delta carries no entry
        // for it at all and the first character costs a whole entry rather than
        // a byte. From there each extra ASCII character costs exactly one.
        const pad = 'x'.repeat(keyframeBytes - deltaBytesFor('x') + 1);
        expect(deltaBytesFor(pad)).toBe(keyframeBytes);

        set(PLAYER_A, keyframe);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, padded(2, pad));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(broadcaster.deltaMetrics().sizeFallbacks).toBe(1);
    });

    it('sends the delta when it is one byte smaller than the keyframe', () => {
        // The other side of the same boundary, so the comparator cannot be
        // widened either.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const padded = (tick: number, pad: string): PlayerSnapshot => ({
            ...makeProjectedSnapshot(PLAYER_A),
            tick,
            entities: {
                'unit-1': { id: 'unit-1', filler: 'f'.repeat(400), pad },
            } as unknown as PlayerSnapshot['entities'],
        });
        const keyframe = padded(1, '');
        const keyframeBytes = JSON.stringify(keyframe).length;
        const deltaBytesFor = (pad: string): number =>
            JSON.stringify(toSnapshotDelta(diffSnapshots(keyframe, padded(2, pad)))).length;
        const pad = 'x'.repeat(keyframeBytes - deltaBytesFor('x'));
        expect(deltaBytesFor(pad)).toBe(keyframeBytes - 1);

        set(PLAYER_A, keyframe);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, padded(2, pad));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).toHaveBeenCalledTimes(1);
        expect(broadcaster.deltaMetrics().sizeFallbacks).toBe(0);
    });

    it('sends a keyframe when the wave is forced, however much the projection moved', () => {
        // The `engine:sync_request` path. A re-sync arriving after a run of
        // clock-only beats has a projection that DID change, so an empty diff
        // does not identify it — and the viewer that asked to be re-synced is
        // exactly the one whose baseline cannot be trusted, so a delta against
        // that baseline is the one thing it must not be sent.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 51, 9));
        broadcaster.broadcastWave(wave(51), PLAYER_A, { forceFull: true });

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
    });

    it('re-baselines on a forced wave, so the beat after it is a delta against THAT', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 51, 9));
        broadcaster.broadcastWave(wave(51), PLAYER_A, { forceFull: true });

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 52, 10));
        broadcaster.broadcastWave(wave(52), PLAYER_A);

        expect(transport.sendSnapshotDelta).toHaveBeenCalledWith(
            PLAYER_A,
            expect.objectContaining({ fromTick: 51, toTick: 52 }),
        );
    });

    it('sends a keyframe rather than an empty delta when the projection did not change', () => {
        // Not the same case as a forced wave: an unforced wave whose projection
        // is unchanged would otherwise put a delta with no entries on the wire.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const projection = makeMovingProjection(PLAYER_A, 1, 0);
        set(PLAYER_A, projection);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        // A structurally equal but distinct object, as a re-projection produces.
        set(PLAYER_A, { ...projection });
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
    });

    it('forces the spectator fan-out too, so a re-sync wave reaches every recipient whole', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const spectatorId = toPlayerId('spectator-1');
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators: makeSpectatorSource([[spectatorId, PLAYER_A]]),
        });
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 51, 9));
        broadcaster.broadcastWave(wave(51), PLAYER_A, { forceFull: true });

        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
        expect(
            vi.mocked(transport.sendSnapshot).mock.calls.filter(([id]) => id === spectatorId),
        ).toHaveLength(2);
    });

    it('sends a keyframe every keyframeIntervalBeats beats', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 0, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            keyframeIntervalBeats: 3,
        });

        for (let tick = 0; tick < 7; tick++) {
            set(PLAYER_A, makeMovingProjection(PLAYER_A, tick, tick));
            broadcaster.broadcastWave(wave(tick), PLAYER_A);
        }

        // Beats 0, 3 and 6 are keyframes; the four between them are deltas.
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(3);
        expect(transport.sendSnapshotDelta).toHaveBeenCalledTimes(4);
    });

    it('sends the full snapshot when the delta would not be smaller, and counts it', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        // A tiny projection, then one whose every entity is new: the delta has to
        // carry the whole new payload plus its paths, so it cannot be smaller.
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        const bulky = {
            ...makeProjectedSnapshot(PLAYER_A),
            tick: 2,
            entities: Object.fromEntries(
                Array.from({ length: 40 }, (_unused, index) => [
                    `unit-${index}`,
                    { id: `unit-${index}`, x: index },
                ]),
            ) as unknown as PlayerSnapshot['entities'],
        };
        set(PLAYER_A, bulky);
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
        expect(broadcaster.deltaMetrics().sizeFallbacks).toBe(1);
    });

    it('counts what it actually sent, so the saving is measurable', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(broadcaster.deltaMetrics()).toEqual({ keyframes: 1, deltas: 1, sizeFallbacks: 0 });
    });

    it('diffs per viewer AFTER projection — two viewers with different visibility differ', () => {
        // Invariant #8: the delta is computed downstream of `project()`, per
        // viewer. Diffing once for everyone would hand B a path B's own
        // projection masked.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        set(PLAYER_B, { ...makeProjectedSnapshot(PLAYER_B), tick: 1 });
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        broadcaster.broadcastWave(wave(1), PLAYER_B);

        // The same host beat: A sees the entity move, B's projection hides it.
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 5));
        set(PLAYER_B, { ...makeProjectedSnapshot(PLAYER_B), tick: 2 });
        broadcaster.broadcastWave(wave(2), PLAYER_A);
        broadcaster.broadcastWave(wave(2), PLAYER_B);

        const deltas = vi.mocked(transport.sendSnapshotDelta).mock.calls;
        expect(deltas.map(([viewerId]) => viewerId)).toEqual([PLAYER_A, PLAYER_B]);
        expect(deltas.map(([, delta]) => delta.entries.map((entry) => entry.path))).toEqual([
            ['tick', 'entities.unit-1.x'],
            ['tick'],
        ]);
    });

    it('drops a viewer baseline when that player leaves, so a rejoin gets a keyframe', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        // The transport double records its onPlayerLeft subscriber; fire it.
        const [onLeft] = vi.mocked(transport.onPlayerLeft).mock.calls[0] as [
            (playerId: PlayerId, reason: 'normal') => void,
        ];
        onLeft(PLAYER_A, 'normal');

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it('unsubscribes from player-left on dispose', () => {
        const unsubscribe = vi.fn();
        const transport = makeTransport();
        vi.mocked(transport.onPlayerLeft).mockReturnValue(unsubscribe);
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));

        new StateBroadcaster(transport, projector, createNoopLogger()).dispose();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('keeps a point-send a keyframe — a reconnecting viewer asked for the whole thing', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcast(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).not.toHaveBeenCalled();
        expect(transport.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it('re-baselines on a point-send, so the beat after it is a delta against THAT', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger());
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcast(wave(2), PLAYER_A);

        set(PLAYER_A, makeMovingProjection(PLAYER_A, 3, 2));
        broadcaster.broadcastWave(wave(3), PLAYER_A);

        expect(transport.sendSnapshotDelta).toHaveBeenCalledWith(PLAYER_A, {
            fromTick: 2,
            toTick: 3,
            entries: [
                { path: 'tick', kind: 'changed', after: 3 },
                { path: 'entities.unit-1.x', kind: 'changed', after: 2 },
            ],
        });
    });

    it('still gives renderer recipients and E2E hooks the WHOLE projection on a delta beat', () => {
        // The renderer leg and the E2E checksum are measured on the projection,
        // not on the frame: a delta on the wire must not change what either sees.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const hooks = makeE2eHooks();
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            hostViewerId: PLAYER_A,
            e2eHooks: hooks,
        });
        const sendSnapshot = vi.fn();
        broadcaster.registerRendererRecipient({ viewerId: PLAYER_A, sendSnapshot });
        broadcaster.broadcastWave(wave(1), PLAYER_A);

        const moved = makeMovingProjection(PLAYER_A, 2, 1);
        set(PLAYER_A, moved);
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        expect(transport.sendSnapshotDelta).toHaveBeenCalledTimes(1);
        expect(sendSnapshot).toHaveBeenLastCalledWith(moved);
        expect(hooks.lastHostSnapshot).toEqual(moved);
        expect(hooks.broadcastChecksums[PLAYER_A]).toBe(crc32Json(moved));
    });

    it('re-baselines a spectator on a follow-target switch, so the next delta is against THAT', () => {
        // `broadcastSpectator` is the spectate-target switch: it pushes the NEW
        // seat's projection at the SAME tick the host already holds. Sending it
        // without re-baselining leaves the host differencing the OLD seat's
        // projection — and because the tick did not move, the delta that follows
        // carries a `fromTick` the spectator's held snapshot matches, so
        // `applySnapshotDelta`'s chain check PASSES and the wrong baseline is
        // kept in silence.
        //
        // `hp` is the fixture that makes that visible, and it has to be built
        // deliberately: it is EQUAL between the old seat at tick 7 and the new
        // seat at tick 8, and DIFFERENT between the new seat's two ticks. A diff
        // against the old seat therefore omits it altogether and the spectator
        // keeps a stale 9. A field that merely differs between the seats would
        // be carried by either diff and prove nothing.
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const spectatorId = toPlayerId('spectator-1');
        let followed = PLAYER_A;
        const spectators: SpectatorViewSource = {
            entries: () => [[spectatorId, followed]],
            followedBy: () => followed,
        };
        const seat = (viewerId: PlayerId, tick: number, hp: number): PlayerSnapshot => ({
            ...makeProjectedSnapshot(viewerId),
            tick,
            entities: { 'unit-1': { id: 'unit-1', hp } } as unknown as PlayerSnapshot['entities'],
        });
        const A7 = seat(PLAYER_A, 7, 5);
        const B7 = seat(PLAYER_B, 7, 9);
        const B8 = seat(PLAYER_B, 8, 5);

        set(PLAYER_A, A7);
        set(PLAYER_B, B7);
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators,
        });
        broadcaster.broadcastWave(wave(7), PLAYER_A);

        // The spectator re-points to B and is unicast B's projection at tick 7.
        followed = PLAYER_B;
        broadcaster.broadcastSpectator(wave(7), spectatorId);

        set(PLAYER_A, seat(PLAYER_A, 8, 5));
        set(PLAYER_B, B8);
        broadcaster.broadcastWave(wave(8), PLAYER_A);

        const spectatorDelta = vi
            .mocked(transport.sendSnapshotDelta)
            .mock.calls.find(([id]) => id === spectatorId)?.[1];
        expect(spectatorDelta?.entries.map((entry) => entry.path)).toEqual([
            'tick',
            'entities.unit-1.hp',
        ]);
        // And the artifact the receiver reads: applied to what the spectator was
        // actually SENT, the delta reproduces the projection the host holds.
        expect(applySnapshotDelta(B7, spectatorDelta!)).toEqual(B8);
    });

    it('deltas a spectator against what that spectator last received', () => {
        const transport = makeTransport();
        const { projector, set } = makeScriptedProjector();
        const spectatorId = toPlayerId('spectator-1');
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 1, 0));
        const broadcaster = new StateBroadcaster(transport, projector, createNoopLogger(), {
            spectators: makeSpectatorSource([[spectatorId, PLAYER_A]]),
        });
        broadcaster.broadcastWave(wave(1), PLAYER_A);
        set(PLAYER_A, makeMovingProjection(PLAYER_A, 2, 1));
        broadcaster.broadcastWave(wave(2), PLAYER_A);

        const deltas = vi.mocked(transport.sendSnapshotDelta).mock.calls;
        expect(deltas.map(([viewerId]) => viewerId)).toEqual([PLAYER_A, spectatorId]);
    });
});
