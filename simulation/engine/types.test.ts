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

import type {
    PlayerId,
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
    SimulationHostRole,
    SimulationClientRole,
} from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlayerId(raw: string): PlayerId {
    return raw as PlayerId;
}

function makeEntityId(raw: string): EntityId {
    return raw as EntityId;
}

// ─── PlayerId / EntityId ─────────────────────────────────────────────────────

describe('PlayerId and EntityId', () => {
    it('are string-compatible branded types', () => {
        const pid = makePlayerId('player-1');
        const eid = makeEntityId('entity-42');
        expect(typeof pid).toBe('string');
        expect(typeof eid).toBe('string');
    });

    it('type: PlayerId is assignable to string', () => {
        const pid = makePlayerId('p1');
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
        const state: BasePlayerState = { id: makePlayerId('p1') };
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
        };
        expect(snapshot.tick).toBe(0);
        expect(snapshot.seed).toBe(12345);
    });

    it('has an optional turnClock field', () => {
        const pid = makePlayerId('p1');
        const snapshot: BaseGameSnapshot = {
            tick: 5,
            seed: 99,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
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
        };
        expect(snapshot.turnClock).toBeUndefined();
    });
});

// ─── EngineAction ────────────────────────────────────────────────────────────

describe('EngineAction', () => {
    it('includes type, playerId, tick, and payload', () => {
        const action: EngineAction = {
            type: 'engine:end_turn',
            playerId: makePlayerId('p1'),
            tick: 3,
            payload: {},
        };
        expect(action.type).toBe('engine:end_turn');
        expect(action.tick).toBe(3);
    });

    it('supports typed generic parameters', () => {
        interface MovePayload extends Record<string, unknown> {
            x: number;
            y: number;
        }
        const action: TypedAction<'mygame:move', MovePayload> = {
            type: 'mygame:move',
            playerId: makePlayerId('p1'),
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
            playerId: makePlayerId('p1'),
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
        const ctx: ReduceContext = { rng: makeStubRng(0.5) };
        expect(ctx.rng.float()).toBe(0.5);
    });

    it('can be constructed with both rng and db', () => {
        const db = {} as ContentDatabase;
        const ctx: ReduceContext = { rng: makeStubRng(0.1), db };
        expect(ctx.db).toBeDefined();
    });

    it('rng.float() returns a number', () => {
        const ctx: ReduceContext = { rng: makeStubRng(0.7) };
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
        };

        const ctx: ReduceContext = { rng: makeStubRng(0) };
        const next = def.reduce(initial, {}, makePlayerId('p1'), ctx);

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
