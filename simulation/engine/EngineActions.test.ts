/**
 * simulation/engine/EngineActions.test.ts
 *
 * TDD tests for EngineActions reserved action definitions.
 *
 * Architecture reference: §4.2, §4.7
 * Task: F03 / T4
 *
 * These tests are written FIRST against the not-yet-existing module.
 * They express the acceptance criteria:
 *   - engine:tick and engine:end_turn exist with correct type strings
 *   - Both have valid type guards (parsePayload) and stub reducers
 *   - registerEngineActions() registers both without throwing NamespaceCollisionError
 *   - registry.has("engine:tick") returns true after registration
 */

import { describe, it, expect, beforeEach, expectTypeOf, vi } from 'vitest';
import { ActionRegistry } from './ActionRegistry.js';
import {
    EngineActions,
    registerEngineActions,
    engineTickDefinition,
    engineEndTurnDefinition,
    engineSaveDefinition,
    engineLoadDefinition,
    engineUndoDefinition,
    engineRedoDefinition,
    engineSyncRequestDefinition,
    engineStartGameDefinition,
    engineReturnToLobbyDefinition,
} from './EngineActions.js';
import { makeStubRng } from './__test-support__/stubs.js';
import type { BaseGameSnapshot, PlayerId, ReduceContext, ValidationResult } from './types.js';
import { entityId, gamePhase, isReduceContext, playerId as toPlayerId, sceneId } from './types.js';
import type { GameTimer, TimerId, TimerRegistry } from './GameTimer.js';
import { TimerManager } from './GameTimer.js';
import type { AnimationWindowId, AnimationWindowRegistry } from './AnimationWindow.js';
import { AnimationWindowManager } from './AnimationWindow.js';
import type { AssetRef } from '../foundation/asset-contract.js';
import { SceneRegistry } from '../scene/SceneRegistry.js';
import { registerDefaultScenes } from '../scene/DefaultScenes.js';
import { ActionUnauthorizedError } from './ActionPipeline.js';
import type { Logger } from '../foundation/logging.js';
import { createContentDatabase } from '../content/index.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────────

const makeSnapshot = (hostPlayerId?: PlayerId): BaseGameSnapshot => ({
    tick: 0,
    seed: 42,
    players: {},
    entities: {},
    phase: 'waiting' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber: 0,
    timers: {},
    gameResult: null,
    ...(hostPlayerId !== undefined && { hostPlayerId }),
});

const stubCtx = { rng: makeStubRng(0.5), dispatchDepth: 0 };
const hostId = toPlayerId('p1');
const guestId = toPlayerId('p2');

const makeTurnSnapshot = (activePlayerId: PlayerId, deadlineMs?: number): BaseGameSnapshot => ({
    ...makeSnapshot(),
    players: {
        [hostId]: { id: hostId },
        [guestId]: { id: guestId },
        [toPlayerId('p3')]: { id: toPlayerId('p3') },
    },
    ...(deadlineMs === undefined
        ? {}
        : {
              turnClock: {
                  activePlayerId,
                  deadlineMs,
              },
          }),
});

/**
 * The three match-scoped F82 fields, as a mid-match snapshot would carry them:
 * an active dilation, a pending restore and one open beat window.
 */
const makeDilatedMatchState = (): Pick<
    BaseGameSnapshot,
    'timeScalePermille' | 'timeScaleRestoreBeats' | 'animationWindows'
> => {
    const windowId = 'sword-hit#1' as AnimationWindowId;
    const animationWindows: AnimationWindowRegistry = {
        [windowId]: {
            id: windowId,
            ownerId: entityId('unit-1'),
            remainingBeats: 3,
            payload: { damage: 12 },
        },
    };
    return { timeScalePermille: 250, timeScaleRestoreBeats: 4, animationWindows };
};

// ─── EngineActions array ──────────────────────────────────────────────────────

describe('EngineActions array', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(EngineActions)).toBe(true);
        expect(EngineActions.length).toBeGreaterThan(0);
    });

    it('contains exactly nine definitions', () => {
        expect(EngineActions).toHaveLength(9);
    });

    it('contains an engine:tick definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:tick');
        expect(definition).toBeDefined();
    });

    it('contains an engine:end_turn definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:end_turn');
        expect(definition).toBeDefined();
    });

    it('contains an engine:save definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:save');
        expect(definition).toBeDefined();
    });

    it('contains an engine:load definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:load');
        expect(definition).toBeDefined();
    });

    it('contains an engine:undo definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:undo');
        expect(definition).toBeDefined();
    });

    it('contains an engine:redo definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:redo');
        expect(definition).toBeDefined();
    });

    it('contains an engine:sync_request definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:sync_request');
        expect(definition).toBeDefined();
    });

    it('contains an engine:start_game definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:start_game');
        expect(definition).toBeDefined();
    });

    it('contains an engine:return_to_lobby definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:return_to_lobby');
        expect(definition).toBeDefined();
    });
});

// ─── engine:tick definition ───────────────────────────────────────────────────

describe('engine:tick definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:tick');
        if (!d) throw new Error('engine:tick not found');
        return d;
    };

    it('has type string "engine:tick"', () => {
        expect(definition().type).toBe('engine:tick');
    });

    it('parsePayload accepts a valid { seed: number } payload', () => {
        const raw = { seed: 123 };
        expect(() => definition().parsePayload(raw)).not.toThrow();
    });

    it('parsePayload returns the payload unchanged on valid input', () => {
        const raw = { seed: 99 };
        const parsed = definition().parsePayload(raw);
        expect(parsed).toEqual({ seed: 99 });
    });

    it('parsePayload throws on missing seed field', () => {
        expect(() => definition().parsePayload({})).toThrow();
    });

    it('parsePayload throws when seed is not a number', () => {
        expect(() => definition().parsePayload({ seed: 'bad' })).toThrow();
    });

    it('parsePayload throws when seed is NaN (invariant #42)', () => {
        expect(() => definition().parsePayload({ seed: Number.NaN })).toThrow(TypeError);
    });

    it('parsePayload throws when seed is +Infinity (invariant #42)', () => {
        expect(() => definition().parsePayload({ seed: Number.POSITIVE_INFINITY })).toThrow(
            TypeError,
        );
    });

    it('parsePayload throws when seed is -Infinity (invariant #42)', () => {
        expect(() => definition().parsePayload({ seed: Number.NEGATIVE_INFINITY })).toThrow(
            TypeError,
        );
    });

    it('parsePayload throws when seed is a non-integer float (invariant #42)', () => {
        expect(() => definition().parsePayload({ seed: 3.14 })).toThrow(TypeError);
    });

    it('parsePayload accepts negative-zero seed (Number.isInteger(-0) === true)', () => {
        expect(() => definition().parsePayload({ seed: -0 })).not.toThrow();
    });

    it('parsePayload accepts negative integer seed', () => {
        const parsed = definition().parsePayload({ seed: -42 });
        expect(parsed).toEqual({ seed: -42 });
    });

    it('validate returns ok: true', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({ seed: 1 }, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    it('reduce with empty timer registry advances the logical tick by one', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, { seed: 7 }, hostId, stubCtx);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers).toStrictEqual({});
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot();
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, { seed: 7 }, hostId, stubCtx)).not.toThrow();
    });

    // A lobby-phase beat is NOT inert. `validate` admits `engine:tick` in every
    // phase, so a heartbeat armed before the match begins still advances the
    // clock — shifting the tick the eventual `engine:start_game` is stamped
    // with, and landing in the deterministic recording ahead of it. That is
    // what makes the host's pre-start window a correctness question rather than
    // a tolerable one; the host gate that closes it lives in
    // `electron/main/index.ts::tryStartGame`.
    it('reduce on a lobby-phase snapshot advances the tick and leaves every other field alone', () => {
        const snapshot: BaseGameSnapshot = {
            ...makeSnapshot(hostId),
            phase: gamePhase('lobby'),
            tick: 4,
        };
        expect(definition().reduce(snapshot, { seed: 7 }, hostId, stubCtx)).toStrictEqual({
            tick: 5,
            seed: 42,
            players: {},
            entities: {},
            phase: gamePhase('lobby'),
            events: [],
            turnNumber: 0,
            timers: {},
            gameResult: null,
            hostPlayerId: hostId,
        });
    });
});

// ─── engine:tick — timer wiring (§4.20) ──────────────────────────────────────

/**
 * Minimal timer factory for tick-wiring tests.
 * Avoids duplicating GameTimer.test.ts fixtures.
 */
function makeTickTimer(overrides: Partial<GameTimer> = {}): GameTimer {
    return {
        id: 'tmr-1' as TimerId,
        remainingTicks: 3,
        intervalTicks: 0,
        actionType: 'game:test_action',
        payload: {},
        active: true,
        ...overrides,
    };
}

function makeTimerSnapshot(timers: TimerRegistry): BaseGameSnapshot {
    return { ...makeSnapshot(), timers };
}

/**
 * Capturing logger fake — records warn calls without network or I/O.
 * A fake (not a mock): real behaviour, observable state.
 */
function makeCapturingLogger(): {
    logger: Logger;
    warns: { msg: string; ctx?: Record<string, unknown> }[];
} {
    const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: (msg: string, ctx?: Record<string, unknown>) => {
            if (ctx !== undefined) {
                warns.push({ msg, ctx });
            } else {
                warns.push({ msg });
            }
        },
        error: () => undefined,
        fatal: () => undefined,
        child: function () {
            return this;
        },
    };
    return { logger, warns };
}

