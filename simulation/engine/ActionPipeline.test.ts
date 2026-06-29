/**
 * simulation/engine/ActionPipeline.test.ts
 *
 * TDD tests for ActionPipeline (7-stage) and StateReducer.
 *
 * Architecture reference: §4.7
 * Task: F03 / T5 (issue #28)
 *
 * Tests are written FIRST (red) before ActionPipeline.ts exists.
 * They express all acceptance criteria from issue #28:
 *
 *   1. All 7 stages execute in documented fixed order.
 *   2. StaleActionError thrown when envelope tick ≠ snapshot tick.
 *   3. ActionSchemaError thrown when parsePayload throws.
 *   4. ActionUnauthorizedError thrown when validate() returns { ok: false }.
 *   5. Re-entrant dispatch() throws after depth exceeds MAX_NESTED_DISPATCH = 16.
 *   6. Stages 3, 6, 7 are no-op stubs (pipeline still returns next state).
 *   7. StateReducer delegates to registry and calls def.reduce().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    ActionPipeline,
    StaleActionError,
    ActionSchemaError,
    ActionUnauthorizedError,
    RecursiveDispatchError,
    ForbiddenDispatchError,
    MAX_NESTED_DISPATCH,
} from './ActionPipeline.js';
import { ActionRegistry, UnknownActionTypeError } from './ActionRegistry.js';
import type {
    BaseGameSnapshot,
    ActionEnvelope,
    PlayerId,
    ActionDefinition,
    ReduceContext,
    GameReduceContext,
    PipelineContext,
} from './types.js';
import { playerId as toPlayerId, isReduceContext } from './types.js';
import type { GameTimer, TimerId } from './GameTimer.js';
import { createContentDatabase } from '../content/index.js';
import { SnapshotRingBuffer } from '../debug/SnapshotRingBuffer.js';
import {
    engineUndoDefinition,
    engineRedoDefinition,
    engineEndTurnDefinition,
    engineSyncRequestDefinition,
    engineReturnToLobbyDefinition,
    engineTickDefinition,
} from './EngineActions.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

const PID = toPlayerId('p1');

const makeSnapshot = (tick = 0, turnNumber = 0): BaseGameSnapshot => ({
    tick,
    seed: 1,
    players: {},
    entities: {},
    phase: 'test' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber,
    timers: {},
    gameResult: null,
});

const makeEnvelope = (
    tick = 0,
    type = 'game:noop',
    payload: Record<string, unknown> = {},
): ActionEnvelope => ({
    type,
    playerId: PID,
    tick,
    payload,
});

/** No-op action definition — parse always succeeds, validate always allows, reduce returns state unchanged. */
const noopDef: ActionDefinition<Record<string, never>> = {
    type: 'game:noop',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => state,
};

let registry: ActionRegistry;
let pipeline: ActionPipeline;

beforeEach(() => {
    registry = new ActionRegistry();
    registry.register(noopDef);
    pipeline = new ActionPipeline(registry);
});

// ─── Error class shapes ────────────────────────────────────────────────────────

describe('StaleActionError', () => {
    it('is an Error subclass', () => {
        expect(new StaleActionError(5, 3)).toBeInstanceOf(Error);
    });

    it('has code STALE_ACTION', () => {
        expect(new StaleActionError(5, 3).code).toBe('STALE_ACTION');
    });

    it('exposes actionTick and snapshotTick fields', () => {
        const err = new StaleActionError(5, 3);
        expect(err.actionTick).toBe(5);
        expect(err.snapshotTick).toBe(3);
    });
});

describe('ActionSchemaError', () => {
    it('is an Error subclass', () => {
        expect(new ActionSchemaError('game:x')).toBeInstanceOf(Error);
    });

    it('has code ACTION_SCHEMA', () => {
        expect(new ActionSchemaError('game:x').code).toBe('ACTION_SCHEMA');
    });

    it('exposes the action type', () => {
        expect(new ActionSchemaError('game:move').type).toBe('game:move');
    });
});

describe('ActionUnauthorizedError', () => {
    it('is an Error subclass', () => {
        expect(new ActionUnauthorizedError('game:x')).toBeInstanceOf(Error);
    });

    it('has code ACTION_UNAUTHORIZED', () => {
        expect(new ActionUnauthorizedError('game:x').code).toBe('ACTION_UNAUTHORIZED');
    });

    it('exposes the action type', () => {
        expect(new ActionUnauthorizedError('game:end').type).toBe('game:end');
    });

    it('exposes the optional reason', () => {
        expect(new ActionUnauthorizedError('game:end', 'out_of_range').reason).toBe('out_of_range');
        expect(new ActionUnauthorizedError('game:end').reason).toBeUndefined();
    });
});

describe('RecursiveDispatchError', () => {
    it('is an Error subclass', () => {
        expect(new RecursiveDispatchError(16)).toBeInstanceOf(Error);
    });

    it('has code RECURSIVE_DISPATCH', () => {
        expect(new RecursiveDispatchError(16).code).toBe('RECURSIVE_DISPATCH');
    });
});

// ─── MAX_NESTED_DISPATCH constant ──────────────────────────────────────────────

describe('MAX_NESTED_DISPATCH', () => {
    it('equals 16', () => {
        expect(MAX_NESTED_DISPATCH).toBe(16);
    });
});

// ─── Stage 1 — tick validation ─────────────────────────────────────────────────

describe('ActionPipeline — Stage 1: tick validation', () => {
    it('throws StaleActionError when action.tick is less than snapshot.tick', () => {
        const snapshot = makeSnapshot(5);
        const action = makeEnvelope(3);
        expect(() => pipeline.process(snapshot, action)).toThrow(StaleActionError);
    });

    it('throws StaleActionError when action.tick is greater than snapshot.tick', () => {
        const snapshot = makeSnapshot(3);
        const action = makeEnvelope(5);
        expect(() => pipeline.process(snapshot, action)).toThrow(StaleActionError);
    });

    it('thrown StaleActionError carries the mismatched tick values', () => {
        const snapshot = makeSnapshot(5);
        const action = makeEnvelope(3);
        let caught: unknown;
        try {
            pipeline.process(snapshot, action);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(StaleActionError);
        const err = caught as StaleActionError;
        expect(err.actionTick).toBe(3);
        expect(err.snapshotTick).toBe(5);
    });

    it('does not throw StaleActionError when ticks match', () => {
        const snapshot = makeSnapshot(7);
        const action = makeEnvelope(7);
        expect(() => pipeline.process(snapshot, action)).not.toThrow(StaleActionError);
    });

    it('throws UnknownActionTypeError for unregistered type (after tick match)', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:no-such-action');
        expect(() => pipeline.process(snapshot, action)).toThrow(UnknownActionTypeError);
    });
});

// ─── Stage 2 — schema validation ──────────────────────────────────────────────

describe('ActionPipeline — Stage 2: schema validation', () => {
    const schemaErrorDef: ActionDefinition<Record<string, never>> = {
        type: 'game:bad-schema',
        parsePayload() {
            throw new TypeError('payload missing required field');
        },
        validate: () => ({ ok: true }),
        reduce: (state) => state,
    };

    beforeEach(() => {
        registry.register(schemaErrorDef);
    });

    it('throws ActionSchemaError when parsePayload throws', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:bad-schema');
        expect(() => pipeline.process(snapshot, action)).toThrow(ActionSchemaError);
    });

    it('ActionSchemaError carries the action type', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:bad-schema');
        let caught: unknown;
        try {
            pipeline.process(snapshot, action);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ActionSchemaError);
        expect((caught as ActionSchemaError).type).toBe('game:bad-schema');
    });
});

// ─── Stage 3 — undo/redo intercept (no-op stub) ────────────────────────────────

describe('ActionPipeline — Stage 3: undo/redo intercept stub', () => {
    it('does not throw for non-undo/redo actions (stage is a no-op)', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        expect(() => pipeline.process(snapshot, action)).not.toThrow();
    });
});

