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
import type { BaseGameSnapshot, PlayerId } from './types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const makeSnapshot = (): BaseGameSnapshot => ({
    tick: 0,
    seed: 42,
    players: {},
    entities: {},
    phase: 'waiting' as BaseGameSnapshot['phase'],
    events: [],
});

const stubCtx = { rng: () => 0.5 };
const hostId = 'p1' as PlayerId;

// ─── EngineActions array ──────────────────────────────────────────────────────

describe('EngineActions array', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(EngineActions)).toBe(true);
        expect(EngineActions.length).toBeGreaterThan(0);
    });

    it('contains exactly two definitions', () => {
        expect(EngineActions).toHaveLength(2);
    });

    it('contains an engine:tick definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:tick');
        expect(definition).toBeDefined();
    });

    it('contains an engine:end_turn definition', () => {
        const definition = EngineActions.find((d) => d.type === 'engine:end_turn');
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

    it('validate returns ok: true', () => {
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
});