describe('engine:tick — timer wiring (§4.20)', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:tick');
        if (!d) throw new Error('engine:tick not found');
        return d;
    };

    it('advance is called: a 2-tick timer is decremented to remainingTicks 1', () => {
        const timer = makeTickTimer({ id: 'tmr-1' as TimerId, remainingTicks: 2 });
        const snapshot = makeTimerSnapshot({ ['tmr-1' as TimerId]: timer });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers?.['tmr-1' as TimerId]?.remainingTicks).toBe(1);
    });

    it('advance is called exactly once: all timers in registry are decremented together', () => {
        const timerA = makeTickTimer({ id: 'tmr-a' as TimerId, remainingTicks: 3 });
        const timerB = makeTickTimer({ id: 'tmr-b' as TimerId, remainingTicks: 5 });
        const snapshot = makeTimerSnapshot({
            ['tmr-a' as TimerId]: timerA,
            ['tmr-b' as TimerId]: timerB,
        });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next.timers?.['tmr-a' as TimerId]?.remainingTicks).toBe(2);
        expect(next.timers?.['tmr-b' as TimerId]?.remainingTicks).toBe(4);
    });

    it('fired actions are dispatched via ctx.dispatch in the order returned by advance()', () => {
        const dispatched: string[] = [];
        const dispatchCtx: ReduceContext = {
            ...stubCtx,
            dispatch: (state, action) => {
                dispatched.push(action.type);
                return state;
            },
        };
        const timerA = makeTickTimer({
            id: 'tmr-a' as TimerId,
            remainingTicks: 1,
            actionType: 'game:action_a',
        });
        const timerB = makeTickTimer({
            id: 'tmr-b' as TimerId,
            remainingTicks: 1,
            actionType: 'game:action_b',
        });
        const snapshot = makeTimerSnapshot({
            ['tmr-a' as TimerId]: timerA,
            ['tmr-b' as TimerId]: timerB,
        });
        definition().reduce(snapshot, { seed: 1 }, hostId, dispatchCtx);
        expect(dispatched).toHaveLength(2);
        expect(dispatched).toEqual(['game:action_a', 'game:action_b']);
    });

    it('tick is non-fatal: completes normally when a fired action fails validation', () => {
        const throwingDispatch: ReduceContext = {
            ...stubCtx,
            dispatch: (_state, _action) => {
                throw new ActionUnauthorizedError('game:test_action', 'test_reason');
            },
        };
        const timer = makeTickTimer({ id: 'tmr-1' as TimerId, remainingTicks: 1 });
        const snapshot = makeTimerSnapshot({ ['tmr-1' as TimerId]: timer });
        expect(() =>
            definition().reduce(snapshot, { seed: 1 }, hostId, throwingDispatch),
        ).not.toThrow();
    });

    it('tick logs warn with {timerId, actionType, reason} when fired action fails validation', () => {
        const { logger, warns } = makeCapturingLogger();
        const throwingDispatch: ReduceContext = {
            ...stubCtx,
            logger,
            dispatch: (_state, _action) => {
                throw new ActionUnauthorizedError('game:test_action', 'not_allowed');
            },
        };
        const timer = makeTickTimer({
            id: 'tmr-warn' as TimerId,
            remainingTicks: 1,
            actionType: 'game:test_action',
        });
        const snapshot = makeTimerSnapshot({ ['tmr-warn' as TimerId]: timer });
        definition().reduce(snapshot, { seed: 1 }, hostId, throwingDispatch);
        expect(warns).toHaveLength(1);
        expect(warns[0]?.ctx).toMatchObject({
            timerId: 'tmr-warn',
            actionType: 'game:test_action',
            reason: 'not_allowed',
        });
    });

    it('non-validation errors from ctx.dispatch are re-thrown (outer tick fails)', () => {
        const throwingDispatch: ReduceContext = {
            ...stubCtx,
            dispatch: (_state, _action) => {
                throw new Error('unexpected error');
            },
        };
        const timer = makeTickTimer({ id: 'tmr-1' as TimerId, remainingTicks: 1 });
        const snapshot = makeTimerSnapshot({ ['tmr-1' as TimerId]: timer });
        expect(() => definition().reduce(snapshot, { seed: 1 }, hostId, throwingDispatch)).toThrow(
            'unexpected error',
        );
    });

    it('new timers created inside a fired-action reducer do not fire in the same tick', () => {
        // The fired action's reduce creates a new timer (remainingTicks: 1) in the returned state.
        // That timer should NOT fire in the current tick because advance() was already called.
        let newTimerId: TimerId | undefined;
        const dispatchCtx: ReduceContext = {
            ...stubCtx,
            dispatch: (state, _action) => {
                // Simulate fired action creating a new timer in state
                newTimerId = 'tmr-new' as TimerId;
                return {
                    ...state,
                    timers: {
                        ...state.timers,
                        ['tmr-new' as TimerId]: makeTickTimer({
                            id: 'tmr-new' as TimerId,
                            remainingTicks: 1,
                        }),
                    },
                };
            },
        };
        const timer = makeTickTimer({ id: 'tmr-fire' as TimerId, remainingTicks: 1 });
        const snapshot = makeTimerSnapshot({ ['tmr-fire' as TimerId]: timer });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, dispatchCtx);
        // tmr-new was created by the fired action — it should NOT have fired
        // (advance() was already called before this timer existed in state)
        expect(next.timers?.['tmr-new' as TimerId]?.active).toBe(true);
        expect(next.timers?.['tmr-new' as TimerId]?.remainingTicks).toBe(1);
        expect(newTimerId).toBeDefined();
    });

    it('dispatched envelope carries the outer tick playerId', () => {
        let capturedPlayerId: PlayerId | undefined;
        const dispatchCtx: ReduceContext = {
            ...stubCtx,
            dispatch: (state, action) => {
                capturedPlayerId = action.playerId;
                return state;
            },
        };
        const timer = makeTickTimer({ id: 'tmr-1' as TimerId, remainingTicks: 1 });
        const snapshot = makeTimerSnapshot({ ['tmr-1' as TimerId]: timer });
        definition().reduce(snapshot, { seed: 1 }, hostId, dispatchCtx);
        expect(capturedPlayerId).toBe(hostId);
    });

    it('dispatched envelope carries the tick advanced by the outer engine:tick', () => {
        let capturedTick: number | undefined;
        const dispatchCtx: ReduceContext = {
            ...stubCtx,
            dispatch: (state, action) => {
                capturedTick = action.tick;
                return state;
            },
        };
        const timer = makeTickTimer({ id: 'tmr-1' as TimerId, remainingTicks: 1 });
        const snapshot = { ...makeTimerSnapshot({ ['tmr-1' as TimerId]: timer }), tick: 7 };
        definition().reduce(snapshot, { seed: 1 }, hostId, dispatchCtx);
        expect(capturedTick).toBe(8);
    });

    // ── WARN-1 regression: no spurious timer-registry allocation for inactive timers ──

    it('preserves the timer registry reference when registry has only inactive timers', () => {
        // Inactive timers (e.g. spent one-shots) must not cause a new timer registry
        // to be allocated; engine:tick itself still advances the logical clock.
        const inactiveTimer = makeTickTimer({ id: 'tmr-spent' as TimerId, active: false });
        const snapshot = makeTimerSnapshot({ ['tmr-spent' as TimerId]: inactiveTimer });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers).toBe(snapshot.timers);
    });

    it('preserves the timer registry reference when registry has multiple inactive timers', () => {
        const timerA = makeTickTimer({ id: 'tmr-a' as TimerId, active: false });
        const timerB = makeTickTimer({ id: 'tmr-b' as TimerId, active: false });
        const snapshot = makeTimerSnapshot({
            ['tmr-a' as TimerId]: timerA,
            ['tmr-b' as TimerId]: timerB,
        });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers).toBe(snapshot.timers);
    });

    it('does NOT return same reference when an active timer is decremented (state changed)', () => {
        // Sanity-check: an active timer ticking down must produce a new state object.
        const activeTimer = makeTickTimer({
            id: 'tmr-active' as TimerId,
            remainingTicks: 5,
            active: true,
        });
        const snapshot = makeTimerSnapshot({ ['tmr-active' as TimerId]: activeTimer });
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next).not.toBe(snapshot);
    });

    it('uses O(1) timer-registry fast path when advance() returns next === orig (WARN-1)', () => {
        // Performance guard: when all timers are inactive, TimerManager.advance()
        // returns the same registry reference (next === orig) without allocating.
        // EngineActions must preserve that registry while still advancing tick.
        // This test verifies the fast-path behavior even with a large registry.
        const largeRegistry: TimerRegistry = {};
        for (let i = 0; i < 100; i++) {
            largeRegistry[`tmr-${i}` as unknown as TimerId] = makeTickTimer({
                id: `tmr-${i}` as unknown as TimerId,
                active: false,
            });
        }
        const snapshot = makeTimerSnapshot(largeRegistry);
        const next = definition().reduce(snapshot, { seed: 1 }, hostId, stubCtx);
        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.timers).toBe(snapshot.timers);
    });
});

// ─── engine:end_turn definition ──────────────────────────────────────────────