// ─── Stage 4 — authorization (validate) ───────────────────────────────────────

describe('ActionPipeline — Stage 4: authorization', () => {
    const deniedDef: ActionDefinition<Record<string, never>> = {
        type: 'game:denied',
        parsePayload: () => ({}),
        validate: () => ({ ok: false, reason: 'not_your_turn' }),
        reduce: (state) => state,
    };

    const deniedNoReasonDef: ActionDefinition<Record<string, never>> = {
        type: 'game:denied-no-reason',
        parsePayload: () => ({}),
        validate: () => ({ ok: false }),
        reduce: (state) => state,
    };

    beforeEach(() => {
        registry.register(deniedDef);
        registry.register(deniedNoReasonDef);
    });

    it('throws ActionUnauthorizedError when validate returns { ok: false }', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:denied');
        expect(() => pipeline.process(snapshot, action)).toThrow(ActionUnauthorizedError);
    });

    it('ActionUnauthorizedError includes the reason from ValidationResult', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:denied');
        let caught: unknown;
        try {
            pipeline.process(snapshot, action);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ActionUnauthorizedError);
        expect((caught as ActionUnauthorizedError).reason).toBe('not_your_turn');
    });

    it('ActionUnauthorizedError has undefined reason when ValidationResult has none', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:denied-no-reason');
        let caught: unknown;
        try {
            pipeline.process(snapshot, action);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ActionUnauthorizedError);
        expect((caught as ActionUnauthorizedError).reason).toBeUndefined();
    });

    it('does not throw ActionUnauthorizedError when validate returns { ok: true }', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        expect(() => pipeline.process(snapshot, action)).not.toThrow(ActionUnauthorizedError);
    });
});

// ─── Stage 5 — reduce ─────────────────────────────────────────────────────────

describe('ActionPipeline — Stage 5: reduce', () => {
    it('returns the next state produced by the definition reducer', () => {
        const advanceDef: ActionDefinition<Record<string, never>> = {
            type: 'game:advance-tick',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state) => ({ ...state, tick: state.tick + 1 }),
        };
        registry.register(advanceDef);

        const snapshot = makeSnapshot(5);
        const action = makeEnvelope(5, 'game:advance-tick');
        const next = pipeline.process(snapshot, action);
        expect(next.tick).toBe(6);
    });

    it('does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot(0);
        const frozen = Object.freeze(snapshot);
        const action = makeEnvelope(0);
        expect(() => pipeline.process(frozen, action)).not.toThrow();
    });

    it('passes playerId from the action envelope to the reducer', () => {
        const capturedPlayerIds: PlayerId[] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:spy-player',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, playerId) => {
                capturedPlayerIds.push(playerId);
                return state;
            },
        };
        registry.register(spyDef);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:spy-player');
        pipeline.process(snapshot, action);
        expect(capturedPlayerIds).toHaveLength(1);
        expect(capturedPlayerIds[0]).toBe(PID);
    });
});

// ─── Post-reduce game-result resolution (§4.38) ─────────────────────────────

describe('ActionPipeline — post-reduce game-result resolution', () => {
    const advanceDef: ActionDefinition<Record<string, never>> = {
        type: 'game:resolve-test',
        parsePayload: () => ({}),
        validate: () => ({ ok: true }),
        reduce: (state) => ({
            ...state,
            tick: state.tick + 1,
            phase: 'playing' as BaseGameSnapshot['phase'],
        }),
    };

    it('writes a non-null resolved result and ends the match after reduce', () => {
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        r.registerGame('test-game', {
            resolveGameResult: (snapshot) => (snapshot.tick === 1 ? { winnerIds: [PID] } : null),
        });
        const p = new ActionPipeline(r, { gameId: 'test-game' });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:resolve-test'));

        expect(next.tick).toBe(1);
        expect(next.gameResult).toEqual({ winnerIds: [PID] });
        expect(next.phase).toBe('ended');
    });

    it('leaves gameResult null when no resolver is registered for the pipeline game', () => {
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        const p = new ActionPipeline(r, { gameId: 'test-game' });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:resolve-test'));

        expect(next.gameResult).toBeNull();
        expect(next.phase).toBe('playing');
    });

    it('leaves gameResult null when the resolver returns null', () => {
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        r.registerGame('test-game', {
            resolveGameResult: () => null,
        });
        const p = new ActionPipeline(r, { gameId: 'test-game' });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:resolve-test'));

        expect(next.gameResult).toBeNull();
        expect(next.phase).toBe('playing');
    });

    it('rejects game actions once a game result has been recorded', () => {
        const validate = vi.fn(() => ({ ok: true }) as const);
        const reduce = vi.fn((state: Readonly<BaseGameSnapshot>) => ({
            ...state,
            tick: state.tick + 1,
        }));
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register({
            type: 'game:after-result',
            parsePayload: () => ({}),
            validate,
            reduce,
        });
        const p = new ActionPipeline(r, { gameId: 'test-game' });
        const resolvedSnapshot = {
            ...makeSnapshot(8),
            phase: 'ended' as BaseGameSnapshot['phase'],
            gameResult: { winnerIds: [PID] },
        };

        let caught: unknown;
        try {
            p.process(resolvedSnapshot, makeEnvelope(8, 'game:after-result'));
        } catch (e) {
            caught = e;
        }

        expect(caught).toBeInstanceOf(ActionUnauthorizedError);
        expect((caught as ActionUnauthorizedError).reason).toBe('match_already_resolved');
        expect(validate).not.toHaveBeenCalled();
        expect(reduce).not.toHaveBeenCalled();
    });

    it('rejects undo before the undo manager intercept can reconstruct a resolved match', () => {
        const undoManager = {
            canUndo: vi.fn(() => true),
            canRedo: vi.fn(() => false),
            undo: vi.fn(() => makeSnapshot(7)),
            redo: vi.fn(() => makeSnapshot(7)),
            clearUndoHistory: vi.fn(),
            saveTurnMemento: vi.fn(),
        };
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineUndoDefinition);
        const p = new ActionPipeline(r, { context: { undoManager }, gameId: 'test-game' });
        const resolvedSnapshot = {
            ...makeSnapshot(8),
            phase: 'ended' as BaseGameSnapshot['phase'],
            gameResult: { winnerIds: [PID] },
        };

        expect(() => p.process(resolvedSnapshot, makeEnvelope(8, 'engine:undo'))).toThrow(
            ActionUnauthorizedError,
        );
        expect(undoManager.undo).not.toHaveBeenCalled();
    });

    it('allows sync requests after a resolved match so clients can receive the final snapshot', () => {
        const broadcast = vi.fn();
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineSyncRequestDefinition);
        const p = new ActionPipeline(r, { context: { broadcast }, gameId: 'test-game' });
        const resolvedSnapshot = {
            ...makeSnapshot(8),
            players: { [PID]: { id: PID } },
            phase: 'ended' as BaseGameSnapshot['phase'],
            gameResult: { winnerIds: [PID] },
        };

        const next = p.process(resolvedSnapshot, makeEnvelope(8, 'engine:sync_request'));

        expect(next).toBe(resolvedSnapshot);
        expect(broadcast).toHaveBeenCalledOnce();
        expect(broadcast).toHaveBeenCalledWith(resolvedSnapshot, PID);
    });

    it('allows engine:return_to_lobby after a resolved match so the host can abandon to the lobby', () => {
        // return_to_lobby is the host-only reset-out-of-a-finished-match action
        // (the reverse of start_game). The terminal gate must not block it, or the
        // host could never leave a finished match back to the lobby — the bug
        // behind "Return to lobby does nothing" from the post-game summary/replay.
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineReturnToLobbyDefinition);
        const p = new ActionPipeline(r, { gameId: 'test-game' });
        const resolvedSnapshot = {
            ...makeSnapshot(8),
            hostPlayerId: PID,
            players: { [PID]: { id: PID } },
            phase: 'ended' as BaseGameSnapshot['phase'],
            gameResult: { winnerIds: [PID] },
        };

        const next = p.process(resolvedSnapshot, makeEnvelope(8, 'engine:return_to_lobby'));

        expect(next.phase).toBe('lobby');
        expect(next.gameResult).toBeNull();
    });
});

