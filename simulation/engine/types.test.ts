/**
 * Type-level tests for simulation/engine/types.ts
 *
 * These tests verify that all declared interfaces and types:
 *   1. Exist and are importable
 *   2. Have the correct structural shapes (assignability)
 *   3. Enforce required/optional constraints
 *   4. Compile under strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
 *
 * Written first (red) per TDD mandate — simulation/engine/types.ts does not exist yet.
 */

import { describe, it, expect } from 'vitest';
import { makeStubRng } from './__test-support__/stubs.js';
import { playerId as toPlayerId, toViewerSnapshot } from './types.js';

import type {
    EntityId,
    GamePhase,
    BasePlayerState,
    BaseEntityState,
    GameEvent,
    BaseGameSnapshot,
    EngineAction,
    TypedAction,
    ActionEnvelope,
    ActionDefinition,
    ValidationResult,
    ContentDatabase,
    ReduceContext,
    GameReduceContext,
    SimulationHostRole,
    SimulationClientRole,
    UndoContext,
    HistoryContext,
    BroadcastContext,
    DebugContext,
    PipelineContext,
    ViewerSnapshot,
} from './types.js';
import { isReduceContext } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntityId(raw: string): EntityId {
    return raw as EntityId;
}

// ─── PlayerId / EntityId ─────────────────────────────────────────────────────

describe('PlayerId and EntityId', () => {
    it('are string-compatible branded types', () => {
        const pid = toPlayerId('player-1');
        const eid = makeEntityId('entity-42');
        expect(typeof pid).toBe('string');
        expect(typeof eid).toBe('string');
    });

    it('type: PlayerId is assignable to string', () => {
        const pid = toPlayerId('p1');
        const s: string = pid;
        expect(s).toBe('p1');
    });

    it('type: EntityId is assignable to string', () => {
        const eid = makeEntityId('e1');
        const s: string = eid;
        expect(s).toBe('e1');
    });
});

// ─── BasePlayerState ─────────────────────────────────────────────────────────

describe('BasePlayerState', () => {
    it('has a required id field of type PlayerId', () => {
        const state: BasePlayerState = { id: toPlayerId('p1') };
        expect(state.id).toBe('p1');
    });
});

// ─── BaseEntityState ─────────────────────────────────────────────────────────

describe('BaseEntityState', () => {
    it('has a required id field of type EntityId', () => {
        const state: BaseEntityState = { id: makeEntityId('e1') };
        expect(state.id).toBe('e1');
    });
});

// ─── GameEvent ───────────────────────────────────────────────────────────────

describe('GameEvent', () => {
    it('has a required type field', () => {
        const event: GameEvent = { type: 'unit_moved' };
        expect(event.type).toBe('unit_moved');
    });
});

// ─── BaseGameSnapshot ────────────────────────────────────────────────────────