describe('engine:end_turn definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:end_turn');
        if (!d) throw new Error('engine:end_turn not found');
        return d;
    };

    it('has type string "engine:end_turn"', () => {
        expect(definition().type).toBe('engine:end_turn');
    });

    it('parsePayload accepts an empty payload {}', () => {
        expect(() => definition().parsePayload({})).not.toThrow();
    });

    it('parsePayload returns empty object on valid input', () => {
        const parsed = definition().parsePayload({});
        expect(parsed).toEqual({});
    });

    it('parsePayload accepts an integer deadlineMs override', () => {
        const parsed = definition().parsePayload({ deadlineMs: 45_000 });
        expect(parsed).toEqual({ deadlineMs: 45_000 });
    });

    it('parsePayload rejects a non-integer deadlineMs override', () => {
        expect(() => definition().parsePayload({ deadlineMs: 1.5 })).toThrow(TypeError);
    });

    it('validate returns ok: true for the active player', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const result = definition().validate({}, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    it('validate rejects a non-active dispatcher with reason not_active_player', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const result = definition().validate({}, snapshot, guestId, stubCtx);
        expect(result).toEqual({ ok: false, reason: 'not_active_player' });
    });

    it('validate returns the per-game endTurnGuard rejection when it blocks', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const guardCtx = {
            ...stubCtx,
            endTurnGuard: () => ({ ok: false as const, reason: 'awaiting_commitment' }),
        };
        const result = definition().validate({}, snapshot, hostId, guardCtx);
        expect(result).toEqual({ ok: false, reason: 'awaiting_commitment' });
    });

    it('validate passes when the per-game endTurnGuard allows the end-turn', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const guardCtx = { ...stubCtx, endTurnGuard: () => ({ ok: true as const }) };
        expect(definition().validate({}, snapshot, hostId, guardCtx).ok).toBe(true);
    });

    it('validate enforces the active-player check before consulting the guard', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const guardCtx = { ...stubCtx, endTurnGuard: () => ({ ok: true as const }) };
        // A passing guard must not override the active-player rejection.
        expect(definition().validate({}, snapshot, guestId, guardCtx)).toEqual({
            ok: false,
            reason: 'not_active_player',
        });
    });

    it('endTurnAuthority replaces the active-player check, authorizing a non-active seat', () => {
        // Simultaneous-turn modes let any seat end the turn (e.g. once every seat
        // has committed). The contributed authority owns the decision.
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const authCtx = { ...stubCtx, endTurnAuthority: () => true };
        // guestId is NOT the active player, but the authority allows it.
        expect(definition().validate({}, snapshot, guestId, authCtx).ok).toBe(true);
    });

    it('endTurnAuthority can reject with not_active_player', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const authCtx = { ...stubCtx, endTurnAuthority: () => false };
        // Even the active player is rejected when the authority denies it.
        expect(definition().validate({}, snapshot, hostId, authCtx)).toEqual({
            ok: false,
            reason: 'not_active_player',
        });
    });

    it('endTurnAuthority still defers to the endTurnGuard rejection', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const ctx = {
            ...stubCtx,
            endTurnAuthority: () => true,
            endTurnGuard: () => ({ ok: false as const, reason: 'awaiting_commitment' }),
        };
        expect(definition().validate({}, snapshot, guestId, ctx)).toEqual({
            ok: false,
            reason: 'awaiting_commitment',
        });
    });

    it('reduce advances activePlayerId in round-robin insertion order', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next).not.toBe(snapshot);
        expect(next.turnClock).toEqual({ activePlayerId: guestId, deadlineMs: 30_000 });
    });

    it('reduce wraps activePlayerId back to the first player', () => {
        const thirdPlayerId = toPlayerId('p3');
        const snapshot = makeTurnSnapshot(thirdPlayerId, 30_000);
        const next = definition().reduce(snapshot, {}, thirdPlayerId, stubCtx);
        expect(next.turnClock).toEqual({ activePlayerId: hostId, deadlineMs: 30_000 });
    });

    it('reduce is a no-op when turnClock is absent', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce updates deadlineMs when the payload provides an override', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const next = definition().reduce(snapshot, { deadlineMs: 45_000 }, hostId, stubCtx);
        expect(next.turnClock).toEqual({ activePlayerId: guestId, deadlineMs: 45_000 });
    });

    it('reduce keeps deadlineMs unchanged when the payload omits it', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next.turnClock?.deadlineMs).toBe(30_000);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeTurnSnapshot(hostId, 30_000);
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, {}, hostId, stubCtx)).not.toThrow();
    });

    // WARN-2 (review): turnNumber is the authoritative turn counter on
    // BaseGameSnapshot. The reducer must increment it by 1 whenever the turn
    // actually advances (turnClock present and a next active player exists).
    // Early-return paths (no turnClock, empty players, defensive activePlayer
    // guard) must NOT increment turnNumber because no turn has elapsed.

    it('reduce increments turnNumber by 1 when turnClock advances', () => {
        const snapshot: BaseGameSnapshot = {
            ...makeTurnSnapshot(hostId, 30_000),
            turnNumber: 7,
        };
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next.turnNumber).toBe(8);
    });

    it('reduce increments tick by 1 when turnClock advances', () => {
        const snapshot: BaseGameSnapshot = {
            ...makeTurnSnapshot(hostId, 30_000),
            tick: 7,
        };
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next.tick).toBe(8);
    });

    it('reduce leaves turnNumber unchanged on the no-turnClock early return', () => {
        const snapshot: BaseGameSnapshot = { ...makeSnapshot(), turnNumber: 7 };
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next).toBe(snapshot);
        expect(next.turnNumber).toBe(7);
    });

    it('reduce leaves turnNumber unchanged on the defensive missing-active-player guard', () => {
        const removedId = toPlayerId('p-removed');
        const snapshot: BaseGameSnapshot = {
            ...makeTurnSnapshot(hostId, 30_000),
            turnClock: { activePlayerId: removedId, deadlineMs: 30_000 },
            players: { [hostId]: { id: hostId }, [guestId]: { id: guestId } },
            turnNumber: 7,
        };
        const next = definition().reduce(snapshot, {}, removedId, stubCtx);
        expect(next).toBe(snapshot);
        expect(next.turnNumber).toBe(7);
    });

    // WARN-2 regression: activePlayerId removed from players while turnClock still references it.

    it('validate returns { ok: false, reason: "active_player_not_in_game" } when turnClock.activePlayerId is absent from state.players', () => {
        const removedId = toPlayerId('p-removed');
        // makeTurnSnapshot only adds hostId, guestId, p3 — p-removed is not present.
        const snapshot: BaseGameSnapshot = {
            ...makeTurnSnapshot(removedId, 30_000),
            turnClock: { activePlayerId: removedId, deadlineMs: 30_000 },
            players: {
                [hostId]: { id: hostId },
                [guestId]: { id: guestId },
                // removedId intentionally absent
            },
        };
        const result = definition().validate({}, snapshot, removedId, stubCtx);
        expect(result).toEqual({ ok: false, reason: 'active_player_not_in_game' });
    });

    it('reduce returns state unchanged as defensive guard when activePlayerId is not in state.players', () => {
        const removedId = toPlayerId('p-removed');
        const snapshot: BaseGameSnapshot = {
            ...makeTurnSnapshot(hostId, 30_000),
            turnClock: { activePlayerId: removedId, deadlineMs: 30_000 },
            players: {
                [hostId]: { id: hostId },
                [guestId]: { id: guestId },
                // removedId intentionally absent
            },
        };
        // validate() would reject this envelope; test the defensive reduce path directly.
        const next = definition().reduce(snapshot, {}, removedId, stubCtx);
        expect(next).toBe(snapshot);
    });
});

// ─── engine:start_game definition ───────────────────────────────────────────