// ─── debugObserver hook (§4.12, Invariant #31) ────────────────────────────────

describe('ActionPipeline — debugObserver hook (§4.12, Invariant #31)', () => {
    const advanceDef: ActionDefinition<Record<string, never>> = {
        type: 'game:advance',
        parsePayload: () => ({}),
        validate: () => ({ ok: true }),
        reduce: (state) => ({ ...state, tick: state.tick + 1 }),
    };

    it('calls debugObserver once with the post-reduce tick and state', () => {
        const debugObserver = vi.fn();
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        const p = new ActionPipeline(r, { context: { debugObserver } });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:advance'));

        expect(debugObserver).toHaveBeenCalledOnce();
        expect(debugObserver).toHaveBeenCalledWith(next.tick, next);
        expect(next.tick).toBe(1);
    });

    it('passes the game-result-resolved state, not the raw reducer output', () => {
        const debugObserver = vi.fn();
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        r.registerGame('test-game', {
            resolveGameResult: (snapshot) => (snapshot.tick === 1 ? { winnerIds: [PID] } : null),
        });
        const p = new ActionPipeline(r, { context: { debugObserver }, gameId: 'test-game' });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:advance'));

        expect(debugObserver).toHaveBeenCalledOnce();
        const [observedTick, observedState] = debugObserver.mock.calls[0] as [
            number,
            BaseGameSnapshot,
        ];
        expect(observedTick).toBe(1);
        expect(observedState).toBe(next);
        expect(observedState.gameResult).toEqual({ winnerIds: [PID] });
    });

    it('fires even when the reducer returns the input state unchanged', () => {
        const debugObserver = vi.fn();
        const p = new ActionPipeline(registry, { context: { debugObserver } });
        const snapshot = makeSnapshot(0);

        const next = p.process(snapshot, makeEnvelope(0));

        expect(next).toBe(snapshot);
        expect(debugObserver).toHaveBeenCalledOnce();
        expect(debugObserver).toHaveBeenCalledWith(0, snapshot);
    });

    it('is unaffected when debugObserver is undefined — production path (Invariant #31)', () => {
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        const p = new ActionPipeline(r, { context: {} });
        const frozen = Object.freeze(makeSnapshot(0));

        const next = p.process(frozen, makeEnvelope(0, 'game:advance'));

        expect(next.tick).toBe(1);
        expect(frozen.tick).toBe(0); // input never mutated
    });

    it('feeds a real SnapshotRingBuffer wired as debugObserver', () => {
        const buffer = new SnapshotRingBuffer();
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.register(advanceDef);
        const p = new ActionPipeline(r, {
            context: { debugObserver: (tick, snapshot) => buffer.record(tick, snapshot) },
        });

        const next = p.process(makeSnapshot(0), makeEnvelope(0, 'game:advance'));

        expect(buffer.get(1)?.snapshot).toBe(next);
        expect(buffer.allTicks()).toEqual([1]);
    });

    // ── Stage-3 undo/redo intercept path ──────────────────────────────────────
    // The intercept short-circuits Stages 4–5 but still produces a new
    // authoritative state, so the observer must fire there too — otherwise a
    // live Inspector never sees undo/redo transitions and the ring buffer can
    // hold a stale entry for the reconstructed tick.

    const makeInterceptUndoManager = (
        reconstructed: BaseGameSnapshot,
    ): NonNullable<PipelineContext['undoManager']> => ({
        canUndo: vi.fn(() => true),
        canRedo: vi.fn(() => true),
        undo: vi.fn(() => reconstructed),
        redo: vi.fn(() => reconstructed),
        clearUndoHistory: vi.fn(),
        saveTurnMemento: vi.fn(),
    });

    it('fires on the Stage-3 engine:undo intercept path with the reconstructed state', () => {
        const debugObserver = vi.fn();
        const reconstructed = makeSnapshot(3);
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineUndoDefinition);
        const p = new ActionPipeline(r, {
            context: { undoManager: makeInterceptUndoManager(reconstructed), debugObserver },
        });

        const result = p.process(makeSnapshot(5), makeEnvelope(5, 'engine:undo'));

        expect(result).toBe(reconstructed);
        expect(debugObserver).toHaveBeenCalledOnce();
        expect(debugObserver).toHaveBeenCalledWith(3, reconstructed);
    });

    it('fires on the Stage-3 engine:redo intercept path with the reconstructed state', () => {
        const debugObserver = vi.fn();
        const reconstructed = makeSnapshot(4);
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineRedoDefinition);
        const p = new ActionPipeline(r, {
            context: { undoManager: makeInterceptUndoManager(reconstructed), debugObserver },
        });

        const result = p.process(makeSnapshot(5), makeEnvelope(5, 'engine:redo'));

        expect(result).toBe(reconstructed);
        expect(debugObserver).toHaveBeenCalledOnce();
        expect(debugObserver).toHaveBeenCalledWith(4, reconstructed);
    });

    it('passes the game-result-resolved state on the undo intercept path, not the raw reconstruction', () => {
        const debugObserver = vi.fn();
        const reconstructed = makeSnapshot(3);
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineUndoDefinition);
        r.registerGame('test-game', {
            resolveGameResult: (snapshot) => (snapshot.tick === 3 ? { winnerIds: [PID] } : null),
        });
        const p = new ActionPipeline(r, {
            context: { undoManager: makeInterceptUndoManager(reconstructed), debugObserver },
            gameId: 'test-game',
        });

        const result = p.process(makeSnapshot(5), makeEnvelope(5, 'engine:undo'));

        expect(debugObserver).toHaveBeenCalledOnce();
        expect(debugObserver).toHaveBeenCalledWith(3, result);
        const [, observedState] = debugObserver.mock.calls[0] as [number, BaseGameSnapshot];
        expect(observedState.gameResult).toEqual({ winnerIds: [PID] });
    });

    // ── Nested dispatch (engine:tick timers) ─────────────────────────────────
    // The observer fires at every dispatch depth (unlike history/broadcast,
    // which are gated to depth 0); same-tick re-records collapse in place so
    // the buffer ends up holding only the final state for the tick.

    it('collapses nested-dispatch intermediates: the buffer keeps only the final engine:tick state', () => {
        const markDef = (type: string): ActionDefinition<Record<string, never>> => ({
            type,
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state) => ({ ...state, events: [...state.events, { type }] }),
        });
        const makeFiringTimer = (id: string, actionType: string): GameTimer => ({
            id: id as TimerId,
            remainingTicks: 1,
            intervalTicks: 0,
            actionType,
            payload: {},
            active: true,
        });
        const r = new ActionRegistry<BaseGameSnapshot>();
        r.registerEngineAction(engineTickDefinition);
        r.register(markDef('game:mark_a'));
        r.register(markDef('game:mark_b'));

        const buffer = new SnapshotRingBuffer();
        const recorded: { tick: number; eventTypes: string[] }[] = [];
        buffer.onRecord = (entry) => {
            recorded.push({
                tick: entry.tick,
                eventTypes: entry.snapshot.events.map((e) => e.type),
            });
        };
        const p = new ActionPipeline(r, {
            context: { debugObserver: (tick, snapshot) => buffer.record(tick, snapshot) },
        });

        const snapshot: BaseGameSnapshot = {
            ...makeSnapshot(0),
            timers: {
                ['tmr-a' as TimerId]: makeFiringTimer('tmr-a', 'game:mark_a'),
                ['tmr-b' as TimerId]: makeFiringTimer('tmr-b', 'game:mark_b'),
            },
        };
        const next = p.process(snapshot, makeEnvelope(0, 'engine:tick', { seed: 1 }));

        // onRecord saw every depth: two nested intermediates, then the outer final.
        expect(recorded).toEqual([
            { tick: 1, eventTypes: ['game:mark_a'] },
            { tick: 1, eventTypes: ['game:mark_a', 'game:mark_b'] },
            { tick: 1, eventTypes: ['game:mark_a', 'game:mark_b'] },
        ]);
        // Same-tick re-records collapsed in place — one slot, holding the final state.
        expect(buffer.allTicks()).toEqual([1]);
        expect(buffer.get(1)?.snapshot).toBe(next);
        expect(next.events.map((e) => e.type)).toEqual(['game:mark_a', 'game:mark_b']);
    });
});