describe('BaseGameSnapshot', () => {
    it('can be constructed with all required fields', () => {
        const snapshot: BaseGameSnapshot = {
            tick: 0,
            seed: 12345,
            players: {},
            entities: {},
            phase: 'setup' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        expect(snapshot.tick).toBe(0);
        expect(snapshot.seed).toBe(12345);
    });

    it('has an optional turnClock field', () => {
        const pid = toPlayerId('p1');
        const snapshot: BaseGameSnapshot = {
            tick: 5,
            seed: 99,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
            turnClock: { activePlayerId: pid, deadlineMs: 30_000 },
        };
        expect(snapshot.turnClock?.activePlayerId).toBe('p1');
    });

    it('can be constructed without turnClock', () => {
        const snapshot: BaseGameSnapshot = {
            tick: 1,
            seed: 7,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        expect(snapshot.turnClock).toBeUndefined();
    });
});

// ─── EngineAction ────────────────────────────────────────────────────────────

describe('EngineAction', () => {
    it('includes type, playerId, tick, and payload', () => {
        const action: EngineAction = {
            type: 'engine:end_turn',
            playerId: toPlayerId('p1'),
            tick: 3,
            payload: {},
        };
        expect(action.type).toBe('engine:end_turn');
        expect(action.tick).toBe(3);
    });

    it('supports typed generic parameters with a plain interface payload', () => {
        // PlainMovePayload is a plain interface — no Record<string, unknown> intersection.
        // Before relaxing TPayload to `object` this would fail typecheck with
        // "Index signature for type 'string' is missing in type 'PlainMovePayload'".
        interface PlainMovePayload {
            readonly x: number;
            readonly y: number;
        }
        const action: TypedAction<'mygame:move', PlainMovePayload> = {
            type: 'mygame:move',
            playerId: toPlayerId('p1'),
            tick: 1,
            payload: { x: 3, y: 4 },
        };
        expect(action.payload.x).toBe(3);
    });
});

// ─── ActionEnvelope ──────────────────────────────────────────────────────────

describe('ActionEnvelope', () => {
    it('is assignable from a plain EngineAction', () => {
        const action: EngineAction = {
            type: 'engine:undo',
            playerId: toPlayerId('p1'),
            tick: 2,
            payload: {},
        };
        const envelope: ActionEnvelope = action;
        expect(envelope.type).toBe('engine:undo');
        expect(envelope.tick).toBe(2);
    });
});

// ─── ValidationResult ────────────────────────────────────────────────────────

describe('ValidationResult', () => {
    it('can be ok:true without a reason', () => {
        const result: ValidationResult = { ok: true };
        expect(result.ok).toBe(true);
    });

    it('can be ok:false with a reason', () => {
        const result: ValidationResult = { ok: false, reason: 'not_your_turn' };
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('not_your_turn');
    });
});

// ─── ReduceContext ───────────────────────────────────────────────────────────

describe('ReduceContext', () => {
    it('can be constructed with only rng (db is optional)', () => {
        const ctx: ReduceContext = { rng: makeStubRng(0.5), dispatchDepth: 0 };
        expect(ctx.rng.float()).toBe(0.5);
    });

    it('can be constructed with both rng and db', () => {
        const db = {} as ContentDatabase;
        const ctx: ReduceContext = { rng: makeStubRng(0.1), db, dispatchDepth: 0 };
        expect(ctx.db).toBeDefined();
    });

    it('rng.float() returns a number', () => {
        const ctx: ReduceContext = { rng: makeStubRng(0.7), dispatchDepth: 0 };
        const result: number = ctx.rng.float();
        expect(typeof result).toBe('number');
    });
});

// ─── ActionDefinition ────────────────────────────────────────────────────────

describe('ActionDefinition', () => {
    it('can be implemented with all required methods', () => {
        const def: ActionDefinition<Record<string, unknown>> = {
            type: 'mygame:noop',
            parsePayload(_raw) {
                return {};
            },
            validate(_payload, _state, _playerId, _ctx) {
                return { ok: true };
            },
            reduce(state, _payload, _playerId, _ctx) {
                return state;
            },
        };

        expect(def.type).toBe('mygame:noop');
    });

    it('supports optional predictable field', () => {
        const def: ActionDefinition<Record<string, unknown>> = {
            type: 'mygame:safe_move',
            predictable: true,
            parsePayload(_raw) {
                return {};
            },
            validate(_payload, _state, _playerId, _ctx) {
                return { ok: true };
            },
            reduce(state, _payload, _playerId, _ctx) {
                return state;
            },
        };

        expect(def.predictable).toBe(true);
    });

    it('accepts a plain interface payload without Record<string, unknown> intersection', () => {
        // PlainPayload is a plain interface — not intersected with Record<string, unknown>.
        // Before relaxing TPayload to `object` this would fail typecheck with
        // "Index signature for type 'string' is missing in type 'PlainPayload'".
        interface PlainPayload {
            readonly value: number;
        }
        const def: ActionDefinition<PlainPayload> = {
            type: 'test:plain',
            parsePayload: (raw) => {
                const v = (raw as { value?: unknown }).value;
                if (typeof v !== 'number') throw new Error('invalid');
                return { value: v };
            },
            validate: () => ({ ok: true }),
            reduce: (state) => state,
        };
        const ctx: ReduceContext = { rng: makeStubRng(0.5), dispatchDepth: 0 };
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 0,
            players: {},
            entities: {},
            phase: 'test' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const result = def.validate({ value: 42 }, snap, toPlayerId('p1'), ctx);
        expect(result.ok).toBe(true);
    });

    it('reduce does not mutate the input state', () => {
        const def: ActionDefinition<Record<string, unknown>> = {
            type: 'mygame:noop',
            parsePayload(_raw) {
                return {};
            },
            validate(_payload, _state, _playerId, _ctx) {
                return { ok: true };
            },
            reduce(state, _payload, _playerId, _ctx) {
                // Idiomatic: spread to produce a new object rather than mutating
                return { ...state };
            },
        };

        const initial: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
        };

        const ctx: ReduceContext = { rng: makeStubRng(0), dispatchDepth: 0 };
        const next = def.reduce(initial, {}, toPlayerId('p1'), ctx);

        expect(next).not.toBe(initial);
        expect(next.tick).toBe(initial.tick);
    });
});

// ─── Role Marker Interfaces ──────────────────────────────────────────────────

describe('SimulationHostRole and SimulationClientRole', () => {
    it('SimulationHostRole marks a host process object', () => {
        const host: SimulationHostRole = { role: 'host' };
        expect(host.role).toBe('host');
    });

    it('SimulationClientRole marks a client process object', () => {
        const client: SimulationClientRole = { role: 'client' };
        expect(client.role).toBe('client');
    });
});

// ─── UndoContext ─────────────────────────────────────────────────────────────

describe('UndoContext', () => {
    it('can be constructed with an undoManager stub', () => {
        const pid = toPlayerId('p1');
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: {},
            entities: {},
            phase: 'test' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const ctx: UndoContext = {
            undoManager: {
                canUndo: (_playerId) => false,
                canRedo: (_playerId) => false,
                undo: (_playerId) => snap,
                redo: (_playerId) => snap,
                clearUndoHistory: (_playerId) => undefined,
                saveTurnMemento: (_state, _playerId) => undefined,
            },
        };
        expect(ctx.undoManager?.canUndo(pid)).toBe(false);
        expect(ctx.undoManager?.canRedo(pid)).toBe(false);
    });

    it('undoManager is optional — can be constructed without it', () => {
        const ctx: UndoContext = {};
        expect(ctx.undoManager).toBeUndefined();
    });

    it('undoManager.canUndo and canRedo accept PlayerId and return boolean', () => {
        const pid = toPlayerId('p2');
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: {},
            entities: {},
            phase: 'test' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const ctx: UndoContext = {
            undoManager: {
                canUndo: (id) => id === toPlayerId('p2'),
                canRedo: (_id) => true,
                undo: (_playerId) => snap,
                redo: (_playerId) => snap,
                clearUndoHistory: (_playerId) => undefined,
                saveTurnMemento: (_state, _playerId) => undefined,
            },
        };
        expect(ctx.undoManager?.canUndo(pid)).toBe(true);
        expect(ctx.undoManager?.canRedo(pid)).toBe(true);
    });
});

// ─── HistoryContext ──────────────────────────────────────────────────────────

describe('HistoryContext', () => {
    it('can be constructed with a history stub', () => {
        const appended: unknown[] = [];
        const ctx: HistoryContext = {
            history: {
                append: (entry) => {
                    appended.push(entry);
                },
                pruneTo: (_cutoff) => undefined,
            },
        };
        const action: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: toPlayerId('p1'),
            tick: 1,
            payload: {},
        };
        ctx.history?.append({ tickApplied: 1, turnNumber: 0, action });
        expect(appended).toHaveLength(1);
    });

    it('history is optional — can be constructed without it', () => {
        const ctx: HistoryContext = {};
        expect(ctx.history).toBeUndefined();
    });

    it('history.append receives tickApplied, turnNumber, and action fields', () => {
        let received: { tickApplied: number; turnNumber: number; action: ActionEnvelope } | null =
            null;
        const ctx: HistoryContext = {
            history: {
                append: (entry) => {
                    received = entry;
                },
                pruneTo: (_cutoff) => undefined,
            },
        };
        const action: ActionEnvelope = {
            type: 'mygame:move',
            playerId: toPlayerId('p1'),
            tick: 5,
            payload: {},
        };
        ctx.history?.append({ tickApplied: 5, turnNumber: 2, action });
        expect(received).not.toBeNull();
        expect(received!.tickApplied).toBe(5);
        expect(received!.turnNumber).toBe(2);
        expect(received!.action.type).toBe('mygame:move');
    });
});