describe('engine:start_game definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:start_game');
        if (!d) throw new Error('engine:start_game not found');
        return d;
    };

    it('has type string "engine:start_game"', () => {
        expect(definition().type).toBe('engine:start_game');
    });

    it('parsePayload accepts a non-empty playerIds array', () => {
        expect(definition().parsePayload({ playerIds: ['p1', 'p2'] })).toEqual({
            playerIds: ['p1', 'p2'],
        });
    });

    it('parsePayload accepts firstPlayerId and initialEntities for match initialization', () => {
        const unit = entityId('unit-start-game');

        expect(
            definition().parsePayload({
                playerIds: ['p1', 'p2'],
                firstPlayerId: 'p2',
                initialEntities: {
                    [unit]: { id: unit, kind: 'unit', ownerId: 'p2', x: 0, y: 0 },
                },
            }),
        ).toEqual({
            playerIds: ['p1', 'p2'],
            firstPlayerId: 'p2',
            initialEntities: {
                [unit]: { id: unit, kind: 'unit', ownerId: 'p2', x: 0, y: 0 },
            },
        });
    });

    it('parsePayload rejects an empty playerIds array', () => {
        expect(() => definition().parsePayload({ playerIds: [] })).toThrow(TypeError);
    });

    it('validate accepts the host player', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate({ playerIds: [hostId] }, snapshot, hostId, stubCtx);
        expect(result).toEqual({ ok: true });
    });

    it('validate rejects a non-host player', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate({ playerIds: [hostId] }, snapshot, guestId, stubCtx);
        expect(result).toEqual({ ok: false, reason: 'host_only' });
    });

    it('validate rejects an explicit first player outside the match roster', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { playerIds: [hostId], firstPlayerId: guestId },
            snapshot,
            hostId,
            stubCtx,
        );

        expect(result).toEqual({ ok: false, reason: 'first_player_not_in_game' });
    });

    it('reduce adds every started player, marks the phase playing, and advances tick exactly once', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.phase).toBe('playing');
        expect(Object.keys(next.players).sort()).toEqual([guestId, hostId].sort());
    });

    it('reduce enters the engine game scene and clears any pending scene transition', () => {
        const snapshot = {
            ...makeSnapshot(hostId),
            sceneId: sceneId('engine:lobby'),
            sceneTransition: {
                toSceneId: sceneId('engine:game'),
                phase: 'preparing' as const,
                startedAtTick: 0,
                params: {},
                playersReady: [],
            },
        } satisfies BaseGameSnapshot;

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next.sceneId).toBe(sceneId('engine:game'));
        expect(next.sceneTransition).toBeNull();
    });

    it('reduce resets the scene asset declaration with the scene it enters', () => {
        // `sceneRequiredAssets` rides forward on the engine-owned base, so
        // without an explicit write the lobby snapshot would name
        // `engine:game` while still advertising the refs of whatever scene the
        // previous match ended in.
        const snapshot = {
            ...makeSnapshot(hostId),
            sceneId: sceneId('tactics:arena'),
            sceneRequiredAssets: ['gltf-model/tactics/models/arena.glb' as AssetRef],
        } satisfies BaseGameSnapshot;

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next.sceneId).toBe(sceneId('engine:game'));
        expect(next.sceneRequiredAssets).toEqual([]);
    });

    it('reduce resets the scene default screen with the scene it enters', () => {
        // The sibling of the reset above, and it fails the same way:
        // `sceneDefaultScreen` rides forward on the engine-owned base, so
        // without an explicit write the snapshot names `engine:game` while still
        // carrying the screen key of whatever scene the previous match ended in.
        // `SceneRouter` prefers the snapshot value over the registry, so that
        // stale key is what the player would see.
        const snapshot = {
            ...makeSnapshot(hostId),
            sceneId: sceneId('tactics:arena'),
            sceneDefaultScreen: 'arena-hud',
        } satisfies BaseGameSnapshot;

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next.sceneId).toBe(sceneId('engine:game'));
        expect(next.sceneDefaultScreen).toBe('playfield');
    });

    it('reduce writes the screen key the engine:game descriptor actually declares', () => {
        // The literal assertion above is what kills the dropped write; this is
        // what couples that literal to the registry. Without it the two sides
        // are only ever compared to the same string in two files, so renaming
        // the descriptor and updating the newly-failing assertion in
        // `DefaultScenes.test.ts` would leave this reducer writing the old key
        // with nothing red.
        const registry = new SceneRegistry<BaseGameSnapshot>();
        registerDefaultScenes(registry);

        const next = definition().reduce(
            makeSnapshot(hostId),
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next.sceneDefaultScreen).toBe(
            registry.resolve(sceneId('engine:game')).defaultScreen,
        );
    });

    it('reduce applies initial entities and explicit first player through the game-start action', () => {
        const snapshot = makeSnapshot(hostId);
        const unit = entityId('unit-start-game-reduce');
        const initialEntities: BaseGameSnapshot['entities'] = {
            [unit]: { id: unit },
        };

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId], firstPlayerId: guestId, initialEntities },
            hostId,
            stubCtx,
        );

        expect(next.entities).toBe(initialEntities);
        expect(next.turnClock).toEqual({ activePlayerId: guestId, deadlineMs: 30_000 });
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot(hostId);
        definition().reduce(snapshot, { playerIds: [hostId, guestId] }, hostId, stubCtx);

        expect(snapshot.tick).toBe(0);
        expect(snapshot.phase).toBe('waiting');
        expect(snapshot.players).toEqual({});
    });

    // ─── host-authored lobby setup passthrough ───────────────────────────────

    it('parsePayload parses a well-formed host-authored setup', () => {
        expect(
            definition().parsePayload({
                playerIds: ['p1', 'p2'],
                setup: {
                    gameParams: { boardColor: 'blue' },
                    playerAttributes: { p1: { color: 'red' }, p2: { color: 'black' } },
                },
            }),
        ).toEqual({
            playerIds: ['p1', 'p2'],
            setup: {
                gameParams: { boardColor: 'blue' },
                playerAttributes: { p1: { color: 'red' }, p2: { color: 'black' } },
            },
        });
    });

    it('parsePayload omits setup when the payload has none', () => {
        expect(definition().parsePayload({ playerIds: ['p1'] })).not.toHaveProperty('setup');
    });

    it('parsePayload rejects a setup whose gameParams is not a string map', () => {
        expect(() =>
            definition().parsePayload({
                playerIds: ['p1'],
                setup: { gameParams: { boardColor: 7 }, playerAttributes: {} },
            }),
        ).toThrow(TypeError);
    });

    it('parsePayload rejects a setup with a prototype-pollution key', () => {
        // Built via JSON.parse so `__proto__` is a real own enumerable key, as it
        // would be on wire-delivered input (a source literal would instead set the
        // prototype and create no own key).
        const setup = JSON.parse('{"gameParams":{"__proto__":"x"},"playerAttributes":{}}');
        expect(() => definition().parsePayload({ playerIds: ['p1'], setup })).toThrow(TypeError);
    });

    it('reduce writes snapshot.setup from the payload', () => {
        const snapshot = makeSnapshot(hostId);
        const setup = {
            gameParams: { boardColor: 'blue' },
            playerAttributes: { [hostId]: { color: 'red' } },
        };

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId], setup },
            hostId,
            stubCtx,
        );

        expect(next.setup).toEqual(setup);
    });

    it('reduce leaves setup absent when the payload omits it', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(snapshot, { playerIds: [hostId] }, hostId, stubCtx);

        expect(next).not.toHaveProperty('setup');
    });

    it('reduce does not mutate the input snapshot when setup is present', () => {
        const snapshot = makeSnapshot(hostId);
        const frozen = Object.freeze({ ...snapshot });

        expect(() =>
            definition().reduce(
                frozen,
                {
                    playerIds: [hostId],
                    setup: { gameParams: { boardColor: 'blue' }, playerAttributes: {} },
                },
                hostId,
                stubCtx,
            ),
        ).not.toThrow();
        expect(frozen).not.toHaveProperty('setup');
    });

    // ─── host-minted match identity passthrough ──────────────────────────────

    it('parsePayload parses a well-formed matchId', () => {
        expect(
            definition().parsePayload({
                playerIds: ['p1', 'p2'],
                matchId: 'match-uuid-1',
            }),
        ).toEqual({ playerIds: ['p1', 'p2'], matchId: 'match-uuid-1' });
    });

    it('parsePayload omits matchId when the payload has none', () => {
        expect(definition().parsePayload({ playerIds: ['p1'] })).not.toHaveProperty('matchId');
    });

    it('parsePayload rejects a non-string matchId', () => {
        expect(() => definition().parsePayload({ playerIds: ['p1'], matchId: 7 })).toThrow(
            TypeError,
        );
    });

    it('parsePayload rejects an empty-string matchId', () => {
        expect(() => definition().parsePayload({ playerIds: ['p1'], matchId: '' })).toThrow(
            TypeError,
        );
    });

    it('reduce writes snapshot.matchId from the payload', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId], matchId: 'match-uuid-1' },
            hostId,
            stubCtx,
        );

        expect(next.matchId).toBe('match-uuid-1');
    });

    it('reduce preserves the prior matchId when the payload omits one', () => {
        const snapshot = { ...makeSnapshot(hostId), matchId: 'match-uuid-prior' };
        const next = definition().reduce(snapshot, { playerIds: [hostId] }, hostId, stubCtx);

        expect(next.matchId).toBe('match-uuid-prior');
    });

    it('reduce leaves matchId absent when neither payload nor state has one', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(snapshot, { playerIds: [hostId] }, hostId, stubCtx);

        expect(next).not.toHaveProperty('matchId');
    });

    it('reduce does not mutate the input snapshot when matchId is present', () => {
        const snapshot = makeSnapshot(hostId);
        const frozen = Object.freeze({ ...snapshot });

        expect(() =>
            definition().reduce(
                frozen,
                { playerIds: [hostId], matchId: 'match-uuid-1' },
                hostId,
                stubCtx,
            ),
        ).not.toThrow();
        expect(frozen).not.toHaveProperty('matchId');
    });

    // ─── game-extension match state must not survive a match boundary ────────
    //
    // A game (e.g. tactics' `playerStamina`) bolts non-`BaseGameSnapshot` fields
    // onto the snapshot at runtime. They are match-scoped by contract: a new match
    // must start from a clean engine-owned base and never inherit the prior
    // match's values (the "ending a game shall not preserve game-state values"
    // rule). The engine drops them without naming any game.

    it('reduce drops game-specific extension fields carried from a prior match', () => {
        const snapshot = {
            ...makeSnapshot(hostId),
            playerStamina: { [hostId]: { current: 0, max: 3, refreshedTurn: 5 } },
            someOtherGameField: 'stale',
        } as BaseGameSnapshot;

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next).not.toHaveProperty('playerStamina');
        expect(next).not.toHaveProperty('someOtherGameField');
    });

    it('reduce drops the match-scoped dilation and animation-window state', () => {
        const snapshot = {
            ...makeSnapshot(hostId),
            ...makeDilatedMatchState(),
        };

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next).not.toHaveProperty('timeScalePermille');
        expect(next).not.toHaveProperty('timeScaleRestoreBeats');
        expect(next).not.toHaveProperty('animationWindows');
        // Opposite polarity, same reduce: an engine-owned field that IS carried
        // forward still is, so the three assertions above are about the
        // match-scoped list and not about the base spread having stopped working.
        expect(next.hostPlayerId).toBe(hostId);
    });

    it('reduce preserves the engine-owned BaseGameSnapshot fields it does not reset', () => {
        const snapshot = {
            ...makeSnapshot(hostId),
            seed: 777,
            turnNumber: 4,
        } as BaseGameSnapshot;

        const next = definition().reduce(
            snapshot,
            { playerIds: [hostId, guestId] },
            hostId,
            stubCtx,
        );

        expect(next.seed).toBe(777);
        expect(next.turnNumber).toBe(4);
        expect(next.hostPlayerId).toBe(hostId);
    });
});

// ─── engine:return_to_lobby definition ──────────────────────────────────────