// ─── Stages 6 & 7 — no-op stubs ───────────────────────────────────────────────

describe('ActionPipeline — Stages 6 & 7: no-op stubs', () => {
    it('returns a result after all 7 stages (stubs do not block progression)', () => {
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        const result = pipeline.process(snapshot, action);
        expect(result).toBeDefined();
    });
});

// ─── Re-entrant dispatch depth guard ──────────────────────────────────────────

describe('ActionPipeline — re-entrant dispatch depth guard', () => {
    it('throws RecursiveDispatchError when nesting depth exceeds MAX_NESTED_DISPATCH (engine:tick)', () => {
        // An engine:tick reducer that immediately re-dispatches engine:tick via ctx.dispatch.
        // Only engine:tick may call ctx.dispatch (§4.20, invariant #89).
        // This creates unlimited recursion unless the depth guard fires.
        const recursiveTickDef: ActionDefinition<{ seed: number }> = {
            type: 'engine:tick',
            parsePayload: (raw) => ({ seed: raw['seed'] as number }),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'engine:tick',
                        playerId: PID,
                        tick: state.tick,
                        payload: { seed: 0 },
                    });
                }
                return state;
            },
        };
        const r = new ActionRegistry();
        r.registerEngineAction(recursiveTickDef);
        const p = new ActionPipeline(r);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:tick', { seed: 0 });
        expect(() => p.process(snapshot, action)).toThrow(RecursiveDispatchError);
    });

    it('allows exactly MAX_NESTED_DISPATCH levels of re-entrant dispatch (engine:tick)', () => {
        let callCount = 0;

        // An engine:tick reducer that dispatches engine:tick up to MAX_NESTED_DISPATCH times.
        const counterTickDef: ActionDefinition<{ seed: number }> = {
            type: 'engine:tick',
            parsePayload: (raw) => ({ seed: raw['seed'] as number }),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                callCount++;
                if (callCount <= MAX_NESTED_DISPATCH && isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'engine:tick',
                        playerId: PID,
                        tick: state.tick,
                        payload: { seed: 0 },
                    });
                }
                return state;
            },
        };
        const r = new ActionRegistry();
        r.registerEngineAction(counterTickDef);
        const p = new ActionPipeline(r);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:tick', { seed: 0 });
        // Exactly MAX_NESTED_DISPATCH dispatches — should not throw.
        expect(() => p.process(snapshot, action)).not.toThrow(RecursiveDispatchError);
    });

    it('game reducer calling ctx.dispatch() throws ForbiddenDispatchError', () => {
        // Game reducers must NOT call ctx.dispatch — it is gated to engine:tick only.
        // A well-written game reducer will not even try; this test guards against
        // naive or accidental attempts after isReduceContext() narrowing.
        const callerDef: ActionDefinition<Record<string, never>> = {
            type: 'game:dispatch-caller',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'game:dispatch-caller',
                        playerId: PID,
                        tick: state.tick,
                        payload: {},
                    });
                }
                return state;
            },
        };
        registry.register(callerDef);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:dispatch-caller');
        expect(() => pipeline.process(snapshot, action)).toThrow(ForbiddenDispatchError);
    });

    it('game reducer ctx.dispatch stub carries FORBIDDEN_DISPATCH code', () => {
        let caughtError: unknown;
        const callerDef: ActionDefinition<Record<string, never>> = {
            type: 'game:forbidden-code',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    try {
                        return ctx.dispatch(state, {
                            type: 'game:forbidden-code',
                            playerId: PID,
                            tick: state.tick,
                            payload: {},
                        });
                    } catch (e) {
                        caughtError = e;
                    }
                }
                return state;
            },
        };
        registry.register(callerDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:forbidden-code'));
        expect(caughtError).toBeInstanceOf(ForbiddenDispatchError);
        expect((caughtError as ForbiddenDispatchError).code).toBe('FORBIDDEN_DISPATCH');
    });
});

// ─── ActionPipeline constructor options ────────────────────────────────────────

describe('ActionPipeline constructor', () => {
    it('accepts no options (logger defaults to noop)', () => {
        expect(() => new ActionPipeline(registry)).not.toThrow();
    });

    it('accepts an optional logger without throwing', () => {
        const noopLogger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
        };
        expect(() => new ActionPipeline(registry, { logger: noopLogger })).not.toThrow();
    });
});

// ─── ContentDatabase forwarding ────────────────────────────────────────────────

describe('ActionPipeline — ContentDatabase forwarding (issue #102)', () => {
    it('ctx.db is undefined in validate() when no db is provided to the constructor', () => {
        const capturedCtxValues: ReduceContext['db'][] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:spy-db',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                capturedCtxValues.push(ctx.db);
                return { ok: true };
            },
            reduce: (state) => state,
        };
        registry.register(spyDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:spy-db'));
        expect(capturedCtxValues[0]).toBeUndefined();
    });

    it('ctx.db is undefined in reduce() when no db is provided to the constructor', () => {
        const capturedCtxValues: ReduceContext['db'][] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:spy-db-reduce',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedCtxValues.push(ctx.db);
                return state;
            },
        };
        registry.register(spyDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:spy-db-reduce'));
        expect(capturedCtxValues[0]).toBeUndefined();
    });

    it('ctx.db in validate() is the ContentDatabase passed to the constructor', () => {
        const db = createContentDatabase([
            { collectionType: 'player-colors', items: [{ id: 'blue', name: 'Blue' }] },
        ]);
        const capturedCtxValues: ReduceContext['db'][] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:spy-db-validate-wired',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                capturedCtxValues.push(ctx.db);
                return { ok: true };
            },
            reduce: (state) => state,
        };
        const dbRegistry = new ActionRegistry();
        dbRegistry.register(spyDef);
        const dbPipeline = new ActionPipeline(dbRegistry, { context: { db } });
        dbPipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:spy-db-validate-wired'));
        expect(capturedCtxValues[0]).toBe(db);
    });

    it('ctx.db in reduce() is the ContentDatabase passed to the constructor', () => {
        const db = createContentDatabase([
            { collectionType: 'player-colors', items: [{ id: 'blue', name: 'Blue' }] },
        ]);
        const capturedCtxValues: ReduceContext['db'][] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:spy-db-reduce-wired',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedCtxValues.push(ctx.db);
                return state;
            },
        };
        const dbRegistry = new ActionRegistry();
        dbRegistry.register(spyDef);
        const dbPipeline = new ActionPipeline(dbRegistry, { context: { db } });
        dbPipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:spy-db-reduce-wired'));
        expect(capturedCtxValues[0]).toBe(db);
    });

    it('db can be queried inside validate() to read content items', () => {
        const db = createContentDatabase([
            { collectionType: 'player-colors', items: [{ id: 'blue', name: 'Blue' }] },
        ]);
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:query-db',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                if (ctx.db?.has('player-colors', 'blue')) {
                    return { ok: true };
                }
                return { ok: false, reason: 'no_blue' };
            },
            reduce: (state) => state,
        };
        const dbRegistry = new ActionRegistry();
        dbRegistry.register(spyDef);
        const dbPipeline = new ActionPipeline(dbRegistry, { context: { db } });
        expect(() =>
            dbPipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:query-db')),
        ).not.toThrow();
    });
});

