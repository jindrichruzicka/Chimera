/**
 * electron/main/replay/replay-playback-manager.test.ts
 *
 * TDD tests (RED first) for ReplayPlaybackManager (F44 / T6, #660).
 *
 * The manager loads a replay file, drives a ReplayPlayer over the live
 * ActionPipeline wiring, and projects each BaseGameSnapshot to a per-viewer
 * PlayerSnapshot for the renderer's replay player.
 *
 * Invariants verified:
 *   #3  — only a projected PlayerSnapshot leaves the manager; never a
 *           BaseGameSnapshot (asserted via the absence of the host-internal
 *           `seed` field that PlayerSnapshot strips).
 *   #67 — constructed with an injected Logger.
 *   #70 — playback reuses the live ActionPipeline wiring (buildHostSessionPipeline).
 */

import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type { ActionDefinition } from '@chimera-engine/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { ReplayFile } from '@chimera-engine/simulation/replay/index.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/index.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import { ReplayPlaybackManager } from './replay-playback-manager.js';

const P1 = toPlayerId('p1');
const P2 = toPlayerId('p2');

const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

function makeRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(advanceDef);
    return registry;
}

/** Passthrough visibility rules: every entity visible, nothing masked. */
const passthroughRules: VisibilityRules = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (player) => player,
    filterEvents: (events) => events,
};

const advance = (tick: number): ReplayFile['actions'][number] => ({
    tick,
    playerId: P1,
    action: { type: 'game:advance', playerId: P1, tick, payload: {} },
});

function makeReplayFile(actionCount = 3): ReplayFile {
    const actions = Array.from({ length: actionCount }, (_unused, index) => advance(index));
    return {
        formatVersion: 1,
        engineVersion: '1.0.0',
        gameId: 'tactics',
        gameVersion: '1.0.0',
        gameConfig: { playerIds: ['p1', 'p2'], phase: 'playing' },
        seed: 42,
        actions,
        metadata: {
            recordedAt: '2026-06-03T00:00:00Z',
            durationTicks: actionCount,
            players: [
                { playerId: P1, displayName: 'Alice' },
                { playerId: P2, displayName: 'Bob' },
            ],
        },
    };
}

/**
 * A replay whose recorded actions begin at `baseTick` > 0, as happens for the
 * second (and later) match of a session: the session tick is monotonic across
 * match boundaries, so `engine:start_game` for match 2 is recorded at a non-zero
 * tick. Playback must reconstruct from that base tick and translate the
 * renderer's 0-based requests onto it.
 */
function makeNonZeroBaseReplayFile(baseTick: number, actionCount = 3): ReplayFile {
    const base = makeReplayFile(actionCount);
    const actions = Array.from({ length: actionCount }, (_unused, index) =>
        advance(baseTick + index),
    );
    return {
        ...base,
        actions,
        metadata: { ...base.metadata, durationTicks: baseTick + actionCount - 1 },
    };
}

function makeLogger(): ReturnType<typeof createLogger> {
    return createLogger({ source: { process: 'main', module: 'test' }, sink: createMemorySink() });
}

function makeManager(file: ReplayFile = makeReplayFile()): ReplayPlaybackManager {
    return new ReplayPlaybackManager(
        makeRegistry(),
        (gameId) => (gameId === 'tactics' ? passthroughRules : undefined),
        { load: () => Promise.resolve(file), getCurrentMatchFile: () => file },
        makeLogger(),
    );
}