describe('engine:return_to_lobby definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:return_to_lobby');
        if (!d) throw new Error('engine:return_to_lobby not found');
        return d;
    };

    const unit = entityId('unit-return-lobby');
    const setup = {
        gameParams: { boardColor: 'blue' },
        playerAttributes: { [hostId]: { color: 'red' } },
    };

    // An in-progress match snapshot: host set, populated entities/turnClock, and a
    // (deliberately non-null) gameResult so the "clears" assertions are meaningful.
    const makePlayingSnapshot = (): BaseGameSnapshot =>
        ({
            ...makeSnapshot(hostId),
            seed: 123,
            phase: 'playing' as BaseGameSnapshot['phase'],
            sceneId: sceneId('engine:game'),
            sceneTransition: null,
            players: { [hostId]: { id: hostId }, [guestId]: { id: guestId } },
            entities: { [unit]: { id: unit } },
            turnClock: { activePlayerId: hostId, deadlineMs: 30_000 },
            gameResult: { winnerIds: [hostId] },
            setup,
            matchId: 'match-uuid-return',
        }) satisfies BaseGameSnapshot;

    it('has type string "engine:return_to_lobby"', () => {
        expect(definition().type).toBe('engine:return_to_lobby');
    });

    it('parsePayload returns an empty payload', () => {
        expect(definition().parsePayload({})).toEqual({});
    });

    it('validate accepts the host player', () => {
        const result = definition().validate({}, makePlayingSnapshot(), hostId, stubCtx);
        expect(result).toEqual({ ok: true });
    });

    it('validate rejects a non-host player with host_only', () => {
        const result = definition().validate({}, makePlayingSnapshot(), guestId, stubCtx);
        expect(result).toEqual({ ok: false, reason: 'host_only' });
    });

    it('validate rejects when no host is set', () => {
        const result = definition().validate({}, makeSnapshot(), hostId, stubCtx);
        expect(result).toEqual({ ok: false, reason: 'host_only' });
    });

    it('reduce flips the phase to lobby, enters the lobby scene, and advances tick exactly once', () => {
        const snapshot = makePlayingSnapshot();
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next).not.toBe(snapshot);
        expect(next.tick).toBe(snapshot.tick + 1);
        expect(next.phase).toBe('lobby');
        expect(next.sceneId).toBe(sceneId('engine:lobby'));
        expect(next.sceneTransition).toBeNull();
    });

    it('reduce resets the scene asset declaration with the scene it enters', () => {
        const snapshot = {
            ...makePlayingSnapshot(),
            sceneRequiredAssets: ['gltf-model/tactics/models/arena.glb' as AssetRef],
        } satisfies BaseGameSnapshot;

        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next.sceneId).toBe(sceneId('engine:lobby'));
        expect(next.sceneRequiredAssets).toEqual([]);
    });

    it('reduce resets the scene default screen with the scene it enters', () => {
        // Its own case rather than an extra assertion on the sibling above: the
        // two reducers write two different literals, so one killer per write is
        // what makes dropping either one red.
        const snapshot = {
            ...makePlayingSnapshot(),
            sceneId: sceneId('tactics:arena'),
            sceneDefaultScreen: 'arena-hud',
        } satisfies BaseGameSnapshot;

        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next.sceneId).toBe(sceneId('engine:lobby'));
        expect(next.sceneDefaultScreen).toBe('lobby');
    });

    it('reduce writes the screen key the engine:lobby descriptor actually declares', () => {
        // The coupling half, as above: this is what a descriptor rename reds
        // whatever the author does to the registry's own test.
        const registry = new SceneRegistry<BaseGameSnapshot>();
        registerDefaultScenes(registry);

        const next = definition().reduce(makePlayingSnapshot(), {}, hostId, stubCtx);

        expect(next.sceneDefaultScreen).toBe(
            registry.resolve(sceneId('engine:lobby')).defaultScreen,
        );
    });

    it('reduce clears entities, turnClock, and gameResult (abandon, not a finished match)', () => {
        const next = definition().reduce(makePlayingSnapshot(), {}, hostId, stubCtx);

        expect(next.entities).toEqual({});
        expect(next.turnClock).toBeUndefined();
        expect(next.gameResult).toBeNull();
    });

    it('reduce preserves the lobby roster, seed, host, and setup', () => {
        const snapshot = makePlayingSnapshot();
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next.players).toEqual(snapshot.players);
        expect(next.seed).toBe(snapshot.seed);
        expect(next.hostPlayerId).toBe(hostId);
        expect(next.setup).toEqual(setup);
    });

    it('reduce preserves the matchId so post-abandon saves still correlate to the match', () => {
        const snapshot = makePlayingSnapshot();
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next.matchId).toBe('match-uuid-return');
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makePlayingSnapshot();
        const frozen = Object.freeze(snapshot);

        expect(() => definition().reduce(frozen, {}, hostId, stubCtx)).not.toThrow();
        expect(snapshot.phase).toBe('playing');
        expect(snapshot.entities).toEqual({ [unit]: { id: unit } });
        expect(snapshot.turnClock).toEqual({ activePlayerId: hostId, deadlineMs: 30_000 });
        expect(snapshot.gameResult).toEqual({ winnerIds: [hostId] });
    });

    it('reduce drops game-specific extension fields so the lobby snapshot is clean', () => {
        // Abandoning/finishing a match must not leave a game's match-scoped
        // extension state (e.g. tactics' `playerStamina`) lingering on the lobby
        // snapshot, where it would otherwise ride into the next match.
        const snapshot = {
            ...makePlayingSnapshot(),
            playerStamina: { [hostId]: { current: 0, max: 3, refreshedTurn: 5 } },
        } as BaseGameSnapshot;

        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next).not.toHaveProperty('playerStamina');
    });

    it('reduce drops the match-scoped dilation and animation-window state', () => {
        // A match abandoned mid-dilation must not leave the LOBBY running at
        // quarter speed, nor leave a window open whose owning entity the same
        // reduce is about to wipe.
        const snapshot = {
            ...makePlayingSnapshot(),
            ...makeDilatedMatchState(),
        };

        const next = definition().reduce(snapshot, {}, hostId, stubCtx);

        expect(next).not.toHaveProperty('timeScalePermille');
        expect(next).not.toHaveProperty('timeScaleRestoreBeats');
        expect(next).not.toHaveProperty('animationWindows');
        // Opposite polarity, same reduce: the lobby roster still survives.
        expect(next.hostPlayerId).toBe(hostId);
    });
});

// ─── registerEngineActions ────────────────────────────────────────────────────

describe('registerEngineActions', () => {
    let registry: ActionRegistry;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('registers engine:tick without throwing NamespaceCollisionError', () => {
        expect(() => registerEngineActions(registry)).not.toThrow();
        expect(registry.has('engine:tick')).toBe(true);
    });

    it('registers engine:end_turn without throwing NamespaceCollisionError', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:end_turn')).toBe(true);
    });

    it('registry.has("engine:tick") returns true after registration', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:tick')).toBe(true);
    });

    it('registry.has("engine:end_turn") returns true after registration', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:end_turn')).toBe(true);
    });

    it('registry.has("engine:start_game") returns true after registration', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:start_game')).toBe(true);
    });

    it('both engine: types appear in registeredTypes()', () => {
        registerEngineActions(registry);
        const types = registry.registeredTypes();
        expect(types).toContain('engine:tick');
        expect(types).toContain('engine:end_turn');
    });

    it('registry can still resolve engine:tick definition after registration', () => {
        registerEngineActions(registry);
        const def = registry.resolve('engine:tick');
        expect(def.type).toBe('engine:tick');
    });

    it('registry can still resolve engine:end_turn definition after registration', () => {
        registerEngineActions(registry);
        const def = registry.resolve('engine:end_turn');
        expect(def.type).toBe('engine:end_turn');
    });

    it('does not expose engine:tick via game-level register()', () => {
        // Game code cannot re-register engine: actions via the public path
        expect(() =>
            registry.register({
                type: 'engine:tick',
                parsePayload: (r) => r,
                validate: () => ({ ok: true }),
                reduce: (s) => s,
            }),
        ).toThrow('NamespaceCollisionError');
    });

    it('registers engine:save without throwing', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:save')).toBe(true);
    });

    it('registers engine:load without throwing', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:load')).toBe(true);
    });

    it('registers engine:return_to_lobby without throwing', () => {
        registerEngineActions(registry);
        expect(registry.has('engine:return_to_lobby')).toBe(true);
    });

    it('registry can resolve engine:return_to_lobby definition after registration', () => {
        registerEngineActions(registry);
        const def = registry.resolve('engine:return_to_lobby');
        expect(def.type).toBe('engine:return_to_lobby');
    });

    it('all nine engine: types appear in registeredTypes()', () => {
        registerEngineActions(registry);
        const types = registry.registeredTypes();
        expect(types).toContain('engine:save');
        expect(types).toContain('engine:load');
        expect(types).toContain('engine:undo');
        expect(types).toContain('engine:redo');
        expect(types).toContain('engine:sync_request');
        expect(types).toContain('engine:start_game');
        expect(types).toContain('engine:return_to_lobby');
    });
});

// ─── engine:save definition ───────────────────────────────────────────────────

