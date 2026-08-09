/**
 * simulation/__tests__/beat-pass-replay.integration.test.ts
 *
 * The per-beat pass replays.
 *
 * A recorded match that opens a beat window, dilates time for a bounded number
 * of beats and then runs plain `engine:tick`s is driven end to end through
 * `ReplayPlayer` over the live `ActionPipeline`. `ReplayPlayer.step()` throws
 * `DeterminismError` unless each recorded action advances `tick` by exactly 1,
 * so the pass earning itself an extra action anywhere would stop the run.
 *
 * That is the whole reason the beat pass is dispatch-free: `ReplayPlayer` is
 * not edited by F82, and a nested dispatch of an action whose reducer advances
 * the clock inflates the outer `engine:tick` past +1.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Invariants upheld:
 *   #70/#71 — the recorded action sequence replays through the injected
 *             pipeline and reconstructs from seed + gameConfig only.
 */

import { describe, expect, it } from 'vitest';

import { ActionPipeline } from '../engine/ActionPipeline.js';
import { ActionRegistry } from '../engine/ActionRegistry.js';
import { AnimationWindowManager } from '../engine/AnimationWindow.js';
import type { AnimationWindowId } from '../engine/AnimationWindow.js';
import { engineTickDefinition } from '../engine/EngineActions.js';
import { applyTimeScale } from '../engine/TimeScale.js';
import type { ActionDefinition, BaseGameSnapshot, EntityId } from '../engine/types.js';
import { entityId, playerId as toPlayerId } from '../engine/types.js';
import type { ReplayFile } from '../replay/ReplayFile.js';
import {
    assertReplayDeterministic,
    createBaseReplayInitialSnapshot,
    ReplayPlayer,
} from '../replay/ReplayPlayer.js';

const GAME_ID = 'beat-replay-game';
const P1 = toPlayerId('p1');
const P2 = toPlayerId('p2');
const OWNER: EntityId = entityId('unit-1');
const WINDOW = 'sword-hit#1' as AnimationWindowId;

/** The match state, plus the one field this game's `onBeat` writes. */
interface BeatSnapshot extends BaseGameSnapshot {
    readonly closedWindows?: number;
}

/**
 * A game action that opens a beat window AND dilates time — the two writes a
 * game makes when it starts an animation. Advances the clock, which
 * `ReplayPlayer.step()` requires of every recorded action.
 */
const strikeDefinition: ActionDefinition<Record<string, never>, BeatSnapshot> = {
    type: 'test:strike',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce(state): BeatSnapshot {
        const opened = AnimationWindowManager.open(state, {
            id: WINDOW,
            ownerId: OWNER,
            durationBeats: 3,
            payload: { damage: 12 },
        });
        return applyTimeScale(
            { ...opened.next, tick: state.tick + 1 },
            {
                permille: 250,
                durationBeats: 2,
            },
        );
    },
};

function makeRegistry(): ActionRegistry<BeatSnapshot> {
    const registry = new ActionRegistry<BeatSnapshot>();
    registry.registerEngineAction(engineTickDefinition);
    registry.register(strikeDefinition);
    registry.registerGame(GAME_ID, {
        // The per-beat vehicle: counts the windows the sweep closed. Returns the
        // input reference on every beat that closes nothing, so an idle beat
        // stays a clock-only tick.
        onBeat: (state, _ctx, closed) =>
            closed.length === 0
                ? state
                : { ...state, closedWindows: (state.closedWindows ?? 0) + closed.length },
    });
    return registry;
}

function makeInitialSnapshot(file: ReplayFile): BeatSnapshot {
    return {
        ...createBaseReplayInitialSnapshot(file),
        entities: { [OWNER]: { id: OWNER } },
    };
}

/** `test:strike` at tick 0, then five plain beats. */
function makeReplayFile(): ReplayFile {
    const ticks = [1, 2, 3, 4, 5];
    return {
        formatVersion: 1,
        engineVersion: '0.7.0',
        gameId: GAME_ID,
        gameVersion: '0.1.0',
        gameConfig: {
            hostPlayerId: P1,
            playerIds: [P1, P2],
            firstPlayerId: P1,
            phase: 'playing',
        },
        seed: 12345,
        actions: [
            {
                tick: 0,
                playerId: P1,
                action: { type: 'test:strike', playerId: P1, tick: 0, payload: {} },
            },
            ...ticks.map((tick) => ({
                tick,
                playerId: P1,
                action: { type: 'engine:tick', playerId: P1, tick, payload: { seed: 12345 } },
            })),
        ],
        metadata: {
            recordedAt: '2026-08-09T10:00:00.000Z',
            durationTicks: 6,
            players: [
                { playerId: P1, displayName: 'Player One' },
                { playerId: P2, displayName: 'Player Two' },
            ],
        },
    };
}

function makePlayer(file: ReplayFile): ReplayPlayer<BeatSnapshot> {
    return new ReplayPlayer(file, new ActionPipeline(makeRegistry(), { gameId: GAME_ID }), (f) =>
        makeInitialSnapshot(f),
    );
}

describe('the per-beat pass replays', () => {
    it('advances tick by exactly 1 on every recorded action of a windowed, dilated match', () => {
        const player = makePlayer(makeReplayFile());
        player.initialize();

        const ticks: number[] = [];
        for (;;) {
            const next = player.step();
            if (next === null) break;
            ticks.push(next.tick);
        }

        // One action, one tick. `step()` would have thrown DeterminismError on
        // any other advance, so this list is also the pin's failure mode.
        //
        // This case is a MUTATION CONTROL, not a pin: measured, it is green
        // with the whole beat pass reverted — a pass that does not exist also
        // dispatches nothing. What it catches is the pass GROWING a dispatch.
        // The two cases below carry the red for the pass being present.
        expect(ticks).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('runs the window countdown, the dilation countdown and the hook to completion', () => {
        const player = makePlayer(makeReplayFile());
        player.initialize();

        const remaining: (number | undefined)[] = [];
        const permille: (number | undefined)[] = [];
        let final: BeatSnapshot | null = null;
        for (;;) {
            const next = player.step();
            if (next === null) break;
            final = next;
            remaining.push(next.animationWindows?.[WINDOW]?.remainingBeats);
            permille.push(next.timeScalePermille);
        }

        // `test:strike` opened a 3-beat window at 250‰ for 2 beats; the five
        // beats that follow spend both countdowns.
        expect(remaining).toEqual([3, 2, 1, 0, undefined, undefined]);
        expect(permille).toEqual([250, 250, 250, 1000, 1000, 1000]);

        // The hook saw the one closure the sweep produced, on the beat the
        // countdown ran out — not before, and not twice.
        expect(final?.closedWindows).toBe(1);
        expect(final?.animationWindows).toEqual({});
        expect(final).not.toHaveProperty('timeScaleRestoreBeats');
    });

    it('produces bit-identical runs from two independent players', () => {
        const file = makeReplayFile();

        const settled = assertReplayDeterministic(makePlayer(file), makePlayer(file));

        expect(settled.tick).toBe(6);
        expect(settled.closedWindows).toBe(1);
    });
});