// ─── BroadcastContext ────────────────────────────────────────────────────────

describe('BroadcastContext', () => {
    it('can be constructed with a broadcast function', () => {
        const calls: [Readonly<Record<string, unknown>>, string][] = [];
        const ctx: BroadcastContext = {
            broadcast: (snapshot, to) => {
                calls.push([snapshot, to]);
            },
        };
        ctx.broadcast?.(toViewerSnapshot({ tick: 1 }), toPlayerId('p1'));
        expect(calls).toHaveLength(1);
        expect(calls[0]![1]).toBe('p1');
    });

    it('broadcast is optional — can be constructed without it', () => {
        const ctx: BroadcastContext = {};
        expect(ctx.broadcast).toBeUndefined();
    });

    it('broadcast receives an opaque snapshot and a PlayerId', () => {
        let capturedSnapshot: Readonly<Record<string, unknown>> | null = null;
        let capturedTo: string | null = null;
        const ctx: BroadcastContext = {
            broadcast: (snapshot, to) => {
                capturedSnapshot = snapshot;
                capturedTo = to;
            },
        };
        ctx.broadcast?.(toViewerSnapshot({ foo: 'bar', tick: 42 }), toPlayerId('p2'));
        expect(capturedSnapshot).toStrictEqual({ foo: 'bar', tick: 42 });
        expect(capturedTo).toBe('p2');
    });
});