describe('engine:save definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:save');
        if (!d) throw new Error('engine:save not found');
        return d;
    };

    it('has type string "engine:save"', () => {
        expect(definition().type).toBe('engine:save');
    });

    it('parsePayload accepts a valid { slotId: string } payload', () => {
        expect(() => definition().parsePayload({ slotId: 'tactics/autosave' })).not.toThrow();
    });

    it('parsePayload returns the slotId unchanged', () => {
        const parsed = definition().parsePayload({ slotId: 'tactics/slot-1' });
        expect(parsed).toEqual({ slotId: 'tactics/slot-1' });
    });

    it('parsePayload throws when slotId is missing', () => {
        expect(() => definition().parsePayload({})).toThrow(TypeError);
    });

    it('parsePayload throws when slotId is not a string', () => {
        expect(() => definition().parsePayload({ slotId: 42 })).toThrow(TypeError);
    });

    it('validate returns ok: true when playerId === hostPlayerId', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/autosave' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(true);
    });

    it('validate returns ok: false when playerId !== hostPlayerId (invariant #25)', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/autosave' },
            snapshot,
            guestId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('validate returns ok: false when hostPlayerId is undefined (invariant #25 — guard must not be vacuous)', () => {
        const snapshot = makeSnapshot(); // no hostPlayerId → session not yet stamped
        const result = definition().validate(
            { slotId: 'tactics/autosave' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('validate returns ok: false when hostPlayerId is set and dispatching player is not the host', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/autosave' },
            snapshot,
            guestId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('reduce returns snapshot unchanged (stub — save logic is in SaveManager)', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(snapshot, { slotId: 'tactics/autosave' }, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot(hostId);
        const frozen = Object.freeze({ ...snapshot });
        expect(() =>
            definition().reduce(frozen, { slotId: 'tactics/autosave' }, hostId, stubCtx),
        ).not.toThrow();
    });
    it.todo(
        'dispatching engine:save should result in a file being written to the repository (post-pipeline wiring)',
    );
});

// ─── engine:load definition ───────────────────────────────────────────────────

describe('engine:load definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:load');
        if (!d) throw new Error('engine:load not found');
        return d;
    };

    it('has type string "engine:load"', () => {
        expect(definition().type).toBe('engine:load');
    });

    it('parsePayload accepts a valid { slotId: string } payload', () => {
        expect(() => definition().parsePayload({ slotId: 'tactics/slot-1' })).not.toThrow();
    });

    it('parsePayload returns the slotId unchanged', () => {
        const parsed = definition().parsePayload({ slotId: 'tactics/slot-1' });
        expect(parsed).toEqual({ slotId: 'tactics/slot-1' });
    });

    it('parsePayload throws when slotId is missing', () => {
        expect(() => definition().parsePayload({})).toThrow(TypeError);
    });

    it('parsePayload throws when slotId is not a string', () => {
        expect(() => definition().parsePayload({ slotId: false })).toThrow(TypeError);
    });

    it('validate returns ok: true when playerId === hostPlayerId', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/slot-1' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(true);
    });

    it('validate returns ok: false when playerId !== hostPlayerId (invariant #25)', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/slot-1' },
            snapshot,
            guestId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('validate returns ok: false when hostPlayerId is undefined (invariant #25 — guard must not be vacuous)', () => {
        const snapshot = makeSnapshot(); // no hostPlayerId → session not yet stamped
        const result = definition().validate(
            { slotId: 'tactics/slot-1' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('validate returns ok: false when hostPlayerId is set and dispatching player is not the host', () => {
        const snapshot = makeSnapshot(hostId);
        const result = definition().validate(
            { slotId: 'tactics/slot-1' },
            snapshot,
            guestId,
            stubCtx,
        );
        expect(result.ok).toBe(false);
    });

    it('reduce returns snapshot unchanged (stub — load logic is in SaveManager)', () => {
        const snapshot = makeSnapshot(hostId);
        const next = definition().reduce(snapshot, { slotId: 'tactics/slot-1' }, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot(hostId);
        const frozen = Object.freeze({ ...snapshot });
        expect(() =>
            definition().reduce(frozen, { slotId: 'tactics/slot-1' }, hostId, stubCtx),
        ).not.toThrow();
    });

    it.todo(
        'dispatching engine:load should result in the simulation state being replaced (post-pipeline wiring)',
    );
});

// ─── engine:undo definition ───────────────────────────────────────────────────

describe('engine:undo definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:undo');
        if (!d) throw new Error('engine:undo not found');
        return d;
    };

    it('has type string "engine:undo"', () => {
        expect(definition().type).toBe('engine:undo');
    });

    it('parsePayload accepts an empty payload and defaults steps to 1', () => {
        const parsed = definition().parsePayload({});
        expect(parsed).toEqual({ steps: 1 });
    });

    it('parsePayload accepts { steps: 3 } and returns it unchanged', () => {
        const parsed = definition().parsePayload({ steps: 3 });
        expect(parsed).toEqual({ steps: 3 });
    });

    it('parsePayload accepts { steps: 1 } (minimum valid positive integer)', () => {
        expect(() => definition().parsePayload({ steps: 1 })).not.toThrow();
    });

    it('parsePayload throws TypeError when steps is 0 (not positive)', () => {
        expect(() => definition().parsePayload({ steps: 0 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is negative', () => {
        expect(() => definition().parsePayload({ steps: -1 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is a non-integer float', () => {
        expect(() => definition().parsePayload({ steps: 1.5 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is not a number', () => {
        expect(() => definition().parsePayload({ steps: 'bad' })).toThrow(TypeError);
    });

    it('validate returns ok: true (placeholder)', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({ steps: 1 }, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    // Stage 3 of `ActionPipeline` owns undo authorisation via `UndoManager`.
    // The definition's `validate` is reached only when no `undoManager` is
    // wired (early bring-up); it must therefore be a permissive no-op so the
    // policy lives in exactly one place.

    it('validate returns ok: true even when undoManager.canUndo would return false (Stage 3 owns the decision)', () => {
        const snapshot = makeSnapshot();
        const ctx: ReduceContext = {
            rng: makeStubRng(0.5),
            dispatchDepth: 0,
            undoManager: {
                canUndo: (_pid: PlayerId) => false,
                canRedo: (_pid: PlayerId) => true,
            },
        };
        const result = definition().validate({ steps: 1 }, snapshot, hostId, ctx);
        expect(result.ok).toBe(true);
    });

    it('validate returns ok: true when undoManager is absent (stub path — F16)', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({ steps: 1 }, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    it('reduce returns snapshot unchanged (stub)', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, { steps: 1 }, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot();
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, { steps: 1 }, hostId, stubCtx)).not.toThrow();
    });
});

// ─── engine:redo definition ───────────────────────────────────────────────────

describe('engine:redo definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:redo');
        if (!d) throw new Error('engine:redo not found');
        return d;
    };

    it('has type string "engine:redo"', () => {
        expect(definition().type).toBe('engine:redo');
    });

    it('parsePayload accepts an empty payload and defaults steps to 1', () => {
        const parsed = definition().parsePayload({});
        expect(parsed).toEqual({ steps: 1 });
    });

    it('parsePayload accepts { steps: 5 } and returns it unchanged', () => {
        const parsed = definition().parsePayload({ steps: 5 });
        expect(parsed).toEqual({ steps: 5 });
    });

    it('parsePayload accepts { steps: 1 } (minimum valid positive integer)', () => {
        expect(() => definition().parsePayload({ steps: 1 })).not.toThrow();
    });

    it('parsePayload throws TypeError when steps is 0 (not positive)', () => {
        expect(() => definition().parsePayload({ steps: 0 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is negative', () => {
        expect(() => definition().parsePayload({ steps: -2 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is a non-integer float', () => {
        expect(() => definition().parsePayload({ steps: 2.5 })).toThrow(TypeError);
    });

    it('parsePayload throws TypeError when steps is not a number', () => {
        expect(() => definition().parsePayload({ steps: true })).toThrow(TypeError);
    });

    it('validate returns ok: true (placeholder)', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({ steps: 1 }, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    // Stage 3 of `ActionPipeline` owns redo authorisation via `UndoManager`.
    // The definition's `validate` is reached only when no `undoManager` is
    // wired (early bring-up); it must therefore be a permissive no-op so the
    // policy lives in exactly one place.

    it('validate returns ok: true even when undoManager.canRedo would return false (Stage 3 owns the decision)', () => {
        const snapshot = makeSnapshot();
        const ctx: ReduceContext = {
            rng: makeStubRng(0.5),
            dispatchDepth: 0,
            undoManager: {
                canUndo: (_pid: PlayerId) => true,
                canRedo: (_pid: PlayerId) => false,
            },
        };
        const result = definition().validate({ steps: 1 }, snapshot, hostId, ctx);
        expect(result.ok).toBe(true);
    });

    it('validate returns ok: true when undoManager is absent (stub path — F16)', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({ steps: 1 }, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    it('reduce returns snapshot unchanged (stub)', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, { steps: 1 }, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot();
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, { steps: 1 }, hostId, stubCtx)).not.toThrow();
    });
});

// ─── engine:sync_request definition ──────────────────────────────────────────

describe('engine:sync_request definition', () => {
    const definition = () => {
        const d = EngineActions.find((d) => d.type === 'engine:sync_request');
        if (!d) throw new Error('engine:sync_request not found');
        return d;
    };

    it('has type string "engine:sync_request"', () => {
        expect(definition().type).toBe('engine:sync_request');
    });

    it('parsePayload accepts an empty payload {}', () => {
        expect(() => definition().parsePayload({})).not.toThrow();
    });

    it('parsePayload returns empty object', () => {
        const parsed = definition().parsePayload({});
        expect(parsed).toEqual({});
    });

    it('validate returns ok: true (placeholder)', () => {
        const snapshot = makeSnapshot();
        const result = definition().validate({}, snapshot, hostId, stubCtx);
        expect(result.ok).toBe(true);
    });

    it('reduce returns snapshot unchanged (stub)', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, {}, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot();
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, {}, hostId, stubCtx)).not.toThrow();
    });
});

// ─── Individual named exports (Improvement 4) ────────────────────────────────

describe('individual engine action definition named exports', () => {
    it('engineTickDefinition is a named export with type engine:tick', () => {
        expect(engineTickDefinition.type).toBe('engine:tick');
    });

    it('engineEndTurnDefinition is a named export with type engine:end_turn', () => {
        expect(engineEndTurnDefinition.type).toBe('engine:end_turn');
    });

    it('engineSaveDefinition is a named export with type engine:save', () => {
        expect(engineSaveDefinition.type).toBe('engine:save');
    });

    it('engineLoadDefinition is a named export with type engine:load', () => {
        expect(engineLoadDefinition.type).toBe('engine:load');
    });

    it('engineUndoDefinition is a named export with type engine:undo', () => {
        expect(engineUndoDefinition.type).toBe('engine:undo');
    });

    it('engineRedoDefinition is a named export with type engine:redo', () => {
        expect(engineRedoDefinition.type).toBe('engine:redo');
    });

    it('engineSyncRequestDefinition is a named export with type engine:sync_request', () => {
        expect(engineSyncRequestDefinition.type).toBe('engine:sync_request');
    });

    it('engineStartGameDefinition is a named export with type engine:start_game', () => {
        expect(engineStartGameDefinition.type).toBe('engine:start_game');
    });

    it('engineReturnToLobbyDefinition is a named export with type engine:return_to_lobby', () => {
        expect(engineReturnToLobbyDefinition.type).toBe('engine:return_to_lobby');
    });

    it('all individually exported definitions are in the EngineActions array', () => {
        const individualDefs = [
            engineTickDefinition,
            engineEndTurnDefinition,
            engineSaveDefinition,
            engineLoadDefinition,
            engineUndoDefinition,
            engineRedoDefinition,
            engineSyncRequestDefinition,
            engineStartGameDefinition,
            engineReturnToLobbyDefinition,
        ];
        for (const def of individualDefs) {
            expect(EngineActions.some((d) => d === def)).toBe(true);
        }
    });
});

// ─── registerEngineActions — generic TState constraint ───────────────────────

/**
 * Concrete snapshot subtype used only in the type-level test below.
 * Represents what any game-specific snapshot (e.g. TacticsSnapshot) would look like.
 */
interface ConcreteSnapshot extends BaseGameSnapshot {
    readonly extra: number;
}

describe('registerEngineActions — generic TState constraint', () => {
    it('accepts an ActionRegistry<ConcreteSnapshot> without a cast (compile-time)', () => {
        // This is a compile-time assertion: if the function signature is not generic,
        // TypeScript would fail to compile this call.
        // After the fix (generic signature), this must compile with zero cast.
        const concreteRegistry = new ActionRegistry<ConcreteSnapshot>();
        registerEngineActions(concreteRegistry);
        expect(concreteRegistry.has('engine:tick')).toBe(true);
        expect(concreteRegistry.has('engine:end_turn')).toBe(true);
    });

    it('the first parameter type of registerEngineActions is ActionRegistry<TState> for any TState', () => {
        // expectTypeOf confirms the inferred overload accepts a concrete subtype registry.
        type ConcreteRegistry = ActionRegistry<ConcreteSnapshot>;
        expectTypeOf(registerEngineActions<ConcreteSnapshot>)
            .parameter(0)
            .toEqualTypeOf<ConcreteRegistry>();
    });

    it('all seven engine actions are registered into a concrete-subtype registry', () => {
        const concreteRegistry = new ActionRegistry<ConcreteSnapshot>();
        registerEngineActions(concreteRegistry);
        const types = concreteRegistry.registeredTypes();
        expect(types).toContain('engine:tick');
        expect(types).toContain('engine:end_turn');
        expect(types).toContain('engine:save');
        expect(types).toContain('engine:load');
        expect(types).toContain('engine:undo');
        expect(types).toContain('engine:redo');
        expect(types).toContain('engine:sync_request');
    });
});

// ─── engine:tick — the per-beat pass (F82) ────────────────────────────────────

/**
 * The beat pass composes the window ledger and the time-scale verbs into the
 * one `engine:tick` reduce and hands the result to the game's `onBeat`.
 *
 * Properties pinned: `onBeat` runs exactly once per outer tick, after the fired
 * child dispatches and after the window sweep; it sees that sweep's closures,
 * and receives a context with no engine-internal field on it. The pass adds no
 * `ctx.dispatch` call of its own.
 *
 * The order of `advanceTimeScale` and the sweep relative to EACH OTHER is not
 * pinned here: the two write disjoint fields (`timeScale*` and
 * `animationWindows`), and swapping them was measured to change no assertion
 * in this file.
 */
describe('engine:tick — the per-beat pass (F82)', () => {
    const OWNER = entityId('unit-1');
    const WINDOW = 'sword-hit#1' as AnimationWindowId;

    const makeBeatSnapshot = (overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot => ({
        ...makeSnapshot(),
        players: { [hostId]: { id: hostId } },
        entities: { [OWNER]: { id: OWNER } },
        ...overrides,
    });

    const openWindow = (remainingBeats: number): AnimationWindowRegistry => ({
        [WINDOW]: { id: WINDOW, ownerId: OWNER, remainingBeats, payload: { damage: 12 } },
    });

    /** A context shaped like the pipeline's: every engine-internal field present. */
    const makeEngineCtx = (overrides: Partial<ReduceContext> = {}): ReduceContext => ({
        ...stubCtx,
        dispatch: (state) => state,
        ...overrides,
    });

    // ── The hook's calling contract ───────────────────────────────────────────

    it('invokes ctx.beatReducer exactly once per outer tick', () => {
        let calls = 0;
        const ctx = makeEngineCtx({
            beatReducer: (state) => {
                calls += 1;
                return state;
            },
        });

        engineTickDefinition.reduce(makeBeatSnapshot(), { seed: 1 }, hostId, ctx);

        expect(calls).toBe(1);
    });

    it('skips the beat reducer on a context that carries no dispatch', () => {
        // The pass reaches `beatReducer` through `isReduceContext`, which tests
        // for `dispatch`. A context with the hook and no `dispatch` therefore
        // does not run it. `ActionPipeline` never builds one — it sets
        // `dispatch` on every context — so this records the coupling rather
        // than a reachable path, and it is what dropping the
        // `isReduceContext(ctx)` conjunct would change.
        let calls = 0;
        const ctx = {
            ...stubCtx,
            beatReducer: (state: BaseGameSnapshot) => {
                calls += 1;
                return state;
            },
        };

        engineTickDefinition.reduce(makeBeatSnapshot(), { seed: 1 }, hostId, ctx);

        expect(calls).toBe(0);
        // Control: the same hook on a context that DOES carry `dispatch` runs.
        engineTickDefinition.reduce(
            makeBeatSnapshot(),
            { seed: 1 },
            hostId,
            makeEngineCtx({ beatReducer: ctx.beatReducer }),
        );
        expect(calls).toBe(1);
    });

    it('invokes ctx.beatReducer exactly once even when two timers fire child actions', () => {
        let calls = 0;
        const snapshot = makeBeatSnapshot({
            timers: {
                ['tmr-a' as TimerId]: makeTickTimer({
                    id: 'tmr-a' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:a',
                }),
                ['tmr-b' as TimerId]: makeTickTimer({
                    id: 'tmr-b' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:b',
                }),
            },
        });
        const ctx = makeEngineCtx({
            beatReducer: (state) => {
                calls += 1;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(calls).toBe(1);
    });

    it('hands the beat reducer a context carrying no engine-internal field', () => {
        let beatCtxKeys: string[] = [];
        const { logger } = makeCapturingLogger();
        const ctx = makeEngineCtx({
            logger,
            beatReducer: (state, beatCtx) => {
                beatCtxKeys = Object.keys(beatCtx).sort();
                return state;
            },
        });

        // The supplied context carries all three engine-internal fields, so a
        // strip that misses any one of them shows up in the census below.
        expect(Object.keys(ctx).sort()).toEqual(
            ['beatReducer', 'dispatch', 'dispatchDepth', 'logger', 'rng'].sort(),
        );

        engineTickDefinition.reduce(makeBeatSnapshot(), { seed: 1 }, hostId, ctx);

        expect(beatCtxKeys).toEqual(['dispatchDepth', 'rng']);
    });

    it("leaves 'dispatch' absent from the beat context, so isReduceContext refuses it", () => {
        let hasDispatch: boolean | undefined;
        let narrows: boolean | undefined;
        const ctx = makeEngineCtx({
            beatReducer: (state, beatCtx) => {
                hasDispatch = 'dispatch' in beatCtx;
                narrows = isReduceContext(beatCtx);
                return state;
            },
        });

        engineTickDefinition.reduce(makeBeatSnapshot(), { seed: 1 }, hostId, ctx);

        expect(hasDispatch).toBe(false);
        // The consequence: game code inside `onBeat` cannot narrow its way to
        // `dispatch` (Invariant #89).
        expect(narrows).toBe(false);
    });

    it('preserves EVERY game-facing field on the beat context', () => {
        // Control for the strip above, over the whole `GameReduceContext`
        // surface rather than a sample of it: the strip must remove the three
        // engine-internal fields and nothing else, so a fourth key added to the
        // destructuring is caught here whichever one it is.
        const db = createContentDatabase([]);
        const undoManager = { canUndo: () => true, canRedo: () => false };
        const endTurnGuard = (): ValidationResult => ({ ok: true });
        const endTurnAuthority = (): boolean => true;

        let seen: Record<string, unknown> = {};
        const ctx = makeEngineCtx({
            dispatchDepth: 4,
            db,
            undoManager,
            endTurnGuard,
            endTurnAuthority,
            beatReducer: (state, beatCtx) => {
                seen = beatCtx as unknown as Record<string, unknown>;
                return state;
            },
        });

        engineTickDefinition.reduce(makeBeatSnapshot(), { seed: 1 }, hostId, ctx);

        expect(Object.keys(seen).sort()).toEqual(
            [
                'db',
                'dispatchDepth',
                'endTurnAuthority',
                'endTurnGuard',
                'rng',
                'undoManager',
            ].sort(),
        );
        // Same values, not merely same keys.
        expect(seen['rng']).toBe(ctx.rng);
        expect(seen['dispatchDepth']).toBe(4);
        expect(seen['db']).toBe(db);
        expect(seen['undoManager']).toBe(undoManager);
        expect(seen['endTurnGuard']).toBe(endTurnGuard);
        expect(seen['endTurnAuthority']).toBe(endTurnAuthority);
    });

    // ── Where the hook sits in the pass ───────────────────────────────────────

    it('runs the beat reducer AFTER the window sweep', () => {
        let seenRemaining: number | undefined;
        const snapshot = makeBeatSnapshot({ animationWindows: openWindow(3) });
        const ctx = makeEngineCtx({
            beatReducer: (state) => {
                seenRemaining = state.animationWindows?.[WINDOW]?.remainingBeats;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(seenRemaining).toBe(2);
    });

    it('runs the beat reducer AFTER the fired child dispatches', () => {
        let seenTick: number | undefined;
        const snapshot = makeBeatSnapshot({
            timers: {
                ['tmr-a' as TimerId]: makeTickTimer({
                    id: 'tmr-a' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:a',
                }),
            },
        });
        const ctx = makeEngineCtx({
            // A child action that advances the clock.
            dispatch: (state) => ({ ...state, tick: state.tick + 1 }),
            beatReducer: (state) => {
                seenTick = state.tick;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(seenTick).toBe(2);
    });

    it('runs the time-scale countdown BEFORE the beat reducer', () => {
        let seenRestore: number | undefined;
        const snapshot = makeBeatSnapshot({ timeScalePermille: 250, timeScaleRestoreBeats: 2 });
        const ctx = makeEngineCtx({
            beatReducer: (state) => {
                seenRestore = state.timeScaleRestoreBeats;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(seenRestore).toBe(1);
    });

    it('hands the beat reducer the closures the sweep produced this beat', () => {
        let seenClosed: readonly { id: string; reason: string }[] = [];
        const snapshot = makeBeatSnapshot({ animationWindows: openWindow(0) });
        const ctx = makeEngineCtx({
            beatReducer: (state, _beatCtx, closed) => {
                seenClosed = closed;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(seenClosed).toEqual([
            { id: WINDOW, ownerId: OWNER, payload: { damage: 12 }, reason: 'expired' },
        ]);
    });

    it('hands the beat reducer an empty closed list on a beat that closes nothing', () => {
        // Control for the case above: `closed` is not a constant non-empty list.
        let seenClosed: readonly unknown[] | undefined;
        const snapshot = makeBeatSnapshot({ animationWindows: openWindow(3) });
        const ctx = makeEngineCtx({
            beatReducer: (state, _beatCtx, closed) => {
                seenClosed = closed;
                return state;
            },
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(seenClosed).toEqual([]);
    });

    it('adopts the state the beat reducer returns', () => {
        const snapshot = makeBeatSnapshot({ animationWindows: openWindow(3) });
        const ctx = makeEngineCtx({
            // A game that cancelled the window closes it from inside the hook.
            beatReducer: (state) => AnimationWindowManager.interrupt(state, WINDOW).next,
        });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(next.animationWindows).toEqual({});
    });

    // ── The clocks are not each other ─────────────────────────────────────────

    it('advances tick by 3 when two fired child actions each advance it, while an open window loses exactly one beat', () => {
        // The pin that makes a `tick`-difference animation clock provably wrong:
        // one beat passed, but `tick` moved by three.
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(3),
            timers: {
                ['tmr-a' as TimerId]: makeTickTimer({
                    id: 'tmr-a' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:a',
                }),
                ['tmr-b' as TimerId]: makeTickTimer({
                    id: 'tmr-b' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:b',
                }),
            },
        });
        const ctx = makeEngineCtx({
            dispatch: (state) => ({ ...state, tick: state.tick + 1 }),
        });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(next.tick).toBe(3);
        expect(next.animationWindows?.[WINDOW]?.remainingBeats).toBe(2);
    });

    it('advances tick by exactly 1 when no child action advances it', () => {
        // Control for the case above: the +3 comes from the children, not from
        // the beat pass adding increments of its own.
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(3),
            timeScalePermille: 250,
            timeScaleRestoreBeats: 2,
        });
        const ctx = makeEngineCtx({ beatReducer: (state) => state });

        expect(engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx).tick).toBe(1);
    });

    // ── The pass adds no dispatch of its own ──────────────────────────────────

    it('calls ctx.dispatch for NO F82 path — a sweep and a restore are not actions', () => {
        // F82 adds ZERO nested dispatch: this is what keeps a match with
        // windows and dilation replayable without touching ReplayPlayer.
        const dispatched: string[] = [];
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(1),
            timeScalePermille: 250,
            timeScaleRestoreBeats: 1,
        });
        const ctx = makeEngineCtx({
            dispatch: (state, action) => {
                dispatched.push(action.type);
                return state;
            },
            beatReducer: (state) => state,
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        // The sweep closed a window and the dilation restored — neither is an
        // action.
        expect(dispatched).toEqual([]);
    });

    it('still dispatches the fired timer actions (control)', () => {
        const dispatched: string[] = [];
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(1),
            timers: {
                ['tmr-a' as TimerId]: makeTickTimer({
                    id: 'tmr-a' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:a',
                }),
            },
        });
        const ctx = makeEngineCtx({
            dispatch: (state, action) => {
                dispatched.push(action.type);
                return state;
            },
            beatReducer: (state) => state,
        });

        engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(dispatched).toEqual(['game:a']);
    });

    // ── TimerManager.advance stays a once-per-tick call (Invariant #55) ───────

    it('calls TimerManager.advance exactly once even when the sweep closes and the dilation restores', () => {
        const spy = vi.spyOn(TimerManager, 'advance');
        try {
            const snapshot = makeBeatSnapshot({
                animationWindows: openWindow(0),
                timeScalePermille: 250,
                timeScaleRestoreBeats: 0,
                timers: {
                    ['tmr-a' as TimerId]: makeTickTimer({
                        id: 'tmr-a' as TimerId,
                        remainingTicks: 1,
                        actionType: 'game:a',
                    }),
                },
            });
            const ctx = makeEngineCtx({ beatReducer: (state) => state });

            const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

            expect(spy).toHaveBeenCalledTimes(1);
            // The two F82 paths really did fire on this tick, so the count
            // above is not measured over an idle beat.
            expect(next.animationWindows).toEqual({});
            expect(next.timeScalePermille).toBe(1000);
        } finally {
            spy.mockRestore();
        }
    });

    // ── Zero-beat latency on an orphaned window ───────────────────────────────

    it('closes a window whose owner a timer-fired child removed in the SAME tick', () => {
        let seenClosed: readonly { reason: string }[] = [];
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(3),
            timers: {
                ['tmr-kill' as TimerId]: makeTickTimer({
                    id: 'tmr-kill' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:remove_unit',
                }),
            },
        });
        const ctx = makeEngineCtx({
            // The fired child action removes the window's owner.
            dispatch: (state) => ({ ...state, tick: state.tick + 1, entities: {} }),
            beatReducer: (state, _beatCtx, closed) => {
                seenClosed = closed;
                return state;
            },
        });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        // One call, not two: the record is gone and the closure is reported in
        // this beat's list.
        expect(next.animationWindows).toEqual({});
        expect(seenClosed).toEqual([
            { id: WINDOW, ownerId: OWNER, payload: { damage: 12 }, reason: 'owner-gone' },
        ]);
    });

    it('sweeps the registry a timer-fired child left behind, not the one the beat started with', () => {
        // The registry axis of the same ordering: a child action that closed the
        // window itself must not have it swept a second time, and the beat's
        // closed list must not report it twice.
        let seenClosed: readonly unknown[] | undefined;
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(3),
            timers: {
                ['tmr-cancel' as TimerId]: makeTickTimer({
                    id: 'tmr-cancel' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:cancel',
                }),
            },
        });
        const ctx = makeEngineCtx({
            dispatch: (state) => ({
                ...AnimationWindowManager.interrupt(state, WINDOW).next,
                tick: state.tick + 1,
            }),
            beatReducer: (state, _beatCtx, closed) => {
                seenClosed = closed;
                return state;
            },
        });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(next.animationWindows).toEqual({});
        expect(seenClosed).toEqual([]);
    });

    it('sweeps a window a timer-fired child OPENED in this same tick', () => {
        // The sweep runs after the child dispatches, so a window a child opens
        // for N beats is already at N-1 when the tick returns. This is the
        // OPPOSITE convention to `GameTimer`, where a timer a child creates does
        // not fire until the next `engine:tick` (§4.20) — the sweep has already
        // run by then, whereas here it has not.
        const snapshot = makeBeatSnapshot({
            timers: {
                ['tmr-open' as TimerId]: makeTickTimer({
                    id: 'tmr-open' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:strike',
                }),
            },
        });
        const ctx = makeEngineCtx({
            dispatch: (state) => ({
                ...AnimationWindowManager.open(state, {
                    id: WINDOW,
                    ownerId: OWNER,
                    durationBeats: 3,
                }).next,
                tick: state.tick + 1,
            }),
        });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(next.animationWindows?.[WINDOW]?.remainingBeats).toBe(2);
    });

    it('keeps a window whose owner is still live (control)', () => {
        const snapshot = makeBeatSnapshot({
            animationWindows: openWindow(3),
            timers: {
                ['tmr-keep' as TimerId]: makeTickTimer({
                    id: 'tmr-keep' as TimerId,
                    remainingTicks: 1,
                    actionType: 'game:noop',
                }),
            },
        });
        const ctx = makeEngineCtx({ dispatch: (state) => ({ ...state, tick: state.tick + 1 }) });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, ctx);

        expect(next.animationWindows?.[WINDOW]?.remainingBeats).toBe(2);
    });

    // ── A game using no F82 feature sees no delta ─────────────────────────────

    it('leaves an F82-free tick identical to the clock advance alone', () => {
        const snapshot = makeBeatSnapshot();
        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, stubCtx);

        // Written as an inline literal rather than `{...snapshot, tick: 1}` so a
        // stray field the pass adds cannot be spread into the expectation.
        expect(next).toEqual({
            tick: 1,
            seed: 42,
            players: { [hostId]: { id: hostId } },
            entities: { [OWNER]: { id: OWNER } },
            phase: 'waiting',
            events: [],
            turnNumber: 0,
            timers: {},
            gameResult: null,
        });
        // No new key at all — `toEqual` ignores a key whose value is undefined.
        expect(Object.keys(next).sort()).toEqual(Object.keys(snapshot).sort());
        // The timer registry is handed back by reference, as before F82.
        expect(next.timers).toBe(snapshot.timers);
    });

    it('leaves an empty window registry as the same reference', () => {
        // A game that has closed every window keeps an empty registry on the
        // snapshot forever. The pass writes back whatever the sweep returned,
        // so this is the sweep's own empty fast path reaching the snapshot: a
        // pass that rebuilt the field instead would hand every later beat a
        // fresh object.
        const registry: AnimationWindowRegistry = {};
        const snapshot = makeBeatSnapshot({ animationWindows: registry });

        const next = engineTickDefinition.reduce(snapshot, { seed: 1 }, hostId, stubCtx);

        expect(next.animationWindows).toBe(registry);
    });
});
