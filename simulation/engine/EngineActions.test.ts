/**
 * simulation/engine/EngineActions.test.ts
 *
 * TDD tests for EngineActions reserved action definitions.
 *
 * Architecture reference: §4.2, §4.7
 * Task: F03 / T4 (issue #27)
 *
 * These tests are written FIRST against the not-yet-existing module.
 * They express the acceptance criteria from the issue:
 *   - engine:tick and engine:end_turn exist with correct type strings
 *   - Both have valid type guards (parsePayload) and stub reducers
 *   - registerEngineActions() registers both without throwing NamespaceCollisionError
 *   - registry.has("engine:tick") returns true after registration
 */

import { describe, it, expect, beforeEach, expectTypeOf } from 'vitest';
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
} from './EngineActions.js';
import { makeStubRng } from './__test-support__/stubs.js';
import type { BaseGameSnapshot, PlayerId, ReduceContext } from './types.js';
import { playerId as toPlayerId } from './types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────────

const makeSnapshot = (hostPlayerId?: PlayerId): BaseGameSnapshot => ({
    tick: 0,
    seed: 42,
    players: {},
    entities: {},
    phase: 'waiting' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber: 0,
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

// ─── EngineActions array ──────────────────────────────────────────────────────

describe('EngineActions array', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(EngineActions)).toBe(true);
        expect(EngineActions.length).toBeGreaterThan(0);
    });

    it('contains exactly seven definitions', () => {
        expect(EngineActions).toHaveLength(7);
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

    it('reduce returns snapshot unchanged (stub)', () => {
        const snapshot = makeSnapshot();
        const next = definition().reduce(snapshot, { seed: 7 }, hostId, stubCtx);
        expect(next).toBe(snapshot);
    });

    it('reduce does not mutate the input snapshot', () => {
        const snapshot = makeSnapshot();
        const frozen = Object.freeze({ ...snapshot });
        expect(() => definition().reduce(frozen, { seed: 7 }, hostId, stubCtx)).not.toThrow();
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

    it('all seven engine: types appear in registeredTypes()', () => {
        registerEngineActions(registry);
        const types = registry.registeredTypes();
        expect(types).toContain('engine:save');
        expect(types).toContain('engine:load');
        expect(types).toContain('engine:undo');
        expect(types).toContain('engine:redo');
        expect(types).toContain('engine:sync_request');
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

    it('all individually exported definitions are in the EngineActions array', () => {
        const individualDefs = [
            engineTickDefinition,
            engineEndTurnDefinition,
            engineSaveDefinition,
            engineLoadDefinition,
            engineUndoDefinition,
            engineRedoDefinition,
            engineSyncRequestDefinition,
        ];
        for (const def of individualDefs) {
            expect(EngineActions.some((d) => d === def)).toBe(true);
        }
    });
});

// ─── registerEngineActions — generic TState constraint (issue #38) ─────────────

/**
 * Concrete snapshot subtype used only in the type-level test below.
 * Represents what any game-specific snapshot (e.g. TacticsSnapshot) would look like.
 */
interface ConcreteSnapshot extends BaseGameSnapshot {
    readonly extra: number;
}

describe('registerEngineActions — generic TState constraint (issue #38)', () => {
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
