/**
 * simulation/engine/prediction/ClientPredictor.test.ts
 *
 * Tests written first (red phase) per TDD mandate — ClientPredictor.ts does not
 * exist yet.
 *
 * Architecture reference: §6 — simulation/prediction/ · Client Prediction
 * Task: F17 (issue #366)
 *
 * Acceptance criteria (from issue #366):
 *   ✓ applyOptimistic() returns the correctly mutated PlayerSnapshot for a
 *     predictable: true action
 *   ✓ applyOptimistic() throws NonPredictableActionError for a predictable: false
 *     / absent action
 *   ✓ No imports from renderer/, electron/, games/*, or any DOM API
 *   ✓ pnpm typecheck exits 0 on the new file
 *
 * Invariants upheld:
 *   #1 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #2 — applyAction/definition.reduce are pure — applyOptimistic must not
 *         produce side effects.
 *   #43 — No Math.random, Date.now, performance.now inside the predictor.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ClientPredictor, NonPredictableActionError } from './ClientPredictor.js';
import { ActionRegistry } from '../ActionRegistry.js';
import { makeStubRng } from '../__test-support__/stubs.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    EngineAction,
    ReduceContext,
    PlayerId,
    ValidationResult,
} from '../types.js';
import { playerId as toPlayerId } from '../types.js';

// ─── Test helpers ──────────────────────────────────────────────────────────────

interface TestSnapshot extends BaseGameSnapshot {
    readonly value: number;
}

function makeBaseSnapshot(overrides: Partial<TestSnapshot> = {}): TestSnapshot {
    return {
        tick: 0,
        seed: 1,
        players: {},
        entities: {},
        phase: 'playing' as TestSnapshot['phase'],
        events: [],
        turnNumber: 0,
        value: 0,
        ...overrides,
    };
}

function makeAction(type: string, playerId: PlayerId = toPlayerId('p1')): EngineAction {
    return {
        type,
        playerId,
        tick: 0,
        payload: {},
    };
}

function makeStubCtx(): ReduceContext {
    return { rng: makeStubRng(), dispatchDepth: 0 };
}

/** Creates a predictable ActionDefinition that increments snapshot.value by 1. */
function makePredictableDefinition(
    type: string,
): ActionDefinition<Record<string, unknown>, TestSnapshot> {
    return {
        type,
        predictable: true,
        parsePayload: (raw) => raw,
        validate: (): ValidationResult => ({ ok: true }),
        reduce: (state): TestSnapshot => ({ ...state, value: state.value + 1 }),
    };
}

/** Creates a non-predictable ActionDefinition (predictable: false). */
function makeNonPredictableDefinition(
    type: string,
): ActionDefinition<Record<string, unknown>, TestSnapshot> {
    return {
        type,
        predictable: false,
        parsePayload: (raw) => raw,
        validate: (): ValidationResult => ({ ok: true }),
        reduce: (state): TestSnapshot => ({ ...state, value: state.value + 99 }),
    };
}

/** Creates an ActionDefinition with predictable absent (undefined). */
function makeUnmarkedDefinition(
    type: string,
): ActionDefinition<Record<string, unknown>, TestSnapshot> {
    return {
        type,
        parsePayload: (raw) => raw,
        validate: (): ValidationResult => ({ ok: true }),
        reduce: (state): TestSnapshot => ({ ...state, value: state.value + 99 }),
    };
}

// ─── NonPredictableActionError ────────────────────────────────────────────────

describe('NonPredictableActionError', () => {
    it('is an instance of Error', () => {
        const err = new NonPredictableActionError('game:move_unit');
        expect(err).toBeInstanceOf(Error);
    });

    it('has a code discriminant property equal to "NON_PREDICTABLE_ACTION"', () => {
        const err = new NonPredictableActionError('game:move_unit');
        expect(err.code).toBe('NON_PREDICTABLE_ACTION');
    });

    it('includes the offending type string in the message', () => {
        const err = new NonPredictableActionError('game:attack_unit');
        expect(err.message).toContain('game:attack_unit');
    });

    it('has the correct name property', () => {
        const err = new NonPredictableActionError('game:move_unit');
        expect(err.name).toBe('NonPredictableActionError');
    });

    it('exposes the action type on the type property', () => {
        const err = new NonPredictableActionError('game:move_unit');
        expect(err.type).toBe('game:move_unit');
    });
});

