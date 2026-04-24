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
} from './types.js';
import { playerId as toPlayerId } from './types.js';
import { createContentDatabase } from '../content/index.js';

// ─── Test fixtures ─────────────────────────────────────────────────────

const PID = toPlayerId('p1');

const makeSnapshot = (tick = 0): BaseGameSnapshot => ({
    tick,
    seed: 1,
    players: {},
    entities: {},
    phase: 'test' as BaseGameSnapshot['phase'],
    events: [],
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
                if (ctx.dispatch) {
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
                if (callCount <= MAX_NESTED_DISPATCH && ctx.dispatch) {
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
        const dbPipeline = new ActionPipeline(dbRegistry, { db });
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
        const dbPipeline = new ActionPipeline(dbRegistry, { db });
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
        const dbPipeline = new ActionPipeline(dbRegistry, { db });
        expect(() =>
            dbPipeline.process(makeSnapshot(0), makeEnvelope(0, 'game:query-db')),
        ).not.toThrow();
    });
});