// ─── Stage 7 — PipelineContext wiring (issue #353, F15-hardening) ────────────

describe('ActionPipeline — Stage 7: PipelineContext broadcast wiring', () => {
    const PID2 = toPlayerId('p2');
    const PID3 = toPlayerId('p3');

    /** Helper: registers a state-advancing action that returns a NEW snapshot reference. */
    const ADVANCE_TYPE = 'game:advance-stage7';
    const advanceDef: ActionDefinition<Record<string, never>> = {
        type: ADVANCE_TYPE,
        parsePayload: () => ({}),
        validate: () => ({ ok: true }),
        reduce: (state) => ({ ...state, tick: state.tick + 1 }),
    };

    const makeSnapshotWithPlayers = (
        tick: number,
        playerIds: readonly PlayerId[],
    ): BaseGameSnapshot => ({
        tick,
        seed: 1,
        players: Object.fromEntries(playerIds.map((id) => [id, { id }])),
        entities: {},
        phase: 'test' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    });

    beforeEach(() => {
        // Register the state-advancing action so Stage 7 tests can produce
        // a nextState !== snapshot reference.
        if (!registry.has(ADVANCE_TYPE)) {
            registry.register(advanceDef);
        }
    });

    // ── Improvement 1: constructor now accepts context?: PipelineContext ──────

    it('constructor accepts an optional context option without throwing', () => {
        const context: PipelineContext = {
            broadcast: vi.fn(),
        };
        expect(() => new ActionPipeline(registry, { context })).not.toThrow();
    });

    it('Stage 7 silently skips broadcast when no context is provided', () => {
        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        const action = makeEnvelope(0, ADVANCE_TYPE);
        // No context in constructor — must not throw and must return state.
        expect(() => pipeline.process(snapshot, action)).not.toThrow();
    });

    it('Stage 7 silently skips broadcast when context.broadcast is absent', () => {
        const context: PipelineContext = {};
        const p = new ActionPipeline(registry, { context });
        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        const action = makeEnvelope(0, ADVANCE_TYPE);
        expect(() => p.process(snapshot, action)).not.toThrow();
    });

    // ── Improvement 3: Stage 7 skips broadcast when nextState === snapshot ────

    it('Stage 7 does NOT call broadcast when nextState === snapshot (same reference)', () => {
        const broadcast = vi.fn();
        const context: PipelineContext = { broadcast };
        const p = new ActionPipeline(registry, { context });

        // game:noop returns the same reference — no new state produced.
        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        const action = makeEnvelope(0); // game:noop
        p.process(snapshot, action);

        expect(broadcast).not.toHaveBeenCalled();
    });

    it('routes idle engine:tick through broadcastTick without full broadcast', () => {
        const tickRegistry = new ActionRegistry();
        tickRegistry.registerEngineAction(engineTickDefinition);
        const broadcast = vi.fn();
        const broadcastTick = vi.fn();
        const context: PipelineContext = { broadcast, broadcastTick };
        const p = new ActionPipeline(tickRegistry, { context });
        const snapshot = makeSnapshotWithPlayers(0, [PID, PID2]);

        p.process(snapshot, makeEnvelope(0, 'engine:tick', { seed: snapshot.seed }));

        expect(broadcast).not.toHaveBeenCalled();
        expect(broadcastTick).toHaveBeenCalledTimes(2);
        expect(broadcastTick).toHaveBeenNthCalledWith(1, 1, PID);
        expect(broadcastTick).toHaveBeenNthCalledWith(2, 1, PID2);
    });

    it('uses full broadcast for engine:tick when non-clock state changes', () => {
        const changingTickRegistry = new ActionRegistry();
        changingTickRegistry.registerEngineAction({
            type: 'engine:tick',
            parsePayload: (raw) => ({ seed: raw['seed'] as number }),
            validate: () => ({ ok: true }),
            reduce: (state) => ({
                ...state,
                tick: state.tick + 1,
                events: [{ type: 'game:timer-fired' }],
            }),
        });
        const broadcast = vi.fn();
        const broadcastTick = vi.fn();
        const context: PipelineContext = { broadcast, broadcastTick };
        const p = new ActionPipeline(changingTickRegistry, { context });
        const snapshot = makeSnapshotWithPlayers(0, [PID]);

        p.process(snapshot, makeEnvelope(0, 'engine:tick', { seed: snapshot.seed }));

        expect(broadcastTick).not.toHaveBeenCalled();
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ tick: 1 }), PID);
    });

    it('uses full broadcast for engine:sync_request even when state reference is unchanged', () => {
        const syncRegistry = new ActionRegistry();
        syncRegistry.registerEngineAction(engineSyncRequestDefinition);
        const broadcast = vi.fn();
        const context: PipelineContext = { broadcast };
        const p = new ActionPipeline(syncRegistry, { context });
        const snapshot = makeSnapshotWithPlayers(9, [PID]);

        p.process(snapshot, makeEnvelope(9, 'engine:sync_request', {}));

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(snapshot, PID);
    });

    it('calls broadcast once per player when one player is in nextState.players', () => {
        const broadcast = vi.fn();
        const context: PipelineContext = { broadcast };
        const p = new ActionPipeline(registry, { context });

        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        const action = makeEnvelope(0, ADVANCE_TYPE);
        p.process(snapshot, action);

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(expect.any(Object), PID);
    });

    it('calls broadcast once per player when multiple players are in nextState.players', () => {
        const broadcast = vi.fn();
        const context: PipelineContext = { broadcast };
        const p = new ActionPipeline(registry, { context });

        const snapshot = makeSnapshotWithPlayers(0, [PID, PID2, PID3]);
        const action = makeEnvelope(0, ADVANCE_TYPE);
        p.process(snapshot, action);

        expect(broadcast).toHaveBeenCalledTimes(3);
        const calledPlayerIds = broadcast.mock.calls.map((call) => call[1] as PlayerId);
        expect(calledPlayerIds).toContain(PID);
        expect(calledPlayerIds).toContain(PID2);
        expect(calledPlayerIds).toContain(PID3);
    });

    it('does not call broadcast when nextState.players is empty', () => {
        const broadcast = vi.fn();
        const context: PipelineContext = { broadcast };
        const p = new ActionPipeline(registry, { context });

        // makeSnapshot has empty players — advance action still produces new ref
        // but players is empty so the broadcast loop never fires.
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, ADVANCE_TYPE);
        p.process(snapshot, action);

        expect(broadcast).not.toHaveBeenCalled();
    });

    it('passes the next state (BaseGameSnapshot) as the first argument to broadcast', () => {
        const capturedSnapshots: BaseGameSnapshot[] = [];
        const context: PipelineContext = {
            broadcast: (snapshot) => {
                capturedSnapshots.push(snapshot);
            },
        };

        const p = new ActionPipeline(registry, { context });
        const snapshot = makeSnapshotWithPlayers(5, [PID]);
        const action = makeEnvelope(5, ADVANCE_TYPE);
        const nextState = p.process(snapshot, action);

        expect(capturedSnapshots).toHaveLength(1);
        // broadcast receives the full BaseGameSnapshot (next state unchanged).
        // It is the same reference as nextState because no per-viewer projection
        // happens in ActionPipeline; the callback (e.g., StateBroadcaster) is
        // responsible for calling StateProjector.project() to produce PlayerSnapshot.
        expect(capturedSnapshots[0]).toBe(nextState);
        expect((capturedSnapshots[0] as { tick: number }).tick).toBe(6);
    });

    // ── Improvement 1: context also carries db to #buildReduceContext ─────────

    it('constructor accepts context with db without throwing', () => {
        const db = createContentDatabase([]);
        const context: PipelineContext = { db };
        expect(() => new ActionPipeline(registry, { context })).not.toThrow();
    });
});

// ─── Stage 3 — engine:undo / engine:redo interception (F16) ──────────────────

