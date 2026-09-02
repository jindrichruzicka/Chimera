/**
 * apps/action/__tests__/replay-determinism.test.ts
 *
 * The action app's recorded actions, replayed through the ENGINE's own
 * `ReplayPlayer` over the live `ActionPipeline`.
 *
 * Why this lives at replay level rather than in the reducer unit suite: the
 * consequence of a reducer that does not advance the tick is not visible in the
 * reducer. `ActionPipeline.process()` takes `reduce`'s output verbatim, so the
 * match plays on; the refusal comes later, out of `ReplayPlayer.step()`, when
 * the recording is opened (Invariant #42 via #70/#71).
 *
 * Two shapes of test live here. The first drives a hand-written recording
 * holding one of each game action. The second drives GESTURES through the real
 * pipeline and records the APPLIED ones — see `recordGestures` — so an action
 * the app can still apply while doing nothing is caught here rather than in a
 * player's saved replay.
 */

import { describe, expect, it } from 'vitest';

import {
    ActionPipeline,
    ActionUnauthorizedError,
} from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    BaseGameSnapshot,
    EngineAction,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, playerId } from '@chimera-engine/simulation/engine/types.js';
import type { RecordedAction, ReplayFile } from '@chimera-engine/simulation/replay/ReplayFile.js';
import {
    assertReplayDeterministic,
    createBaseReplayInitialSnapshot,
    ReplayPlayer,
} from '@chimera-engine/simulation/replay/ReplayPlayer.js';

import {
    ACTION_GAME_ID,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
} from '../simulation/constants.js';
import { registerActionActions } from '../simulation/actions.js';
import { buildInitialActionEntities } from '../simulation/entities.js';
import { isActionPrimitiveEntity } from '../simulation/entity-guards.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');
const CUBE = entityId('primitive-cube');
const CONE = entityId('primitive-cone');

function makePipeline(): ActionPipeline<BaseGameSnapshot> {
    const registry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(registry);
    registerActionActions(registry);
    return new ActionPipeline(registry, { gameId: ACTION_GAME_ID });
}

/**
 * The seeded arena rides into playback on `gameConfig.initialEntities`, and
 * each `RecordedAction.tick` is the envelope tick, which Stage 1 pins to the
 * snapshot's own tick.
 */
function makeReplayFile(actions: readonly RecordedAction[]): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '1.0.0',
        gameId: ACTION_GAME_ID,
        gameVersion: '1.0.0',
        gameConfig: {
            hostPlayerId: P1,
            playerIds: [P1, P2],
            firstPlayerId: P1,
            phase: 'playing',
            initialEntities: buildInitialActionEntities([P1, P2]),
        },
        seed: 4242,
        actions,
        metadata: {
            recordedAt: '2026-09-02T00:00:00.000Z',
            durationTicks: actions.length,
            players: [
                { playerId: P1, displayName: 'One' },
                { playerId: P2, displayName: 'Two' },
            ],
        },
    };
}

/** One of each game action, in the order a player produces them. */
const HAND_WRITTEN: readonly RecordedAction[] = [
    {
        tick: 0,
        playerId: P1,
        action: {
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: 0,
            payload: { dx: 1, dy: -1 },
        },
    },
    {
        tick: 1,
        playerId: P1,
        action: {
            type: ACTION_SELECT_PRIMITIVE_ACTION,
            playerId: P1,
            tick: 1,
            payload: { entityId: 'primitive-cone' },
        },
    },
];

function makePlayer(
    actions: readonly RecordedAction[] = HAND_WRITTEN,
): ReplayPlayer<BaseGameSnapshot> {
    return new ReplayPlayer(
        makeReplayFile(actions),
        makePipeline(),
        createBaseReplayInitialSnapshot,
    );
}

