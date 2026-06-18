/**
 * games/tactics/ai/tacticsPolicy.test.ts
 *
 * Unit tests for the tactics AI policy (issue #725).
 *
 * Architecture reference: §4 — AI Framework; game-owned policy built on `ai/`.
 * Tests written first (TDD — red confirmed before implementation).
 *
 * Invariants upheld:
 *   #16 — the policy only emits EngineActions (dispatched through ActionPipeline);
 *          no direct state mutation.
 *   Determinism — decisions are a pure function of the projected snapshot; no
 *          `Math.random`, wall-clock, or I/O. "Random" wander derives from tick.
 */

import { describe, it, expect } from 'vitest';
import { makeStubPlayerSnapshot } from '@chimera/simulation/engine/__test-support__/stubs.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_BOARD_MAX_X,
    TACTICS_BOARD_MAX_Y,
    TACTICS_BOARD_MIN_X,
    TACTICS_BOARD_MIN_Y,
    TACTICS_COMMIT_ACTION,
    TACTICS_MAX_STAMINA,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera/games/tactics/constants.js';
import type { EntityId, PlayerId } from '@chimera/simulation/engine/types.js';
import { entityId, playerId } from '@chimera/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera/ai/engine/AITypes.js';
import type { CommandContext } from '@chimera/ai/engine/CommandContext.js';
import type { CommandScheduler } from '@chimera/ai/engine/CommandScheduler.js';
import type { EngineAction } from '@chimera/simulation/engine/types.js';
import { createTacticsAIState, decideTacticsAction } from './tacticsPolicy.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const VIEWER = playerId('ai-1');
const ENEMY = playerId('player-1');
const MY_UNIT = entityId('my-unit');
const ENEMY_UNIT = entityId('enemy-unit');

interface UnitSpec {
    readonly id: EntityId;
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly hp?: number;
    readonly visibleTo?: readonly PlayerId[];
}