// ─── ClientPredictor ──────────────────────────────────────────────────────────

describe('ClientPredictor', () => {
    let registry: ActionRegistry<TestSnapshot>;
    let ctx: ReduceContext;
    let predictor: ClientPredictor<TestSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry<TestSnapshot>();
        ctx = makeStubCtx();
        predictor = new ClientPredictor(registry, ctx);
    });

    describe('applyOptimistic() — predictable: true action', () => {
        it('returns a new snapshot with the action applied', () => {
            registry.register(makePredictableDefinition('game:increment'));
            const snapshot = makeBaseSnapshot({ value: 5 });
            const action = makeAction('game:increment');

            const result = predictor.applyOptimistic(snapshot, action);

            expect(result.value).toBe(6);
        });

        it('does not mutate the input snapshot', () => {
            registry.register(makePredictableDefinition('game:increment'));
            const snapshot = makeBaseSnapshot({ value: 10 });
            const action = makeAction('game:increment');

            predictor.applyOptimistic(snapshot, action);

            expect(snapshot.value).toBe(10);
        });

        it('returns a snapshot with the same type as the input', () => {
            registry.register(makePredictableDefinition('game:increment'));
            const snapshot = makeBaseSnapshot({ value: 0 });
            const action = makeAction('game:increment');

            const result = predictor.applyOptimistic(snapshot, action);

            expect(result).toHaveProperty('value');
            expect(result.tick).toBe(snapshot.tick);
        });

        it('passes the correct playerId from the action to the reducer', () => {
            const capturedPlayerIds: PlayerId[] = [];
            const definition: ActionDefinition<Record<string, unknown>, TestSnapshot> = {
                type: 'game:spy_action',
                predictable: true,
                parsePayload: (raw) => raw,
                validate: (): ValidationResult => ({ ok: true }),
                reduce: (state, _payload, pid): TestSnapshot => {
                    capturedPlayerIds.push(pid);
                    return state;
                },
            };
            registry.register(definition);
            const snapshot = makeBaseSnapshot();
            const action = makeAction('game:spy_action', toPlayerId('p2'));

            predictor.applyOptimistic(snapshot, action);

            expect(capturedPlayerIds).toEqual([toPlayerId('p2')]);
        });
    });

    describe('applyOptimistic() — predictable: false action', () => {
        it('throws NonPredictableActionError', () => {
            registry.register(makeNonPredictableDefinition('game:attack'));
            const snapshot = makeBaseSnapshot({ value: 0 });
            const action = makeAction('game:attack');

            expect(() => predictor.applyOptimistic(snapshot, action)).toThrow(
                NonPredictableActionError,
            );
        });

        it('error includes the action type', () => {
            registry.register(makeNonPredictableDefinition('game:attack'));
            const snapshot = makeBaseSnapshot();
            const action = makeAction('game:attack');

            let thrown: unknown;
            try {
                predictor.applyOptimistic(snapshot, action);
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBeInstanceOf(NonPredictableActionError);
            expect((thrown as NonPredictableActionError).type).toBe('game:attack');
        });

        it('does NOT apply the reducer when predictable is false', () => {
            registry.register(makeNonPredictableDefinition('game:attack'));
            const snapshot = makeBaseSnapshot({ value: 0 });
            const action = makeAction('game:attack');

            expect(() => predictor.applyOptimistic(snapshot, action)).toThrow();
            // Value must be unchanged — reducer must not have run
            expect(snapshot.value).toBe(0);
        });
    });

    describe('applyOptimistic() — predictable absent (undefined)', () => {
        it('throws NonPredictableActionError when predictable is absent', () => {
            registry.register(makeUnmarkedDefinition('game:unmarked'));
            const snapshot = makeBaseSnapshot();
            const action = makeAction('game:unmarked');

            expect(() => predictor.applyOptimistic(snapshot, action)).toThrow(
                NonPredictableActionError,
            );
        });
    });
});