interface Gesture {
    readonly type: string;
    readonly playerId: PlayerId;
    readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Plays `gestures` through the real pipeline from the same initial snapshot
 * playback reconstructs, and returns one entry per APPLIED action.
 * `HostSessionPipeline.processAction` runs its recording arm below a
 * `process()` that returned, so a gesture the pipeline refuses cannot reach it
 * — see that function for the conditions the arm itself carries.
 *
 * Only `ActionUnauthorizedError` is treated as a refusal — any other throw is a
 * defect and propagates.
 */
function recordGestures(gestures: readonly Gesture[]): readonly RecordedAction[] {
    const pipeline = makePipeline();
    let snapshot = createBaseReplayInitialSnapshot(makeReplayFile([]));
    const recorded: RecordedAction[] = [];

    for (const gesture of gestures) {
        const action: EngineAction = {
            type: gesture.type,
            playerId: gesture.playerId,
            tick: snapshot.tick,
            payload: gesture.payload,
        };
        try {
            snapshot = pipeline.process(snapshot, action);
        } catch (err) {
            if (err instanceof ActionUnauthorizedError) continue;
            throw err;
        }
        recorded.push({ tick: action.tick, playerId: action.playerId, action });
    }

    return recorded;
}

describe('an action-app recording replayed through ReplayPlayer', () => {
    it('replays every recorded action to completion without a DeterminismError', () => {
        const player = makePlayer();

        expect(() => player.playSync()).not.toThrow();
    });

    it('advances one tick per recorded action', () => {
        const player = makePlayer();
        const initial = player.initialize();

        const afterVelocity = player.step();
        const afterSelect = player.step();

        expect(initial.tick).toBe(0);
        expect(afterVelocity?.tick).toBe(1);
        expect(afterSelect?.tick).toBe(2);
    });

    it('reproduces the recorded gameplay, not just the clock', () => {
        // A reducer that advanced the tick and did nothing else would satisfy
        // the determinism check while replaying an empty match. Each action's
        // own effect is asserted on the snapshot that action produced: the
        // velocity is read at the FIRST step, because the second action
        // releases the cube and zeroes it again.
        const player = makePlayer();
        const afterVelocity = player.step();
        const afterSelect = player.step();

        const cube = afterVelocity?.entities[CUBE];
        if (!isActionPrimitiveEntity(cube)) throw new Error('no cube in the replayed arena');
        expect(cube.dx).toBe(1);
        expect(cube.dy).toBe(-1);

        const cone = afterSelect?.entities[CONE];
        if (!isActionPrimitiveEntity(cone)) throw new Error('no cone in the replayed arena');
        expect(cone.ownerId).toBe(P1);
    });

    it('produces the same run twice from seed plus recorded actions', () => {
        // Invariants #70/#71: playback is the live pipeline fed a seed and a
        // log, so two independent players must agree at every step.
        expect(() => assertReplayDeterministic(makePlayer(), makePlayer())).not.toThrow();
    });
});

describe('what an action-app match actually records', () => {
    // The gestures a player can make with the mouse and the arrow keys,
    // including the redundant one: clicking the primitive you already drive.
    const GESTURES: readonly Gesture[] = [
        {
            type: ACTION_SELECT_PRIMITIVE_ACTION,
            playerId: P1,
            payload: { entityId: 'primitive-cone' },
        },
        {
            type: ACTION_SELECT_PRIMITIVE_ACTION,
            playerId: P1,
            payload: { entityId: 'primitive-cone' },
        },
        { type: ACTION_SET_VELOCITY_ACTION, playerId: P1, payload: { dx: 1, dy: 0 } },
        { type: ACTION_SET_VELOCITY_ACTION, playerId: P1, payload: { dx: 0, dy: 0 } },
    ];

    it('refuses the redundant re-selection instead of recording it', () => {
        // An action the pipeline applies while changing nothing is an entry
        // the replay cannot play. The refusal is what keeps it off the path to
        // the recorder.
        const recorded = recordGestures(GESTURES);

        expect(recorded.map((entry) => entry.action.type)).toEqual([
            ACTION_SELECT_PRIMITIVE_ACTION,
            ACTION_SET_VELOCITY_ACTION,
            ACTION_SET_VELOCITY_ACTION,
        ]);
    });

    it('replays the recording those gestures produce to completion', () => {
        const player = makePlayer(recordGestures(GESTURES));

        expect(() => player.playSync()).not.toThrow();
    });
});