function makeSnapshot(opts: {
    readonly tick?: number;
    readonly isMyTurn?: boolean;
    readonly stamina?: number | null;
    readonly units?: readonly UnitSpec[];
    readonly turnMode?: 'sequential' | 'commitment';
}): PlayerSnapshot {
    const entities: Record<string, unknown> = {};
    for (const unit of opts.units ?? []) {
        entities[unit.id] = {
            id: unit.id,
            kind: 'unit',
            ownerId: unit.ownerId,
            x: unit.x,
            y: unit.y,
            hp: unit.hp ?? 1,
            ...(unit.visibleTo !== undefined ? { visibleTo: unit.visibleTo } : {}),
        };
    }
    const viewerStamina =
        opts.stamina === null
            ? null
            : { current: opts.stamina ?? TACTICS_MAX_STAMINA, max: TACTICS_MAX_STAMINA };
    const players: Record<string, unknown> = {
        [VIEWER]: { id: VIEWER, stamina: viewerStamina },
        [ENEMY]: { id: ENEMY, stamina: null },
    };
    return {
        ...makeStubPlayerSnapshot(opts.tick ?? 1),
        viewerId: VIEWER,
        isMyTurn: opts.isMyTurn ?? true,
        entities: entities as PlayerSnapshot['entities'],
        players: players as PlayerSnapshot['players'],
        ...(opts.turnMode === undefined
            ? {}
            : {
                  setup: {
                      matchSettings: { [TACTICS_TURN_MODE_SETTING]: opts.turnMode },
                      playerAttributes: {},
                  },
              }),
    };
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

function inBounds(x: number, y: number): boolean {
    return (
        x >= TACTICS_BOARD_MIN_X &&
        x <= TACTICS_BOARD_MAX_X &&
        y >= TACTICS_BOARD_MIN_Y &&
        y <= TACTICS_BOARD_MAX_Y
    );
}

// ─── decideTacticsAction ──────────────────────────────────────────────────────

describe('decideTacticsAction', () => {
    it('returns null when it is not the AI player turn', () => {
        const snapshot = makeSnapshot({
            isMyTurn: false,
            units: [{ id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 }],
        });

        expect(decideTacticsAction(snapshot, VIEWER)).toBeNull();
    });

    it('selects a legal adjacent move when no enemy is visible (AC1)', () => {
        const snapshot = makeSnapshot({
            units: [{ id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 }],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe(TACTICS_MOVE_UNIT_ACTION);
        expect(action?.playerId).toBe(VIEWER);
        expect(action?.payload['unitId']).toBe(MY_UNIT);
        const x = action?.payload['x'] as number;
        const y = action?.payload['y'] as number;
        expect(inBounds(x, y)).toBe(true);
        expect(manhattan(x, y, 0, 0)).toBe(1);
    });

    it('attacks a visible enemy on an adjacent different tile (AC2)', () => {
        const snapshot = makeSnapshot({
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe(TACTICS_ATTACK_ACTION);
        expect(action?.payload['attackerId']).toBe(MY_UNIT);
        expect(action?.payload['defenderId']).toBe(ENEMY_UNIT);
    });

    it('vacates a shared tile (moves to become adjacent) instead of attacking (AC3)', () => {
        const snapshot = makeSnapshot({
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 0, y: 0 },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe(TACTICS_MOVE_UNIT_ACTION);
        const x = action?.payload['x'] as number;
        const y = action?.payload['y'] as number;
        expect(inBounds(x, y)).toBe(true);
        // After vacating the shared tile the unit is adjacent to the enemy.
        expect(manhattan(x, y, 0, 0)).toBe(1);
    });

    it('moves toward a visible-but-distant enemy, reducing Manhattan distance', () => {
        const snapshot = makeSnapshot({
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 2, y: 0 },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe(TACTICS_MOVE_UNIT_ACTION);
        const x = action?.payload['x'] as number;
        const y = action?.payload['y'] as number;
        expect(inBounds(x, y)).toBe(true);
        expect(manhattan(x, y, 2, 0)).toBeLessThan(manhattan(0, 0, 2, 0));
    });

    it('does not attack an enemy that is not visible to the AI', () => {
        const snapshot = makeSnapshot({
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                // visibleTo present but excludes VIEWER → not visible (omniscient-mode robustness)
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0, visibleTo: [ENEMY] },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).not.toBe(TACTICS_ATTACK_ACTION);
    });

    it('ends the turn when stamina is exhausted (AC4)', () => {
        const snapshot = makeSnapshot({
            stamina: 0,
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe('engine:end_turn');
        expect(action?.playerId).toBe(VIEWER);
    });

    it('is deterministic — identical snapshot yields an identical action (AC5)', () => {
        const build = (): PlayerSnapshot =>
            makeSnapshot({ tick: 7, units: [{ id: MY_UNIT, ownerId: VIEWER, x: 1, y: 0 }] });

        expect(decideTacticsAction(build(), VIEWER)).toEqual(decideTacticsAction(build(), VIEWER));
    });
});

// ─── decideTacticsAction — commitment (simultaneous) turn mode ──────────────────

/**
 * In commitment mode End Turn is gated until every seat commits, so the AI must
 * end its turn by emitting `tactics:commit` (the host then auto-synthesises the
 * reveal End Turn once the set completes). Sequential mode is unchanged. The AI
 * reads the mode off the projected `setup.matchSettings` (projected verbatim by
 * the StateProjector), so it never needs a host-local field.
 */
describe('decideTacticsAction — commitment (simultaneous) turn mode', () => {
    it('commits instead of ending the turn when stamina is exhausted', () => {
        const snapshot = makeSnapshot({
            turnMode: 'commitment',
            stamina: 0,
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 },
            ],
        });

        const action = decideTacticsAction(snapshot, VIEWER);

        expect(action?.type).toBe(TACTICS_COMMIT_ACTION);
        expect(action?.playerId).toBe(VIEWER);
    });

    it('commits when the AI owns no actable unit', () => {
        const snapshot = makeSnapshot({
            turnMode: 'commitment',
            units: [{ id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 }],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).toBe(TACTICS_COMMIT_ACTION);
    });

    it('still moves/attacks while it has stamina (commit only replaces the end-turn step)', () => {
        const snapshot = makeSnapshot({
            turnMode: 'commitment',
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 },
            ],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).toBe(TACTICS_ATTACK_ACTION);
    });

    it('returns null once it has committed (isMyTurn flips false after the commit)', () => {
        const snapshot = makeSnapshot({
            turnMode: 'commitment',
            isMyTurn: false,
            stamina: 0,
            units: [{ id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 }],
        });

        expect(decideTacticsAction(snapshot, VIEWER)).toBeNull();
    });

    it('still emits engine:end_turn (not commit) in sequential mode', () => {
        const snapshot = makeSnapshot({
            turnMode: 'sequential',
            stamina: 0,
            units: [{ id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 }],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).toBe('engine:end_turn');
    });
});

// ─── decideTacticsAction — omniscient snapshot (projection bypassed) ────────────

/**
 * An omniscient agent receives `{ ...fullState, viewerId, ... }` (projection
 * bypassed): the viewer's player state is the raw `{ id }` (no stamina), and the
 * raw `playerStamina` ledger + `turnNumber`/`turnClock` ride along on the object.
 */
function makeOmniscientSnapshot(opts: {
    readonly turnNumber: number;
    readonly refreshedTurn: number;
    readonly current: number;
    readonly units: readonly UnitSpec[];
}): PlayerSnapshot {
    const entities: Record<string, unknown> = {};
    for (const unit of opts.units) {
        entities[unit.id] = {
            id: unit.id,
            kind: 'unit',
            ownerId: unit.ownerId,
            x: unit.x,
            y: unit.y,
            hp: unit.hp ?? 1,
            ...(unit.visibleTo !== undefined ? { visibleTo: unit.visibleTo } : {}),
        };
    }
    return {
        ...makeStubPlayerSnapshot(1),
        viewerId: VIEWER,
        isMyTurn: true,
        entities: entities as PlayerSnapshot['entities'],
        players: { [VIEWER]: { id: VIEWER }, [ENEMY]: { id: ENEMY } },
        playerStamina: {
            [VIEWER]: {
                current: opts.current,
                max: TACTICS_MAX_STAMINA,
                refreshedTurn: opts.refreshedTurn,
            },
        },
        turnNumber: opts.turnNumber,
        turnClock: { activePlayerId: VIEWER, deadlineMs: 30_000 },
    } as unknown as PlayerSnapshot;
}

describe('decideTacticsAction — omniscient snapshot (projection bypassed)', () => {
    it('ends the turn when the raw stamina ledger is spent within the current turn', () => {
        // refreshedTurn === turnNumber → no start-of-turn refresh → effective 0.
        const snapshot = makeOmniscientSnapshot({
            turnNumber: 5,
            refreshedTurn: 5,
            current: 0,
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0, visibleTo: [ENEMY, VIEWER] },
            ],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).toBe('engine:end_turn');
    });

    // Regression guard (passes pre- and post-fix): pins that the raw-ledger
    // fallback still applies the start-of-turn refresh, so the omniscient AI is
    // NOT wrongly frozen by a stale `current: 0` carried over from last turn.
    it('acts at the start of a fresh turn (ledger refreshes to max even if current is stale 0)', () => {
        // turnNumber > refreshedTurn → refreshed to max → it can attack.
        const snapshot = makeOmniscientSnapshot({
            turnNumber: 6,
            refreshedTurn: 5,
            current: 0,
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0, visibleTo: [ENEMY, VIEWER] },
            ],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).toBe(TACTICS_ATTACK_ACTION);
    });

    // Combination coverage: the visibility gate (exercised on the projected path
    // at "does not attack an enemy that is not visible") must also hold under the
    // omniscient fixture, where every enemy is present and `visibleTo` is the gate.
    it('honours visibleTo — does not attack an omniscient-visible enemy that has not been revealed', () => {
        const snapshot = makeOmniscientSnapshot({
            turnNumber: 6,
            refreshedTurn: 5,
            current: 0,
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                // Adjacent, but visibleTo excludes the viewer → engine would reject an attack.
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0, visibleTo: [ENEMY] },
            ],
        });

        expect(decideTacticsAction(snapshot, VIEWER)?.type).not.toBe(TACTICS_ATTACK_ACTION);
    });
});

// ─── createTacticsAIState ─────────────────────────────────────────────────────

const NOOP_SCHEDULER = {} as unknown as CommandScheduler;

function makeRecordingContext(): { context: CommandContext; dispatched: EngineAction[] } {
    const dispatched: EngineAction[] = [];
    return {
        dispatched,
        context: {
            dispatch: (action) => dispatched.push(action),
            transitionState: () => undefined,
        },
    };
}

describe('createTacticsAIState', () => {
    it('is named tactics:auto-play', () => {
        expect(createTacticsAIState(VIEWER).name).toBe('tactics:auto-play');
    });

    it('dispatches the decided action on idle', () => {
        const snapshot = makeSnapshot({
            units: [
                { id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 },
                { id: ENEMY_UNIT, ownerId: ENEMY, x: 1, y: 0 },
            ],
        });
        const { context, dispatched } = makeRecordingContext();

        createTacticsAIState(VIEWER).onIdle(snapshot, snapshot.tick, {}, NOOP_SCHEDULER, context);

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.type).toBe(TACTICS_ATTACK_ACTION);
    });

    it('dispatches nothing on idle when it is not the AI turn', () => {
        const snapshot = makeSnapshot({
            isMyTurn: false,
            units: [{ id: MY_UNIT, ownerId: VIEWER, x: 0, y: 0 }],
        });
        const { context, dispatched } = makeRecordingContext();

        createTacticsAIState(VIEWER).onIdle(snapshot, snapshot.tick, {}, NOOP_SCHEDULER, context);

        expect(dispatched).toHaveLength(0);
    });
});
