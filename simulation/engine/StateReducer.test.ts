/**
 * simulation/engine/StateReducer.test.ts
 *
 * TDD tests for StateReducer.
 *
 * Architecture reference: §4.7
 *
 * Acceptance criteria:
 *   1. StateReducer delegates to registry and calls def.reduce().
 *   2. Returns the value produced by def.reduce().
 *   3. Throws UnknownActionTypeError for unregistered action types.
 *   4. Throws ActionSchemaError when parsePayload throws.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateReducer, ActionSchemaError } from './StateReducer.js';
import { ActionRegistry, UnknownActionTypeError } from './ActionRegistry.js';
import { makeStubRng } from './__test-support__/stubs.js';
import type { BaseGameSnapshot, ActionEnvelope, ActionDefinition, ReduceContext } from './types.js';
import { playerId as toPlayerId } from './types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

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

beforeEach(() => {
    registry = new ActionRegistry();
    registry.register(noopDef);
});

// ─── StateReducer ──────────────────────────────────────────────────────────────

describe('StateReducer', () => {
    it('calls registry.resolve and invokes def.reduce', () => {
        const reduceSpy = vi.fn((state: Readonly<BaseGameSnapshot>) => state);
        const spyDef: ActionDefinition<Record<string, never>> = {
            type: 'game:reducer-spy',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: reduceSpy,
        };
        registry.register(spyDef);

        const reducer = new StateReducer(registry);
        const snapshot = makeSnapshot(0);
        const action = makeEnvelope(0, 'game:reducer-spy');
        const ctx: ReduceContext = { rng: makeStubRng(0) };

        reducer.apply(snapshot, action, ctx);

        expect(reduceSpy).toHaveBeenCalledOnce();
        expect(reduceSpy).toHaveBeenCalledWith(snapshot, {}, PID, ctx);
    });

    it('returns the value produced by def.reduce', () => {
        const modified: BaseGameSnapshot = { ...makeSnapshot(0), seed: 99 };
        const resultDef: ActionDefinition<Record<string, never>> = {
            type: 'game:result',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: () => modified,
        };
        registry.register(resultDef);

        const reducer = new StateReducer(registry);
        const result = reducer.apply(makeSnapshot(0), makeEnvelope(0, 'game:result'), {
            rng: makeStubRng(0),
        });
        expect(result).toBe(modified);
    });

    it('throws UnknownActionTypeError for unregistered action type', () => {
        const reducer = new StateReducer(registry);
        const ctx: ReduceContext = { rng: makeStubRng(0) };
        expect(() =>
            reducer.apply(makeSnapshot(0), makeEnvelope(0, 'game:unregistered'), ctx),
        ).toThrow(UnknownActionTypeError);
    });

    it('throws ActionSchemaError when parsePayload fails', () => {
        const badSchemaDef: ActionDefinition<Record<string, never>> = {
            type: 'game:bad-sr-schema',
            parsePayload: () => {
                throw new TypeError('bad');
            },
            validate: () => ({ ok: true }),
            reduce: (state) => state,
        };
        registry.register(badSchemaDef);

        const reducer = new StateReducer(registry);
        const ctx: ReduceContext = { rng: makeStubRng(0) };
        expect(() =>
            reducer.apply(makeSnapshot(0), makeEnvelope(0, 'game:bad-sr-schema'), ctx),
        ).toThrow(ActionSchemaError);
    });
});