describe('ActionPipeline — Stage 3: engine:undo interception via UndoManager', () => {
    const undoResultSnapshot = makeSnapshot(3);
    const redoResultSnapshot = makeSnapshot(4);

    const makeUndoManagerStub = (options?: {
        undoResult?: BaseGameSnapshot;
        redoResult?: BaseGameSnapshot;
    }): NonNullable<PipelineContext['undoManager']> => ({
        canUndo: vi.fn(() => true),
        canRedo: vi.fn(() => true),
        undo: vi.fn(
            (_playerId: PlayerId, _steps?: number) => options?.undoResult ?? undoResultSnapshot,
        ),
        redo: vi.fn(
            (_playerId: PlayerId, _steps?: number) => options?.redoResult ?? redoResultSnapshot,
        ),
        clearUndoHistory: vi.fn(),
        saveTurnMemento: vi.fn(),
    });

    beforeEach(() => {
        registry.registerEngineAction(engineUndoDefinition);
        registry.registerEngineAction(engineRedoDefinition);
    });

    it('returns the snapshot from undoManager.undo() when action type is engine:undo', () => {
        const expectedState = makeSnapshot(2);
        const undoManager = makeUndoManagerStub({ undoResult: expectedState });
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:undo');
        const result = p.process(snapshot, action);

        expect(result).toBe(expectedState);
    });

    it('calls undoManager.undo() with the action playerId and parsed steps', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action: ActionEnvelope = {
            type: 'engine:undo',
            playerId: PID,
            tick: 0,
            payload: { steps: 2 },
        };
        p.process(snapshot, action);

        expect(undoManager.undo).toHaveBeenCalledWith(PID, 2);
    });

    it('calls undoManager.undo() with steps=1 when payload has no steps field', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action: ActionEnvelope = {
            type: 'engine:undo',
            playerId: PID,
            tick: 0,
            payload: {},
        };
        p.process(snapshot, action);

        expect(undoManager.undo).toHaveBeenCalledWith(PID, 1);
    });

    it('does NOT call validate() or reduce() when engine:undo is intercepted at Stage 3', () => {
        const validateSpy = vi.fn(() => ({ ok: true as const }));
        const reduceSpy = vi.fn((state: Readonly<BaseGameSnapshot>) => state);
        const spyUndoDef: ActionDefinition<{ readonly steps: number }> = {
            type: 'engine:undo',
            parsePayload: (raw) => engineUndoDefinition.parsePayload(raw),
            validate: validateSpy,
            reduce: reduceSpy,
        };
        const spyRegistry = new ActionRegistry();
        spyRegistry.registerEngineAction(spyUndoDef);

        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(spyRegistry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:undo');
        p.process(snapshot, action);

        expect(validateSpy).not.toHaveBeenCalled();
        expect(reduceSpy).not.toHaveBeenCalled();
    });

    it('appends the undo ActionEnvelope to history with tickApplied = snapshot.tick', () => {
        const appendSpy = vi.fn();
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, {
            context: { undoManager, history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        const snapshot = makeSnapshot(5);
        const action = makeEnvelope(5, 'engine:undo');
        p.process(snapshot, action);

        expect(appendSpy).toHaveBeenCalledOnce();
        const entry = appendSpy.mock.calls[0]![0];
        expect(entry.tickApplied).toBe(5);
        expect(entry.action).toBe(action);
    });

    it('appends the undo ActionEnvelope to history with turnNumber = snapshot.turnNumber (NOT snapshot.tick)', () => {
        const appendSpy = vi.fn();
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, {
            context: { undoManager, history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        // Distinct tick (5) and turnNumber (2).
        const snapshot = makeSnapshot(5, 2);
        const action = makeEnvelope(5, 'engine:undo');
        p.process(snapshot, action);

        expect(appendSpy.mock.calls[0]![0].turnNumber).toBe(2);
    });

    it('broadcasts the reconstructed snapshot to all players when it differs from input', () => {
        const reconstructed: BaseGameSnapshot = {
            tick: 3,
            seed: 1,
            players: { [PID]: { id: PID } },
            entities: {},
            phase: 'test' as BaseGameSnapshot['phase'],
            events: [],
            turnNumber: 0,
            timers: {},
            gameResult: null,
        };
        const undoManager = makeUndoManagerStub({ undoResult: reconstructed });
        const broadcastSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { undoManager, broadcast: broadcastSpy },
        });

        const snapshot = makeSnapshot(5); // different reference from reconstructed
        const action = makeEnvelope(5, 'engine:undo');
        p.process(snapshot, action);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        expect(broadcastSpy).toHaveBeenCalledWith(expect.any(Object), PID);
    });

    it('does NOT broadcast when reconstructed snapshot is the same reference as input', () => {
        const snapshot = makeSnapshot(5);
        const undoManager = makeUndoManagerStub({ undoResult: snapshot });
        const broadcastSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { undoManager, broadcast: broadcastSpy },
        });

        const action = makeEnvelope(5, 'engine:undo');
        p.process(snapshot, action);

        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('falls through to Stage 4 when context.undoManager is absent', () => {
        const p = new ActionPipeline(registry, { context: {} });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:undo');
        // engineUndoDefinition.validate checks canUndo via ctx.undoManager — absent so ok: true
        // engineUndoDefinition.reduce returns snapshot unchanged
        const result = p.process(snapshot, action);

        expect(result).toBe(snapshot);
    });

    it('falls through to Stage 4 when no context is provided at all', () => {
        const p = new ActionPipeline(registry);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:undo');
        const result = p.process(snapshot, action);

        expect(result).toBe(snapshot);
    });

    it('returns the snapshot from undoManager.redo() when action type is engine:redo', () => {
        const expectedState = makeSnapshot(7);
        const undoManager = makeUndoManagerStub({ redoResult: expectedState });
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:redo');
        const result = p.process(snapshot, action);

        expect(result).toBe(expectedState);
    });

    it('calls undoManager.redo() with the action playerId and parsed steps', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action: ActionEnvelope = {
            type: 'engine:redo',
            playerId: PID,
            tick: 0,
            payload: { steps: 3 },
        };
        p.process(snapshot, action);

        expect(undoManager.redo).toHaveBeenCalledWith(PID, 3);
    });

    it('does NOT call validate() or reduce() when engine:redo is intercepted at Stage 3', () => {
        const validateSpy = vi.fn(() => ({ ok: true as const }));
        const reduceSpy = vi.fn((state: Readonly<BaseGameSnapshot>) => state);
        const spyRedoDef: ActionDefinition<{ readonly steps: number }> = {
            type: 'engine:redo',
            parsePayload: (raw) => engineRedoDefinition.parsePayload(raw),
            validate: validateSpy,
            reduce: reduceSpy,
        };
        const spyRegistry = new ActionRegistry();
        spyRegistry.registerEngineAction(spyRedoDef);

        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(spyRegistry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'engine:redo');
        p.process(snapshot, action);

        expect(validateSpy).not.toHaveBeenCalled();
        expect(reduceSpy).not.toHaveBeenCalled();
    });

    it('appends the redo ActionEnvelope to history with tickApplied = snapshot.tick', () => {
        const appendSpy = vi.fn();
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, {
            context: { undoManager, history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        const snapshot = makeSnapshot(7);
        const action = makeEnvelope(7, 'engine:redo');
        p.process(snapshot, action);

        expect(appendSpy).toHaveBeenCalledOnce();
        const entry = appendSpy.mock.calls[0]![0];
        expect(entry.tickApplied).toBe(7);
        expect(entry.action).toBe(action);
    });
});

// ─── Stage 6 — history record for normal actions (F16) ───────────────────────

describe('ActionPipeline — Stage 6: history record for normal actions', () => {
    it('appends the ActionEnvelope to history after reducing a normal action', () => {
        const appendSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        p.process(snapshot, action);

        expect(appendSpy).toHaveBeenCalledOnce();
    });

    it('passes tickApplied equal to snapshot.tick to history.append', () => {
        const appendSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        const snapshot = makeSnapshot(9);
        const action = makeEnvelope(9);
        p.process(snapshot, action);

        expect(appendSpy.mock.calls[0]![0].tickApplied).toBe(9);
    });

    // WARN-2 (review): turnNumber on the history entry must be sourced from
    // BaseGameSnapshot.turnNumber, not from snapshot.tick. tick measures
    // simulation steps; turnNumber measures turns. Using tick as a proxy
    // collapsed prune semantics for games whose tick != turnNumber.
    it('passes turnNumber equal to snapshot.turnNumber (NOT snapshot.tick) to history.append', () => {
        const appendSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        // Distinct tick (9) and turnNumber (3) — proves which field is read.
        const snapshot = makeSnapshot(9, 3);
        const action = makeEnvelope(9);
        p.process(snapshot, action);

        expect(appendSpy.mock.calls[0]![0].turnNumber).toBe(3);
    });

    it('passes the original ActionEnvelope to history.append', () => {
        const appendSpy = vi.fn();
        const p = new ActionPipeline(registry, {
            context: { history: { append: appendSpy, pruneTo: vi.fn() } },
        });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        p.process(snapshot, action);

        expect(appendSpy.mock.calls[0]![0].action).toBe(action);
    });

    it('silently skips history record when context.history is absent', () => {
        const p = new ActionPipeline(registry, { context: {} });

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        expect(() => p.process(snapshot, action)).not.toThrow();
    });

    it('silently skips history record when no context is provided', () => {
        const p = new ActionPipeline(registry);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0);
        expect(() => p.process(snapshot, action)).not.toThrow();
    });
});

// ─── Stage 7 — undoMeta injection into broadcast snapshots (issue #361) ───────

// ─── Post-Stage-5 — turn lifecycle: engine:end_turn clears undo history ──────

describe('ActionPipeline — engine:end_turn clears undoManager history (post-Stage-5 hook)', () => {
    /**
     * After a successful reduce of `engine:end_turn`, the pipeline must call
     * `undoManager.clearUndoHistory(action.playerId)` so the
     * `crossTurnUndo: false` policy default holds in production. Without this
     * hook the undo subsystem accumulates per-player state forever even if a
     * host is wired up correctly otherwise.
     *
     * We register a minimal `engine:end_turn` stub here (no `turnClock`
     * coupling) — the real `engineEndTurnDefinition` is exercised in
     * EngineActions.test.ts. This isolates the hook contract from the reducer.
     */
    const END_TURN: ActionDefinition<Record<string, never>> = {
        type: 'engine:end_turn',
        parsePayload: () => ({}),
        validate: () => ({ ok: true }),
        // Return a new reference so Stage 7 broadcast fires (parity with real reducer).
        reduce: (state) => ({ ...state }),
    };

    const makeUndoManagerStub = (): NonNullable<PipelineContext['undoManager']> => ({
        canUndo: vi.fn(() => false),
        canRedo: vi.fn(() => false),
        undo: vi.fn(),
        redo: vi.fn(),
        clearUndoHistory: vi.fn(),
        saveTurnMemento: vi.fn(),
    });

    beforeEach(() => {
        registry.registerEngineAction(END_TURN);
    });

    it('calls undoManager.clearUndoHistory(playerId) after engine:end_turn reduces', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        p.process(snapshot, makeEnvelope(0, 'engine:end_turn'));

        expect(undoManager.clearUndoHistory).toHaveBeenCalledExactlyOnceWith(PID);
    });

    it('does NOT call clearUndoHistory for actions other than engine:end_turn', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        p.process(snapshot, makeEnvelope(0, 'game:noop'));

        expect(undoManager.clearUndoHistory).not.toHaveBeenCalled();
    });

    it('does not throw when undoManager is absent and engine:end_turn is processed', () => {
        const p = new ActionPipeline(registry, { context: {} });

        const snapshot = makeSnapshot(0);
        expect(() => p.process(snapshot, makeEnvelope(0, 'engine:end_turn'))).not.toThrow();
    });

    it('clears undo history BEFORE Stage 7 broadcast so the broadcast undoMeta reflects post-clear state', () => {
        // Capture the order: clearUndoHistory must happen before broadcast so that
        // the broadcast snapshot carries post-clear (always false/false) undoMeta,
        // preventing stale turn-end undo eligibility from leaking to the UI.
        const callOrder: string[] = [];
        const undoManager: NonNullable<PipelineContext['undoManager']> = {
            canUndo: vi.fn(() => true),
            canRedo: vi.fn(() => false),
            undo: vi.fn(),
            redo: vi.fn(),
            clearUndoHistory: vi.fn(() => {
                callOrder.push('clearUndoHistory');
            }),
            saveTurnMemento: vi.fn(),
        };
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: () => {
                    callOrder.push('broadcast');
                },
            },
        });

        const snapshot: BaseGameSnapshot = {
            ...makeSnapshot(0),
            players: { [PID]: { id: PID } },
        };
        p.process(snapshot, makeEnvelope(0, 'engine:end_turn'));

        expect(callOrder).toEqual(['clearUndoHistory', 'broadcast']);
    });

    it('calls history.pruneTo(nextState.turnNumber - TURN_MEMENTO_RETENTION) after engine:end_turn so action history stays bounded', () => {
        const pruneSpy = vi.fn();
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                history: { append: vi.fn(), pruneTo: pruneSpy },
            },
        });

        // The local END_TURN stub returns `{...state}` (turnNumber unchanged),
        // so cutoff = nextState.turnNumber - TURN_MEMENTO_RETENTION
        //          = 9 - 4
        //          = 5.
        // Using a non-zero turnNumber proves the pipeline reads turnNumber
        // and not snapshot.tick (WARN-2 from F16 review).
        const snapshot = makeSnapshot(7, 9);
        p.process(snapshot, makeEnvelope(7, 'engine:end_turn'));

        expect(pruneSpy).toHaveBeenCalledExactlyOnceWith(9 - 4);
    });

    // I1 from code review of eca8acb: the prior test uses a local END_TURN stub
    // that does NOT increment turnNumber, so it cannot distinguish between reading
    // snapshot.turnNumber vs nextState.turnNumber. This test uses the real
    // engineEndTurnDefinition with a turnClock so turnNumber actually advances,
    // proving pruneTo receives the POST-reduce value.
    it('pruneTo cutoff uses the POST-reduce turnNumber when turnClock advances (real engineEndTurnDefinition)', () => {
        const pruneSpy = vi.fn();
        const realRegistry = new ActionRegistry();
        realRegistry.registerEngineAction(engineEndTurnDefinition);

        const PID2 = toPlayerId('p2');
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(realRegistry, {
            context: {
                undoManager,
                history: { append: vi.fn(), pruneTo: pruneSpy },
            },
        });

        // turnNumber starts at 9. After engine:end_turn.reduce, it becomes 10.
        // So pruneTo must be called with 10 - TURN_MEMENTO_RETENTION (= 4) = 6,
        // NOT 9 - 4 = 5 (which would be the wrong pre-reduce value).
        const snapshot: BaseGameSnapshot = {
            ...makeSnapshot(0, 9),
            players: { [PID]: { id: PID }, [PID2]: { id: PID2 } },
            turnClock: { activePlayerId: PID, deadlineMs: 30_000 },
        };
        p.process(snapshot, makeEnvelope(0, 'engine:end_turn'));

        expect(pruneSpy).toHaveBeenCalledExactlyOnceWith(10 - 4);
    });

    it('does NOT call pruneTo when history is absent', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0);
        expect(() => p.process(snapshot, makeEnvelope(0, 'engine:end_turn'))).not.toThrow();
    });

    it('saves a turn memento for the new active player when state.turnClock advances', () => {
        // Use the real engine:end_turn definition so turnClock advances correctly.
        const realRegistry = new ActionRegistry();
        realRegistry.registerEngineAction(engineEndTurnDefinition);

        const PID2 = toPlayerId('p2');
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(realRegistry, { context: { undoManager } });

        const snapshot: BaseGameSnapshot = {
            ...makeSnapshot(0),
            players: { [PID]: { id: PID }, [PID2]: { id: PID2 } },
            turnClock: { activePlayerId: PID, deadlineMs: 30_000 },
        };
        p.process(snapshot, makeEnvelope(0, 'engine:end_turn'));

        // Memento captures the post-end_turn snapshot for the new active player (p2).
        expect(undoManager.saveTurnMemento).toHaveBeenCalledOnce();
        const [savedState, savedPid] = (
            undoManager.saveTurnMemento as unknown as {
                mock: { calls: [BaseGameSnapshot, PlayerId][] };
            }
        ).mock.calls[0]!;
        expect(savedPid).toBe(PID2);
        expect(savedState.turnClock?.activePlayerId).toBe(PID2);
    });

    it('does NOT call saveTurnMemento when state.turnClock is absent (no active-player concept)', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, { context: { undoManager } });

        const snapshot = makeSnapshot(0); // no turnClock
        p.process(snapshot, makeEnvelope(0, 'engine:end_turn'));

        expect(undoManager.saveTurnMemento).not.toHaveBeenCalled();
    });
});

