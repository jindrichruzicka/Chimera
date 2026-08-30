/**
 * apps/action/__tests__/realtime-beat.test.ts
 *
 * The realtime lifecycle, end to end through the ENGINE's own pipeline.
 *
 * The action app is the engine's first realtime consumer, and the chain that
 * makes it one has three links:
 *
 *   1. `actionManifest.realtime` + `tickRateMs` — what the host reads to decide
 *      whether to arm a `RealtimeTicker` and at what rate (`resolveTickerHz`).
 *   2. the ticker's dispatch — an `engine:tick` envelope through
 *      `ActionPipeline.process()`.
 *   3. the game's `onBeat` hook, which `engine:tick` runs at the end of the beat
 *      pass and which is where a primitive actually moves.
 *
 * The unit suites cover link 3 in isolation. This one joins all three: it asks
 * the engine's own reader what rate the manifest declares, then drives the SAME
 * `process()` call the ticker's `dispatch` callback makes, so a movement pass
 * that works when called directly but is never reached from `engine:tick`
 * (registered under the wrong game id, or not registered at all) fails here.
 *
 * What it deliberately does NOT do is start a real `RealtimeTicker`: the ticker
 * is `electron/main/runtime` internal, unreachable through the package `exports`
 * map, and a wall-clock timer proves nothing here that a fake one would not.
 * The Electron-side arming is the e2e suite's.
 */

import { describe, expect, it } from 'vitest';

import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { resolveTickerHz } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    EntityId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';

import { actionManifest } from '../manifest.js';
import {
    ACTION_ARENA_MAX_X,
    ACTION_GAME_ID,
    ACTION_SET_VELOCITY_ACTION,
    ACTION_TICK_RATE_MS,
} from '../simulation/constants.js';
import { registerActionActions } from '../simulation/actions.js';
import { buildInitialActionEntities } from '../simulation/entities.js';
import { isActionPrimitiveEntity } from '../simulation/entity-guards.js';

const P1 = playerId('player-1');
const CUBE = 'primitive-cube' as EntityId;

function makePipeline(): ActionPipeline<BaseGameSnapshot> {
    const registry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(registry);
    registerActionActions(registry);
    return new ActionPipeline(registry, { gameId: ACTION_GAME_ID });
}

function makeSnapshot(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 1234,
        players: { [P1]: { id: P1 } },
        entities: buildInitialActionEntities([P1]),
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        timers: {},
        gameResult: null,
    };
}

/** The envelope the host's ticker builds, stamped off the live snapshot. */
function tickEnvelope(snapshot: BaseGameSnapshot): ActionEnvelope {
    return {
        type: 'engine:tick',
        playerId: P1,
        tick: snapshot.tick,
        payload: { seed: snapshot.seed },
    };
}

function cubeAt(snapshot: BaseGameSnapshot): { readonly x: number; readonly y: number } {
    const entity = snapshot.entities[CUBE];
    if (!isActionPrimitiveEntity(entity)) throw new Error('no cube in the arena');
    return { x: entity.x, y: entity.y };
}

describe('the action app’s realtime lifecycle', () => {
    it('declares a heartbeat the host will arm a ticker for', () => {
        // `resolveTickerHz` returns null for a turn-based game — which is what a
        // dropped `realtime: true` would look like, and the shape in which the
        // whole loop silently stops existing.
        const hz = resolveTickerHz(actionManifest);

        expect(hz).not.toBeNull();
        expect(hz).toBeCloseTo(1000 / ACTION_TICK_RATE_MS, 10);
    });

    it('advances the engine tick on each dispatched beat', () => {
        const pipeline = makePipeline();
        let snapshot = makeSnapshot();

        snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));

        expect(snapshot.tick).toBe(1);
    });

    it('runs the game’s movement pass from engine:tick, not just when called directly', () => {
        // The link this test exists for: the beat hook is reached through the
        // GAME DEFINITION the pipeline resolves by id. Registered under a
        // different id — or not registered — every unit test of the movement
        // pass still passes and nothing ever moves in a match.
        const pipeline = makePipeline();
        let snapshot = makeSnapshot();

        snapshot = pipeline.process(snapshot, {
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: snapshot.tick,
            payload: { dx: 1, dy: 0 },
        });
        const before = cubeAt(snapshot);

        snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));

        expect(cubeAt(snapshot).x).toBe(before.x + 1);
    });

    it('keeps moving on every subsequent beat without a new action', () => {
        // A velocity is a standing order: one action, then movement per beat.
        const pipeline = makePipeline();
        let snapshot = makeSnapshot();
        snapshot = pipeline.process(snapshot, {
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: snapshot.tick,
            payload: { dx: 1, dy: 0 },
        });
        const start = cubeAt(snapshot);

        for (let beat = 0; beat < 3; beat += 1) {
            snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));
        }

        expect(cubeAt(snapshot).x).toBe(start.x + 3);
    });

    it('stops at the arena wall and stays there however many beats run', () => {
        const pipeline = makePipeline();
        let snapshot = makeSnapshot();
        snapshot = pipeline.process(snapshot, {
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: snapshot.tick,
            payload: { dx: 1, dy: 0 },
        });

        for (let beat = 0; beat < 40; beat += 1) {
            snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));
        }

        expect(cubeAt(snapshot).x).toBe(ACTION_ARENA_MAX_X);
    });

    it('leaves a stationary arena unchanged across beats', () => {
        // Nobody has pressed anything: the beat must advance the clock and
        // nothing else, or an idle match drifts.
        const pipeline = makePipeline();
        let snapshot = makeSnapshot();
        const start = cubeAt(snapshot);

        for (let beat = 0; beat < 5; beat += 1) {
            snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));
        }

        expect(cubeAt(snapshot)).toEqual(start);
        expect(snapshot.tick).toBe(5);
    });

    it('replays a recorded beat sequence to the same state', () => {
        // Invariant #70: the beat is an ordinary reduce, so the same envelopes
        // in the same order reproduce the same snapshot on another machine.
        const run = (): BaseGameSnapshot => {
            const pipeline = makePipeline();
            let snapshot = makeSnapshot();
            snapshot = pipeline.process(snapshot, {
                type: ACTION_SET_VELOCITY_ACTION,
                playerId: P1,
                tick: snapshot.tick,
                payload: { dx: 1, dy: -1 },
            });
            for (let beat = 0; beat < 6; beat += 1) {
                snapshot = pipeline.process(snapshot, tickEnvelope(snapshot));
            }
            return snapshot;
        };

        expect(run().entities).toEqual(run().entities);
        // …and to a state the run actually reaches, so "identical" is not
        // identical-to-nothing-happened.
        expect(cubeAt(run())).not.toEqual(cubeAt(makeSnapshot()));
    });
});