// ─── DebugContext ────────────────────────────────────────────────────────────

describe('DebugContext', () => {
    it('can be constructed with a debugObserver function', () => {
        const observations: { tick: number; snapshot: Readonly<BaseGameSnapshot> }[] = [];
        const ctx: DebugContext = {
            debugObserver: (tick, snapshot) => {
                observations.push({ tick, snapshot });
            },
        };
        const snap: BaseGameSnapshot = {
            tick: 3,
            seed: 1,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        ctx.debugObserver?.(3, snap);
        expect(observations).toHaveLength(1);
        expect(observations[0]!.tick).toBe(3);
    });

    it('debugObserver is optional — can be constructed without it', () => {
        const ctx: DebugContext = {};
        expect(ctx.debugObserver).toBeUndefined();
    });

    it('debugObserver receives tick (number) and a BaseGameSnapshot', () => {
        let capturedTick: number | null = null;
        const ctx: DebugContext = {
            debugObserver: (tick, _snapshot) => {
                capturedTick = tick;
            },
        };
        const snap: BaseGameSnapshot = {
            tick: 7,
            seed: 99,
            players: {},
            entities: {},
            phase: 'end' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        ctx.debugObserver?.(7, snap);
        expect(capturedTick).toBe(7);
    });
});

// ─── PipelineContext (extended) ───────────────────────────────────────────────

describe('PipelineContext', () => {
    it('retains the existing optional db field', () => {
        const db = {} as ContentDatabase;
        const ctx: PipelineContext = { db };
        expect(ctx.db).toBeDefined();
    });

    it('can be constructed with all sub-context fields present', () => {
        const db = {} as ContentDatabase;
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: {},
            entities: {},
            phase: 'test' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const ctx: PipelineContext = {
            db,
            undoManager: {
                canUndo: () => false,
                canRedo: () => false,
                undo: () => snap,
                redo: () => snap,
                clearUndoHistory: () => undefined,
                saveTurnMemento: () => undefined,
            },
            history: { append: () => undefined, pruneTo: () => undefined },
            broadcast: () => undefined,
            debugObserver: () => undefined,
        };
        expect(ctx.db).toBeDefined();
        expect(ctx.undoManager).toBeDefined();
        expect(ctx.history).toBeDefined();
        expect(ctx.broadcast).toBeDefined();
        expect(ctx.debugObserver).toBeDefined();
    });

    it('can be constructed with no fields (all optional)', () => {
        const ctx: PipelineContext = {};
        expect(ctx.db).toBeUndefined();
        expect(ctx.undoManager).toBeUndefined();
        expect(ctx.history).toBeUndefined();
        expect(ctx.broadcast).toBeUndefined();
        expect(ctx.debugObserver).toBeUndefined();
    });

    it('is structurally assignable to UndoContext', () => {
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 1,
            players: {},
            entities: {},
            phase: 'test' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const pipelineCtx: PipelineContext = {
            undoManager: {
                canUndo: () => true,
                canRedo: () => false,
                undo: () => snap,
                redo: () => snap,
                clearUndoHistory: () => undefined,
                saveTurnMemento: () => undefined,
            },
        };
        const undoCtx: UndoContext = pipelineCtx;
        expect(undoCtx.undoManager?.canUndo(toPlayerId('p1'))).toBe(true);
    });

    it('is structurally assignable to HistoryContext', () => {
        const appended: unknown[] = [];
        const pipelineCtx: PipelineContext = {
            history: { append: (e) => appended.push(e), pruneTo: () => undefined },
        };
        const histCtx: HistoryContext = pipelineCtx;
        const action: ActionEnvelope = {
            type: 'engine:tick',
            playerId: toPlayerId('p1'),
            tick: 1,
            payload: {},
        };
        histCtx.history?.append({ tickApplied: 1, turnNumber: 0, action });
        expect(appended).toHaveLength(1);
    });

    it('is structurally assignable to BroadcastContext', () => {
        let called = false;
        const pipelineCtx: PipelineContext = {
            broadcast: () => {
                called = true;
            },
        };
        const broadCtx: BroadcastContext = pipelineCtx;
        broadCtx.broadcast?.(toViewerSnapshot({}), toPlayerId('p1'));
        expect(called).toBe(true);
    });

    it('is structurally assignable to DebugContext', () => {
        let called = false;
        const snap: BaseGameSnapshot = {
            tick: 0,
            seed: 0,
            players: {},
            entities: {},
            phase: 'idle' as GamePhase,
            events: [],
            turnNumber: 0,
        };
        const pipelineCtx: PipelineContext = {
            debugObserver: () => {
                called = true;
            },
        };
        const debugCtx: DebugContext = pipelineCtx;
        debugCtx.debugObserver?.(0, snap);
        expect(called).toBe(true);
    });
});

// ─── ViewerSnapshot / toViewerSnapshot (WARN-3) ───────────────────────────────

describe('ViewerSnapshot and toViewerSnapshot', () => {
    it('toViewerSnapshot is a function', () => {
        expect(typeof toViewerSnapshot).toBe('function');
    });

    it('toViewerSnapshot returns the same object reference', () => {
        const raw: Readonly<Record<string, unknown>> = { tick: 1, seed: 2 };
        const vs = toViewerSnapshot(raw);
        expect(vs).toBe(raw);
    });

    it('BroadcastContext.broadcast accepts a ViewerSnapshot value produced by toViewerSnapshot', () => {
        const captured: ViewerSnapshot[] = [];
        const ctx: BroadcastContext = {
            broadcast: (snap) => captured.push(snap),
        };
        const pid = toPlayerId('p1');
        const raw: Readonly<Record<string, unknown>> = { tick: 0, phase: 'test' };
        ctx.broadcast?.(toViewerSnapshot(raw), pid);
        expect(captured).toHaveLength(1);
        expect(captured[0]).toBe(raw);
    });
});

// ─── GameReduceContext ────────────────────────────────────────────────────────

describe('GameReduceContext', () => {
    it('can be constructed with only rng and dispatchDepth', () => {
        const ctx: GameReduceContext = { rng: makeStubRng(0.5), dispatchDepth: 0 };
        expect(ctx.rng.float()).toBe(0.5);
    });

    it('can be constructed with rng, db, and dispatchDepth', () => {
        const db = {} as ContentDatabase;
        const ctx: GameReduceContext = { rng: makeStubRng(0.1), db, dispatchDepth: 0 };
        expect(ctx.db).toBeDefined();
    });

    it('ReduceContext is assignable to GameReduceContext', () => {
        const rc: ReduceContext = { rng: makeStubRng(0.3), dispatchDepth: 0 };
        const grc: GameReduceContext = rc;
        expect(grc.rng.float()).toBe(0.3);
    });

    it('has dispatchDepth required field', () => {
        const ctx: GameReduceContext = { rng: makeStubRng(0), dispatchDepth: 5 };
        expect(ctx.dispatchDepth).toBe(5);
    });

    it('does not expose dispatch — game code cannot reach the engine-internal field', () => {
        const ctx: GameReduceContext = { rng: makeStubRng(0), dispatchDepth: 0 };
        expect('dispatch' in ctx).toBe(false);
    });

    it('does not expose logger — game code cannot reach the engine-internal field', () => {
        const ctx: GameReduceContext = { rng: makeStubRng(0), dispatchDepth: 0 };
        // Type-level guarantee: GameReduceContext has no `logger` key. The
        // runtime check mirrors the dispatch case above.
        expect('logger' in ctx).toBe(false);
        const _shouldNotCompile: GameReduceContext = {
            rng: makeStubRng(0),
            dispatchDepth: 0,
            // @ts-expect-error — `logger` must not be assignable on GameReduceContext.
            logger: {
                trace: () => undefined,
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
                fatal: () => undefined,
                child: function () {
                    return this;
                },
            },
        };
        void _shouldNotCompile;
    });
});

// ─── isReduceContext ──────────────────────────────────────────────────────────

describe('isReduceContext', () => {
    it('returns true when ctx has dispatch field', () => {
        const rc: ReduceContext = {
            rng: makeStubRng(0),
            dispatchDepth: 0,
            dispatch: (_s, _a) => _s,
        };
        expect(isReduceContext(rc)).toBe(true);
    });

    it('returns false when ctx does not have dispatch field', () => {
        const grc: GameReduceContext = { rng: makeStubRng(0), dispatchDepth: 0 };
        expect(isReduceContext(grc)).toBe(false);
    });

    it('narrows ctx to ReduceContext making dispatch accessible', () => {
        const rc: ReduceContext = {
            rng: makeStubRng(0),
            dispatchDepth: 0,
            dispatch: (_s, _a) => _s,
        };
        if (isReduceContext(rc)) {
            expect(rc.dispatch).toBeDefined();
        } else {
            throw new Error('Expected isReduceContext to return true');
        }
    });

    it('returns false for a GameReduceContext without dispatch even if undoManager is present', () => {
        const grc: GameReduceContext = {
            rng: makeStubRng(0),
            dispatchDepth: 0,
            undoManager: {
                canUndo: () => true,
                canRedo: () => false,
            },
        };
        expect(isReduceContext(grc)).toBe(false);
    });
});