// ─── Issue #36 — hoist dispatch closure; reuse ReduceContext per pipeline ────

describe('ActionPipeline — issue #36: hoist dispatch closure and reuse ReduceContext', () => {
    /**
     * Acceptance criteria from issue #36:
     *   1. No new `dispatch` closure is created per `process()` call.
     *   2. No new `ReduceContext` object is created per `process()` call.
     *   3. ctx.rng is correctly re-seeded before each call (correctness guard).
     *   4. validate() and reduce() receive the same ctx within one call.
     */

    it('ctx.dispatch is the same function reference on every process() call (no new closure per call)', () => {
        const capturedDispatches: NonNullable<ReduceContext['dispatch']>[] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:capture-dispatch-36',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) capturedDispatches.push(ctx.dispatch);
                return state;
            },
        };
        const r = new ActionRegistry();
        r.register(spyDef);
        const p = new ActionPipeline(r);

        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-dispatch-36'));
        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-dispatch-36'));

        expect(capturedDispatches).toHaveLength(2);
        expect(capturedDispatches[0]).toBe(capturedDispatches[1]);
    });

    it('the ReduceContext object passed to reduce() is the same instance on every process() call (no new object per call)', () => {
        const capturedCtxs: GameReduceContext[] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:capture-ctx-36',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedCtxs.push(ctx);
                return state;
            },
        };
        const r = new ActionRegistry();
        r.register(spyDef);
        const p = new ActionPipeline(r);

        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-ctx-36'));
        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-ctx-36'));

        expect(capturedCtxs).toHaveLength(2);
        expect(capturedCtxs[0]).toBe(capturedCtxs[1]);
    });

    it('validate() and reduce() receive the same ctx object within a single process() call', () => {
        const capturedFromValidate: GameReduceContext[] = [];
        const capturedFromReduce: GameReduceContext[] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:capture-ctx-val-red-36',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                capturedFromValidate.push(ctx);
                return { ok: true };
            },
            reduce: (state, _payload, _playerId, ctx) => {
                capturedFromReduce.push(ctx);
                return state;
            },
        };
        const r = new ActionRegistry();
        r.register(spyDef);
        const p = new ActionPipeline(r);

        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-ctx-val-red-36'));

        expect(capturedFromValidate).toHaveLength(1);
        expect(capturedFromReduce).toHaveLength(1);
        expect(capturedFromValidate[0]).toBe(capturedFromReduce[0]);
    });

    it('ctx.rng is correctly re-seeded for each process() call even when context is reused (correctness guard)', () => {
        const capturedFirstFloats: number[] = [];
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:capture-rng-36',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedFirstFloats.push(ctx.rng.float());
                return state;
            },
        };
        const r = new ActionRegistry();
        r.register(spyDef);
        const p = new ActionPipeline(r);

        // Same seed, different ticks → different rng initialisation → different first float
        p.process(makeSnapshot(0), makeEnvelope(0, 'game:capture-rng-36'));
        p.process(makeSnapshot(1), makeEnvelope(1, 'game:capture-rng-36'));

        expect(capturedFirstFloats).toHaveLength(2);
        // (seed=1, tick=0) vs (seed=1, tick=1) must produce different initial draws
        expect(capturedFirstFloats[0]).not.toBe(capturedFirstFloats[1]);
    });

    it('ctx.dispatch in the reused context is still functional for engine:tick (re-entrant dispatch still throws RecursiveDispatchError)', () => {
        // engine:tick is the only action that may call ctx.dispatch (§4.20, invariant #89).
        const recursiveTickDef: ActionDefinition<{ seed: number }> = {
            type: 'engine:tick',
            parsePayload: (raw) => ({ seed: raw['seed'] as number }),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'engine:tick',
                        playerId: PID,
                        tick: state.tick,
                        payload: { seed: 0 },
                    });
                }
                return state;
            },
        };
        const r = new ActionRegistry();
        r.registerEngineAction(recursiveTickDef);
        const p = new ActionPipeline(r);

        expect(() =>
            p.process(makeSnapshot(0), makeEnvelope(0, 'engine:tick', { seed: 0 })),
        ).toThrow(RecursiveDispatchError);
    });
});

