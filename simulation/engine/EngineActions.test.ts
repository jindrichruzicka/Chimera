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

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry } from './ActionRegistry.js';
import { EngineActions, registerEngineActions } from './EngineActions.js';
import { makeStubRng } from './__test-support__/stubs.js';
import type { BaseGameSnapshot, PlayerId } from './types.js';
import { playerId as toPlayerId } from './types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────────

const makeSnapshot = (hostPlayerId?: PlayerId): BaseGameSnapshot => ({
    tick: 0,
    seed: 42,
    players: {},
    entities: {},
    phase: 'waiting' as BaseGameSnapshot['phase'],
    events: [],
    ...(hostPlayerId !== undefined && { hostPlayerId }),
});

const stubCtx = { rng: makeStubRng(0.5) };
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

    it('validate returns ok: true when hostPlayerId is undefined (single-player, invariant #25)', () => {
        const snapshot = makeSnapshot(); // no hostPlayerId → single-player mode
        const result = definition().validate(
            { slotId: 'tactics/autosave' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(true);
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
    // TODO(F18): post-pipeline save wiring is not yet implemented.
    it.todo(
        'dispatching engine:save should result in a file being written to the repository (post-pipeline wiring — F18)',
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

    it('validate returns ok: true when hostPlayerId is undefined (single-player, invariant #25)', () => {
        const snapshot = makeSnapshot(); // no hostPlayerId → single-player mode
        const result = definition().validate(
            { slotId: 'tactics/slot-1' },
            snapshot,
            hostId,
            stubCtx,
        );
        expect(result.ok).toBe(true);
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

    // TODO(F18): post-pipeline load wiring is not yet implemented.
    it.todo(
        'dispatching engine:load should result in the simulation state being replaced (post-pipeline wiring — F18)',
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