describe('ReplayPlaybackManager', () => {
    describe('open', () => {
        it('loads the replay and returns playback info', async () => {
            const manager = makeManager();

            const info = await manager.open('/replays/tactics/match.chimera-replay');

            expect(info).toEqual({
                gameId: 'tactics',
                totalTicks: 3,
                playerIds: ['p1', 'p2'],
                viewerId: 'p1',
            });
        });

        it('reports totalTicks as the final reachable state tick, not the file metadata durationTicks', async () => {
            // A real recording's `durationTicks` is the highest *issued* action
            // tick (`actions.length - 1` for a contiguous match) — one short of
            // the final *state* tick the player can scrub to. Playback must
            // expose that final state tick so the terminal (game-over) snapshot,
            // where `gameResult` is set, is reachable (F44 / T9, #663).
            const base = makeReplayFile(3);
            const file: ReplayFile = {
                ...base,
                metadata: { ...base.metadata, durationTicks: 2 },
            };
            const manager = makeManager(file);

            const info = await manager.open('/replays/tactics/match.chimera-replay');

            expect(info.totalTicks).toBe(3);
        });

        it('rejects when no visibility rules are registered for the game', async () => {
            const file: ReplayFile = { ...makeReplayFile(), gameId: 'unknown-game' };
            const manager = makeManager(file);

            await expect(manager.open('/replays/x.chimera-replay')).rejects.toThrow(/visibility/i);
        });
    });

    describe('openCurrent', () => {
        it('builds playback from the in-memory current-match file (no path load)', async () => {
            const manager = makeManager();

            const info = await manager.openCurrent();

            expect(info).toEqual({
                gameId: 'tactics',
                totalTicks: 3,
                playerIds: ['p1', 'p2'],
                viewerId: 'p1',
            });
        });

        it('projects snapshots from the in-memory file exactly as a path-opened replay does', async () => {
            const manager = makeManager();
            await manager.openCurrent();

            const snaps = manager.snapshotRange(0, 3);

            expect(snaps.map((s) => s.tick)).toEqual([0, 1, 2, 3]);
            // Invariant #3: still only projected PlayerSnapshots cross the boundary.
            expect(snaps.every((s) => !('seed' in s))).toBe(true);
        });

        it('rejects when the in-memory file has no visibility rules', async () => {
            const file: ReplayFile = { ...makeReplayFile(), gameId: 'unknown-game' };
            const manager = makeManager(file);

            await expect(manager.openCurrent()).rejects.toThrow(/visibility/i);
        });
    });

    describe('snapshotAt', () => {
        it('returns a projected PlayerSnapshot at tick 0 — never a GameSnapshot (Inv #3)', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            const snap = manager.snapshotAt(0);

            expect(snap.tick).toBe(0);
            expect(snap.viewerId).toBe('p1');
            // PlayerSnapshot strips the host-internal seed; its presence would
            // mean a raw BaseGameSnapshot leaked across the boundary.
            expect('seed' in snap).toBe(false);
        });

        it('advances one tick via step on sequential requests', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(0);
            expect(manager.snapshotAt(1).tick).toBe(1);
            expect(manager.snapshotAt(2).tick).toBe(2);
        });

        it('seeks to an arbitrary tick on non-sequential requests', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotAt(3).tick).toBe(3);
            expect(manager.snapshotAt(1).tick).toBe(1);
        });

        it('throws when no playback session is open', () => {
            const manager = makeManager();

            expect(() => manager.snapshotAt(0)).toThrow(/no .*playback/i);
        });
    });

    describe('snapshotRange', () => {
        it('returns projected PlayerSnapshots for an inclusive tick range (Inv #3)', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            const snaps = manager.snapshotRange(0, 3);

            expect(snaps.map((s) => s.tick)).toEqual([0, 1, 2, 3]);
            // Every element is a projected PlayerSnapshot — the host-internal
            // `seed` never crosses the boundary.
            expect(snaps.every((s) => !('seed' in s))).toBe(true);
        });

        it('returns a single snapshot when from === to', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            const snaps = manager.snapshotRange(2, 2);

            expect(snaps.map((s) => s.tick)).toEqual([2]);
        });

        it('serves a range after a prior non-sequential request', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');
            // Move the cursor away so the range start is non-sequential.
            expect(manager.snapshotAt(3).tick).toBe(3);

            const snaps = manager.snapshotRange(1, 2);

            expect(snaps.map((s) => s.tick)).toEqual([1, 2]);
        });

        it('throws when from is greater than to', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(() => manager.snapshotRange(3, 1)).toThrow(/from.*to/i);
        });

        it('throws when no playback session is open', () => {
            const manager = makeManager();

            expect(() => manager.snapshotRange(0, 1)).toThrow(/no .*playback/i);
        });
    });

    describe('non-zero base tick (second match in a session)', () => {
        it('reports totalTicks as the action count, independent of the base tick', async () => {
            const manager = makeManager(makeNonZeroBaseReplayFile(4, 3));

            const info = await manager.open('/replays/tactics/match2.chimera-replay');

            // The renderer scrubs 0..totalTicks; the final reachable state tick in
            // renderer space is the number of recorded actions, regardless of where
            // the absolute ticks start (here 4..7).
            expect(info.totalTicks).toBe(3);
        });

        it('serves a 0-based snapshot range without a StaleActionError', async () => {
            const manager = makeManager(makeNonZeroBaseReplayFile(4, 3));
            await manager.open('/replays/tactics/match2.chimera-replay');

            // Before the fix this threw `StaleActionError: action.tick (4) does not
            // match snapshot.tick (0)` because the player reconstructed at tick 0
            // while actions[0] was at tick 4. The renderer's 0-based ticks must map
            // onto the replay's absolute ticks (4..7).
            const snaps = manager.snapshotRange(0, 3);

            expect(snaps.map((s) => s.tick)).toEqual([4, 5, 6, 7]);
            expect(snaps.every((s) => !('seed' in s))).toBe(true);
        });

        it('resolves snapshotAt(0) to the match base tick', async () => {
            const manager = makeManager(makeNonZeroBaseReplayFile(4, 3));
            await manager.open('/replays/tactics/match2.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(4);
            expect(manager.snapshotAt(1).tick).toBe(5);
        });
    });

    describe('close', () => {
        it('ends the session so snapshotAt throws again', async () => {
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');
            manager.close();

            expect(() => manager.snapshotAt(0)).toThrow(/no .*playback/i);
        });
    });
});