// ─── ctx.dispatchDepth ────────────────────────────────────────────────────────

describe('ActionPipeline — ctx.dispatchDepth in ReduceContext', () => {
    it('ctx.dispatchDepth is 0 at the top-level process() call', () => {
        let capturedDepth: number | undefined;
        const depthSpyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:depth_spy',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedDepth = ctx.dispatchDepth;
                return state;
            },
        };
        registry.register(depthSpyDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:depth_spy'));
        expect(capturedDepth).toBe(0);
    });

    it('ctx.dispatchDepth increments with each level of re-entrant dispatch', () => {
        const depths: number[] = [];
        // engine:tick is the only action that may call ctx.dispatch() (§4.20, invariant #89).
        const depthRecorderDef: ActionDefinition<{ seed: number }> = {
            type: 'engine:tick',
            parsePayload: (raw) => ({ seed: raw['seed'] as number }),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                depths.push(ctx.dispatchDepth);
                if (ctx.dispatchDepth < 2 && isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'engine:tick',
                        playerId: PID,
                        tick: state.tick,
                        payload: { seed: 0 },
                    });
                }
                return state;
            },
        };
        const r = new ActionRegistry();
        r.registerEngineAction(depthRecorderDef);
        const p = new ActionPipeline(r);
        p.process(makeSnapshot(0), makeEnvelope(0, 'engine:tick', { seed: 0 }));
        expect(depths).toEqual([0, 1, 2]);
    });

    it('ctx.dispatchDepth resets to 0 after the outer process() call completes', () => {
        const capturedDepths: number[] = [];
        const resetCheckDef: ActionDefinition<Record<string, never>> = {
            type: 'game:reset_check',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                capturedDepths.push(ctx.dispatchDepth);
                return state;
            },
        };
        registry.register(resetCheckDef);
        // First top-level call
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:reset_check'));
        // Second top-level call — depth must reset to 0, not carry over from the first
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:reset_check'));
        expect(capturedDepths).toEqual([0, 0]);
    });

    it('ctx.dispatchDepth is accessible in validate() as well as reduce()', () => {
        let capturedValidateDepth: number | undefined;
        const validateDepthDef: ActionDefinition<Record<string, never>> = {
            type: 'game:validate_depth',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                capturedValidateDepth = ctx.dispatchDepth;
                return { ok: true };
            },
            reduce: (state) => state,
        };
        registry.register(validateDepthDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:validate_depth'));
        expect(capturedValidateDepth).toBe(0);
    });
});
