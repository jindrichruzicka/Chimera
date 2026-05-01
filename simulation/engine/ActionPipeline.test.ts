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
import { createContentDatabase } from '../content/index.js';
import {
    engineUndoDefinition,
    engineRedoDefinition,
    engineEndTurnDefinition,
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
    it('throws RecursiveDispatchError when nesting depth exceeds MAX_NESTED_DISPATCH', () => {
        // A reducer that immediately re-dispatches the same action via ctx.dispatch.
        // This creates unlimited recursion unless the depth guard fires.
        const recursiveDef: ActionDefinition<Record<string, never>> = {
            type: 'game:recursive',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'game:recursive',
                        playerId: PID,
                        tick: state.tick,
                        payload: {},
                    });
                }
                return state;
            },
        };
        registry.register(recursiveDef);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:recursive');
        expect(() => pipeline.process(snapshot, action)).toThrow(RecursiveDispatchError);
    });

    it('allows exactly MAX_NESTED_DISPATCH levels of re-entrant dispatch', () => {
        let callCount = 0;

        // A reducer that dispatches a second (non-recursive) action.
        const counterDef: ActionDefinition<Record<string, never>> = {
            type: 'game:counter',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                callCount++;
                if (callCount <= MAX_NESTED_DISPATCH && isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'game:counter',
                        playerId: PID,
                        tick: state.tick,
                        payload: {},
                    });
                }
                return state;
            },
        };
        registry.register(counterDef);

        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:counter');
        // Exactly MAX_NESTED_DISPATCH dispatches — should not throw.
        expect(() => pipeline.process(snapshot, action)).not.toThrow(RecursiveDispatchError);
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
            { collectionType: 'damage-types', items: [{ id: 'fire', name: 'Fire' }] },
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
            { collectionType: 'damage-types', items: [{ id: 'fire', name: 'Fire' }] },
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
            { collectionType: 'damage-types', items: [{ id: 'fire', name: 'Fire' }] },
        ]);
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:query-db',
            parsePayload: () => ({}),
            validate: (_payload, _state, _playerId, ctx) => {
                if (ctx.db?.has('damage-types', 'fire')) {
                    return { ok: true };
                }
                return { ok: false, reason: 'no_fire' };
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

    it('passes the next state (as opaque ViewerSnapshot) as the first argument to broadcast', () => {
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        const context: PipelineContext = {
            broadcast: (snapshot) => {
                capturedSnapshots.push(snapshot);
            },
        };

        const p = new ActionPipeline(registry, { context });
        const snapshot = makeSnapshotWithPlayers(5, [PID]);
        const action = makeEnvelope(5, ADVANCE_TYPE);
        p.process(snapshot, action);

        expect(capturedSnapshots).toHaveLength(1);
        // The broadcast receives the next state (tick incremented to 6), plus
        // injected undoMeta. It is a distinct object (not the same reference as
        // next) because Stage 7 spreads the snapshot to attach per-viewer undoMeta.
        expect((capturedSnapshots[0] as { tick: number }).tick).toBe(6);
        expect((capturedSnapshots[0] as { undoMeta: unknown }).undoMeta).toEqual({
            canUndo: false,
            canRedo: false,
        });
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

describe('ActionPipeline — Stage 7: undoMeta injected into broadcast snapshots', () => {
    const PID2 = toPlayerId('p2');

    const ADVANCE_TYPE = 'game:advance-undo-meta';
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
    });

    const makeUndoManagerStub = (options?: {
        canUndo?: (pid: PlayerId) => boolean;
        canRedo?: (pid: PlayerId) => boolean;
        undoResult?: BaseGameSnapshot;
        redoResult?: BaseGameSnapshot;
    }): NonNullable<PipelineContext['undoManager']> => ({
        canUndo: vi.fn((pid: PlayerId) => options?.canUndo?.(pid) ?? false),
        canRedo: vi.fn((pid: PlayerId) => options?.canRedo?.(pid) ?? false),
        undo: vi.fn(
            (_playerId: PlayerId, _steps?: number) =>
                options?.undoResult ?? makeSnapshotWithPlayers(3, [PID]),
        ),
        redo: vi.fn(
            (_playerId: PlayerId, _steps?: number) =>
                options?.redoResult ?? makeSnapshotWithPlayers(4, [PID]),
        ),
        clearUndoHistory: vi.fn(),
        saveTurnMemento: vi.fn(),
    });

    beforeEach(() => {
        if (!registry.has(ADVANCE_TYPE)) {
            registry.register(advanceDef);
        }
        if (!registry.has('engine:undo')) {
            registry.registerEngineAction(engineUndoDefinition);
        }
        if (!registry.has('engine:redo')) {
            registry.registerEngineAction(engineRedoDefinition);
        }
    });

    // ── Normal action — undoMeta derived per viewer ───────────────────────────

    it('broadcast snapshot contains undoMeta with canUndo=false, canRedo=false when undoManager is absent', () => {
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        const p = new ActionPipeline(registry, {
            context: {
                broadcast: (snap) => {
                    capturedSnapshots.push(snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        p.process(snapshot, makeEnvelope(0, ADVANCE_TYPE));

        expect(capturedSnapshots).toHaveLength(1);
        const undoMeta = (capturedSnapshots[0] as { undoMeta: unknown }).undoMeta;
        expect(undoMeta).toEqual({ canUndo: false, canRedo: false });
    });

    it('broadcast snapshot contains undoMeta reflecting undoManager.canUndo/canRedo for that viewer', () => {
        const capturedByPlayer = new Map<PlayerId, Readonly<Record<string, unknown>>>();
        const undoManager = makeUndoManagerStub({
            canUndo: (pid) => pid === PID,
            canRedo: (pid) => pid === PID2,
        });
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: (snap, to) => {
                    capturedByPlayer.set(to, snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID, PID2]);
        p.process(snapshot, makeEnvelope(0, ADVANCE_TYPE));

        const p1snap = capturedByPlayer.get(PID) as {
            undoMeta: { canUndo: boolean; canRedo: boolean };
        };
        const p2snap = capturedByPlayer.get(PID2) as {
            undoMeta: { canUndo: boolean; canRedo: boolean };
        };

        expect(p1snap.undoMeta).toEqual({ canUndo: true, canRedo: false });
        expect(p2snap.undoMeta).toEqual({ canUndo: false, canRedo: true });
    });

    it('calls undoManager.canUndo and canRedo with the viewer PlayerId for each viewer', () => {
        const undoManager = makeUndoManagerStub();
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: vi.fn(),
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID, PID2]);
        p.process(snapshot, makeEnvelope(0, ADVANCE_TYPE));

        expect(undoManager.canUndo).toHaveBeenCalledWith(PID);
        expect(undoManager.canUndo).toHaveBeenCalledWith(PID2);
        expect(undoManager.canRedo).toHaveBeenCalledWith(PID);
        expect(undoManager.canRedo).toHaveBeenCalledWith(PID2);
    });

    it('each viewer receives a distinct broadcast call (undoMeta is per-viewer, not shared)', () => {
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        const undoManager = makeUndoManagerStub({
            canUndo: (pid) => pid === PID,
            canRedo: () => false,
        });
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: (snap) => {
                    capturedSnapshots.push(snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID, PID2]);
        p.process(snapshot, makeEnvelope(0, ADVANCE_TYPE));

        expect(capturedSnapshots).toHaveLength(2);
        const p1 = capturedSnapshots.find(
            (s) => (s as { undoMeta: { canUndo: boolean } }).undoMeta?.canUndo === true,
        );
        const p2 = capturedSnapshots.find(
            (s) => (s as { undoMeta: { canUndo: boolean } }).undoMeta?.canUndo === false,
        );
        expect(p1).toBeDefined();
        expect(p2).toBeDefined();
    });

    // ── Stage 3 undo/redo short-circuit — undoMeta also injected ─────────────

    it('broadcast snapshot after engine:undo contains undoMeta reflecting updated canUndo/canRedo', () => {
        const reconstructed = makeSnapshotWithPlayers(3, [PID]);
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        // After undo, canRedo becomes true and canUndo is false
        const undoManager = makeUndoManagerStub({
            undoResult: reconstructed,
            canUndo: () => false,
            canRedo: () => true,
        });
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: (snap) => {
                    capturedSnapshots.push(snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        p.process(snapshot, makeEnvelope(0, 'engine:undo'));

        expect(capturedSnapshots).toHaveLength(1);
        const undoMeta = (capturedSnapshots[0] as { undoMeta: unknown }).undoMeta;
        expect(undoMeta).toEqual({ canUndo: false, canRedo: true });
    });

    it('broadcast snapshot after engine:redo contains undoMeta reflecting updated canUndo/canRedo', () => {
        const reconstructed = makeSnapshotWithPlayers(4, [PID]);
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        const undoManager = makeUndoManagerStub({
            redoResult: reconstructed,
            canUndo: () => true,
            canRedo: () => false,
        });
        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                broadcast: (snap) => {
                    capturedSnapshots.push(snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        p.process(snapshot, makeEnvelope(0, 'engine:redo'));

        expect(capturedSnapshots).toHaveLength(1);
        const undoMeta = (capturedSnapshots[0] as { undoMeta: unknown }).undoMeta;
        expect(undoMeta).toEqual({ canUndo: true, canRedo: false });
    });

    it('broadcast snapshot after undo short-circuit contains undoMeta = false/false when undoManager absent (impossible path — guard)', () => {
        // When undoManager is absent, Stage 3 short-circuit never fires.
        // This test verifies normal action flow still yields undoMeta false/false without undoManager.
        const capturedSnapshots: Readonly<Record<string, unknown>>[] = [];
        const p = new ActionPipeline(registry, {
            context: {
                broadcast: (snap) => {
                    capturedSnapshots.push(snap);
                },
            },
        });

        const snapshot = makeSnapshotWithPlayers(0, [PID]);
        p.process(snapshot, makeEnvelope(0, ADVANCE_TYPE));

        expect(capturedSnapshots).toHaveLength(1);
        const undoMeta = (capturedSnapshots[0] as { undoMeta: unknown }).undoMeta;
        expect(undoMeta).toEqual({ canUndo: false, canRedo: false });
    });
});

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

    it('clears undo history AFTER Stage 7 broadcast so the broadcast undoMeta still reflects pre-clear state', () => {
        // Capture the order: broadcast must happen before clearUndoHistory; otherwise
        // the broadcast snapshot would carry post-clear (always false/false) undoMeta
        // even though the player still had a valid pre-end-turn history.
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

        expect(callOrder).toEqual(['broadcast', 'clearUndoHistory']);
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

    it('ctx.dispatch in the reused context is still functional (re-entrant dispatch still throws RecursiveDispatchError)', () => {
        const recursiveDef: ActionDefinition<Record<string, never>> = {
            type: 'game:recursive-36',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                if (isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'game:recursive-36',
                        playerId: PID,
                        tick: state.tick,
                        payload: {},
                    });
                }
                return state;
            },
        };
        const r = new ActionRegistry();
        r.register(recursiveDef);
        const p = new ActionPipeline(r);

        expect(() => p.process(makeSnapshot(0), makeEnvelope(0, 'game:recursive-36'))).toThrow(
            RecursiveDispatchError,
        );
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
        // test-only: this fixture exercises ctx.dispatch() to verify depth counting.
        // Only engine:tick may call ctx.dispatch() in production (§4.20, invariant #89).
        const depthRecorderDef: ActionDefinition<Record<string, never>> = {
            type: 'game:depth_recorder',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state, _payload, _playerId, ctx) => {
                depths.push(ctx.dispatchDepth);
                if (ctx.dispatchDepth < 2 && isReduceContext(ctx) && ctx.dispatch) {
                    return ctx.dispatch(state, {
                        type: 'game:depth_recorder',
                        playerId: PID,
                        tick: state.tick,
                        payload: {},
                    });
                }
                return state;
            },
        };
        registry.register(depthRecorderDef);
        pipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:depth_recorder'));
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
