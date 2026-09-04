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

import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { TickContractError } from '@chimera-engine/simulation/engine/index.js';
import { UndoNotAllowedError } from '@chimera-engine/simulation/engine/UndoManager.js';
import type { ActionDefinition } from '@chimera-engine/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { ReplayFile } from '@chimera-engine/simulation/replay/index.js';
import {
    DeterminismError,
    ReplayPlayer,
    ReplaySeekError,
} from '@chimera-engine/simulation/replay/index.js';
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
            // Both arms of the fork answer the same request with the same
            // snapshot, so the tick assertions cannot tell them apart: replace
            // the whole fork with an unconditional `seek(absoluteTick)` and
            // every one of them still holds. What separates the arms is which
            // call the fork makes, so count those. Tick 0 is not `lastTick + 1`,
            // so it seeks; every tick after it is, so each takes one `step()`
            // and no further seek. `seek()` steps internally on its way to the
            // requested tick, which is why the SEEK count is the discriminator:
            // under the unconditional-seek mutant it is 3 rather than 1.
            const stepSpy = vi.spyOn(ReplayPlayer.prototype, 'step');
            const seekSpy = vi.spyOn(ReplayPlayer.prototype, 'seek');
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(0);
            expect(manager.snapshotAt(1).tick).toBe(1);
            expect(manager.snapshotAt(2).tick).toBe(2);

            expect(seekSpy).toHaveBeenCalledTimes(1);
            expect(seekSpy).toHaveBeenCalledWith(0);
            expect(stepSpy).toHaveBeenCalledTimes(2);
        });

        it('falls back to seek when the fast path runs out of recorded actions', async () => {
            // `makeReplayFile()` records 3 actions, so tick 3 is the last
            // reachable snapshot and the player's cursor is exhausted there.
            // Renderer tick 4 IS `lastTick + 1`, so the fork takes the fast
            // path and `step()` answers `null` — the `?? active.player.seek()`
            // arm is what produces the result, and it produces a refusal.
            // Drop that arm and the `null` reaches `state.tick`, so the failure
            // becomes a TypeError and the tick the fallback passes goes
            // unobserved.
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');
            expect(manager.snapshotAt(3).tick).toBe(3);

            let caught: unknown;
            try {
                manager.snapshotAt(4);
            } catch (error) {
                caught = error;
            }

            expect(caught).toBeInstanceOf(ReplaySeekError);
            // The tick the fallback hands `seek()` is the absolute tick asked
            // for, not the cursor it started from.
            expect((caught as ReplaySeekError).requestedTick).toBe(4);
            expect((caught as ReplaySeekError).finalTick).toBe(3);
        });

        it('serves the same tick again when a request repeats', async () => {
            // The cursor write after each projection is what makes a repeat
            // idempotent. Without it `lastTick` stays at `baseTick`, so the
            // fast path fires on EVERY call and each one steps the player
            // forward: the second snapshotAt(1) would answer with tick 2.
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(0);
            expect(manager.snapshotAt(1).tick).toBe(1);
            expect(manager.snapshotAt(1).tick).toBe(1);
        });

        it('serves the requested tick when a request skips ahead by two', async () => {
            // The cursor must record the tick actually produced, not one past
            // it. A cursor running one ahead makes this request look sequential,
            // so it would take the step() fast path and serve tick 1 — the frame
            // BEFORE the one asked for.
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(0);
            expect(manager.snapshotAt(2).tick).toBe(2);
        });

        // A third variant of the cursor write, `active.lastTick = absoluteTick`,
        // deliberately gets no case: it is equivalent over the reachable domain.
        // `seek(t)` returns a snapshot whose `.tick` is `t` or throws, and the
        // fast path is taken only when `absoluteTick === lastTick + 1`, which is
        // what `step()` returns.

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

        it('serves the same ticks when a range request repeats', async () => {
            // The production-shaped form of the same defect: the renderer
            // prefetches ranges. With the cursor write dropped the repeat
            // answers [3, 2] — the scrubber is handed a frame from the wrong
            // tick as the FIRST frame of the range it asked for.
            const manager = makeManager();
            await manager.open('/replays/match.chimera-replay');

            expect(manager.snapshotRange(1, 2).map((s) => s.tick)).toEqual([1, 2]);
            expect(manager.snapshotRange(1, 2).map((s) => s.tick)).toEqual([1, 2]);
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
    // ─── What the step() fast path actually rests on ─────────────────────────
    //
    // `#projectedAt` writes `active.lastTick = state.tick` from whatever `step()`
    // returns. That is safe because a recording the pipeline cannot advance by
    // exactly one is REFUSED, not served at an unexpected tick. The safety is a
    // property of the refusal, not of what recordings contain — nothing stops a
    // host recording an action no replay will accept.
    //
    // Both refusals are covered, because they are different layers and a
    // production build has only the second. A reducer that CHANGES the snapshot
    // without advancing is caught inside `pipeline.process` by the Stage 5
    // tick-contract check, which is development-only. One that returns its INPUT
    // REFERENCE is exempt there — a no-op need not advance — and reaches
    // `ReplayPlayer.step()`, whose own comparison reads no build flag.
    // That second case is the one the `#projectedAt` docblock argues from.
    describe('a recording the pipeline cannot advance by exactly one', () => {
        const stalledDef: ActionDefinition<Record<string, never>> = {
            type: 'game:stalled',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state) => ({ ...state, events: [...state.events, { type: 'game:stalled' }] }),
        };

        const inertDef: ActionDefinition<Record<string, never>> = {
            type: 'game:inert',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state) => state,
        };

        function makeManagerFor(type: string): ReplayPlaybackManager {
            const registry = makeRegistry();
            registry.register(stalledDef);
            registry.register(inertDef);
            const file: ReplayFile = {
                ...makeReplayFile(1),
                actions: [
                    { tick: 0, playerId: P1, action: { type, playerId: P1, tick: 0, payload: {} } },
                ],
            };
            return new ReplayPlaybackManager(
                registry,
                (gameId) => (gameId === 'tactics' ? passthroughRules : undefined),
                { load: () => Promise.resolve(file), getCurrentMatchFile: () => file },
                makeLogger(),
            );
        }

        it('names the reducer in a development build, where Stage 5 gets there first', async () => {
            // This suite is a development build, so the pipeline's tick-contract
            // check fires inside `process()` and its message carries the action
            // type. Fold that check off and the refusal still happens, one layer
            // later and without the name — which is the case below.
            const manager = makeManagerFor('game:stalled');
            await manager.open('/replays/stalled.chimera-replay');

            expect(() => manager.snapshotAt(1)).toThrow(TickContractError);
            expect(() => manager.snapshotAt(1)).toThrow(/game:stalled/u);
        });

        it('refuses an input-reference reducer via ReplayPlayer.step()', async () => {
            // The arm the `#projectedAt` docblock rests on: no Stage 5 check
            // fires here, so deleting `step()`'s own tick comparison would make
            // this the snapshot the manager serves — at tick 0, while
            // `lastTick` was told it reached 1.
            const manager = makeManagerFor('game:inert');
            await manager.open('/replays/inert.chimera-replay');

            expect(() => manager.snapshotAt(1)).toThrow(DeterminismError);
        });

        it('still serves the initial snapshot, so the refusal is about advancing', async () => {
            // Guards the two above against passing for the wrong reason: the
            // file opens, the base state projects, and only advancing past the
            // offending action fails.
            const manager = makeManagerFor('game:stalled');
            await manager.open('/replays/stalled.chimera-replay');

            expect(manager.snapshotAt(0).tick).toBe(0);
        });
    });

    /**
     * What a recorded `engine:undo` does here, which is the ground the call
     * site's "engine defaults" comment stands on. Both arms end playback; they
     * differ in which error, and in how far the replay got first.
     */
    describe('a recording carrying an engine:undo', () => {
        function makeManagerFor(actions: ReplayFile['actions']): ReplayPlaybackManager {
            const file: ReplayFile = { ...makeReplayFile(1), actions };
            return new ReplayPlaybackManager(
                makeRegistry(),
                (gameId) => (gameId === 'tactics' ? passthroughRules : undefined),
                { load: () => Promise.resolve(file), getCurrentMatchFile: () => file },
                makeLogger(),
            );
        }

        const undoAt = (tick: number, seat: typeof P1): ReplayFile['actions'][number] => ({
            tick,
            playerId: seat,
            action: { type: 'engine:undo', playerId: seat, tick, payload: { steps: 1 } },
        });

        it('ends playback at the undo even where the memento it needs exists, because the reconstruction moves the tick BACKWARDS', async () => {
            // `engine:end_turn` mints a memento on this path too — the
            // pipeline's own branch seeds one whenever the turn clock advances.
            // So this undo is ACCEPTED, and what refuses it is the tick
            // contract, not a policy.
            const manager = makeManagerFor([
                {
                    tick: 0,
                    playerId: P1,
                    action: { type: 'engine:end_turn', playerId: P1, tick: 0, payload: {} },
                },
                {
                    tick: 1,
                    playerId: P2,
                    action: { type: 'game:advance', playerId: P2, tick: 1, payload: {} },
                },
                undoAt(2, P2),
            ]);
            await manager.open('/replays/undo-after-handover.chimera-replay');

            // Everything before the undo replays, so the refusal is about the
            // undo and not about the file.
            expect(manager.snapshotAt(2).tick).toBe(2);

            // Captured from ONE call, not asserted twice: the first attempt
            // takes the undo step, so a second one is refused by the step
            // counter instead and never reaches the tick contract again.
            // The message is what carries the DIRECTION — `step()` refuses any
            // delta other than +1, so the class alone would be satisfied by a
            // forward-by-two reconstruction too.
            let thrown: unknown;
            try {
                manager.snapshotAt(3);
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(DeterminismError);
            expect((thrown as Error).message).toMatch(/advanced to 1 instead of 3/u);
        });

        it('ends it one layer earlier where no turn handover minted a memento', async () => {
            const manager = makeManagerFor([undoAt(0, P1)]);
            await manager.open('/replays/undo-first.chimera-replay');

            // The REASON, not just the class: `no_memento` is what says this
            // refusal came from the seat state, so threading the declared policy
            // — which would answer `policy_disallows` before this arm is
            // reached — is a change this case sees.
            expect(() => manager.snapshotAt(1)).toThrow(UndoNotAllowedError);
            expect(() => manager.snapshotAt(1)).toThrow(/no_memento/u);
        });
    });

    /** The `retainActions` half of the call site's comment. */
    it('replays without raising action-history:overflow on the playback log', async () => {
        const sink = createMemorySink();
        const logger = createLogger({
            source: { process: 'main', module: 'test' },
            sink,
        });
        const file = makeReplayFile(5);
        const manager = new ReplayPlaybackManager(
            makeRegistry(),
            (gameId) => (gameId === 'tactics' ? passthroughRules : undefined),
            { load: () => Promise.resolve(file), getCurrentMatchFile: () => file },
            logger,
        );
        await manager.open('/replays/five-actions.chimera-replay');
        manager.snapshotAt(5);

        expect(sink.entries.filter((entry) => entry.message === 'action-history:overflow')).toEqual(
            [],
        );
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
