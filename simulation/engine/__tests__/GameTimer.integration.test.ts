/**
 * simulation/engine/__tests__/GameTimer.integration.test.ts
 *
 * Integration tests for TimerManager within the complete ActionPipeline.
 * Tests the interaction of timers with:
 *   - Re-entrant dispatch depth tracking (Invariant #89)
 *   - Non-fatal validation failure handling (§4.20)
 *   - Save round-trip serialization (Invariant #54)
 *
 * Architecture reference: §4.20 — Game Timers
 *
 * Invariants upheld:
 *   #54 — GameTimer lives in GameSnapshot.timers; serialises, loads, replays.
 *   #55 — TimerManager.advance() is pure; only engine:tick may call it.
 *   #89 — ctx.dispatch() nesting depth is bounded by MAX_NESTED_DISPATCH = 16.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '../../foundation/logging.js';
import { ActionPipeline, ForbiddenDispatchError } from '../ActionPipeline.js';
import { ActionRegistry } from '../ActionRegistry.js';
import { registerEngineActions } from '../EngineActions.js';
import type { TimerId, TimerRegistry } from '../GameTimer.js';
import type { ActionDefinition, ActionEnvelope, BaseGameSnapshot, PlayerId } from '../types.js';
import { isReduceContext, playerId as toPlayerId } from '../types.js';
import type { SaveFile } from '../../persistence/SaveFile.js';
import { CURRENT_SCHEMA_VERSION, createDefaultMigrator } from '../../persistence/SaveMigrator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hostId = toPlayerId('p1');
const guestId = toPlayerId('p2');

function makeSnapshot(options?: {
    readonly timers?: TimerRegistry;
    readonly turnClock?: BaseGameSnapshot['turnClock'];
}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 42,
        players: {
            [hostId]: { id: hostId },
            [guestId]: { id: guestId },
        },
        entities: {},
        phase: 'waiting' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: options?.timers ?? {},
        gameResult: null,
        ...(options?.turnClock === undefined ? {} : { turnClock: options.turnClock }),
    };
}

function makeEnvelope(
    type: ActionEnvelope['type'],
    playerId: PlayerId,
    payload?: Record<string, unknown>,
    tick?: number,
): ActionEnvelope {
    return {
        type,
        playerId,
        tick: tick ?? 0,
        payload: payload ?? {},
    };
}

// ─── Recursion depth guard (Invariant #89) ────────────────────────────────────

describe('GameTimer integration — re-entrant dispatch depth guard', () => {
    let pipeline: ActionPipeline;

    beforeEach(() => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);

        // Register a game action that attempts to call ctx.dispatch() immediately.
        // Used by timers to verify ForbiddenDispatchError enforcement (Invariant #89).
        // This action deliberately tests the enforcement — production game actions
        // MUST NOT call ctx.dispatch(); only engine:tick may do so.
        const recursiveActionDef: ActionDefinition<Record<string, unknown>> = {
            type: 'game:recursive_self_dispatch',
            parsePayload: (raw) => raw,
            validate: () => ({ ok: true }),
            reduce(
                state: Readonly<BaseGameSnapshot>,
                _payload: Record<string, unknown>,
                playerId: PlayerId,
                ctx,
            ) {
                // Attempt to call ctx.dispatch() from a game reducer —
                // this now throws ForbiddenDispatchError (Invariant #89).
                if (isReduceContext(ctx) && ctx.dispatch !== undefined) {
                    const envelope = makeEnvelope('game:recursive_self_dispatch', playerId);
                    return ctx.dispatch(state, envelope);
                }
                return state;
            },
        };
        registry.register(recursiveActionDef);

        pipeline = new ActionPipeline(registry);
    });

    it('timer-fired game action calling ctx.dispatch throws ForbiddenDispatchError', () => {
        // A timer fires 'game:recursive_self_dispatch'. When engine:tick advances
        // the timer and dispatches the action, the action's reduce() tries to call
        // ctx.dispatch() — which is forbidden for game reducers (Invariant #89).
        // ForbiddenDispatchError is thrown immediately, at depth 1.
        const snapshot = makeSnapshot({
            timers: {
                ['recursive-timer' as TimerId]: {
                    id: 'recursive-timer' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:recursive_self_dispatch',
                    payload: {},
                    active: true,
                },
            },
        });

        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });

        expect(() => pipeline.process(snapshot, tickEnvelope)).toThrow(ForbiddenDispatchError);
    });

    it('ForbiddenDispatchError from timer-fired game action includes the offending action type', () => {
        const snapshot = makeSnapshot({
            timers: {
                ['recursive-timer' as TimerId]: {
                    id: 'recursive-timer' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:recursive_self_dispatch',
                    payload: {},
                    active: true,
                },
            },
        });

        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });

        try {
            pipeline.process(snapshot, tickEnvelope);
            throw new Error('expected ForbiddenDispatchError but process() succeeded');
        } catch (err) {
            if (!(err instanceof ForbiddenDispatchError)) {
                throw err;
            }
            expect(err.code).toBe('FORBIDDEN_DISPATCH');
            expect(err.actionType).toBe('game:recursive_self_dispatch');
        }
    });
});

// ─── Non-fatal validation failure ──────────────────────────────────────────────

describe('GameTimer integration — non-fatal validation failure', () => {
    let pipeline: ActionPipeline;
    let loggedWarnings: {
        readonly timerId: TimerId;
        readonly actionType: string;
        readonly reason?: string;
    }[] = [];

    beforeEach(() => {
        loggedWarnings = [];
        const registry = new ActionRegistry();
        registerEngineActions(registry);

        // Register an action that may fail validation
        const conditionalValidateActionDef: ActionDefinition<{ readonly shouldFail: boolean }> = {
            type: 'game:conditional_validate_failure',
            parsePayload: (raw) => ({ shouldFail: Boolean(raw['shouldFail']) }),
            validate(payload: { readonly shouldFail: boolean }, _state, _playerId, _ctx) {
                if (payload.shouldFail) {
                    return {
                        ok: false as const,
                        reason: 'test validation failure: shouldFail=true',
                    };
                }
                return { ok: true };
            },
            reduce(state: Readonly<BaseGameSnapshot>) {
                // No-op: just return the state unchanged (to show the action "executed")
                return state;
            },
        };
        registry.register(conditionalValidateActionDef);

        // Create pipeline with a mock logger that captures warnings
        const mockLogger: Logger = {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn(message: string, context?: Record<string, unknown>) {
                if (message === 'timer fired action rejected by validate()' && context) {
                    if (
                        typeof context['timerId'] === 'string' &&
                        typeof context['actionType'] === 'string'
                    ) {
                        const reason = context['reason'] as string | undefined;
                        loggedWarnings.push({
                            timerId: context['timerId'] as TimerId,
                            actionType: context['actionType'],
                            ...(reason !== undefined ? { reason } : {}),
                        });
                    }
                }
            },
            error: () => {},
            fatal: () => {},
            child: () => mockLogger,
        };

        pipeline = new ActionPipeline(registry, { logger: mockLogger });
    });

    it('logs a warning when a timer-fired action fails validation but does not throw', () => {
        // Create a timer that will fire an action with shouldFail=true
        const snapshot = makeSnapshot({
            timers: {
                ['failing-timer' as TimerId]: {
                    id: 'failing-timer' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:conditional_validate_failure',
                    payload: { shouldFail: true },
                    active: true,
                },
            },
        });

        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });

        // Process should NOT throw despite the validation failure
        const result = pipeline.process(snapshot, tickEnvelope);

        // The result should be a valid state (engine:tick completed despite the validation failure)
        expect(result).toBeDefined();
        expect(result.tick).toBe(snapshot.tick + 1);

        // A warning should have been logged
        expect(loggedWarnings).toHaveLength(1);
        expect(loggedWarnings[0]?.timerId).toBe('failing-timer');
        expect(loggedWarnings[0]?.actionType).toBe('game:conditional_validate_failure');
        expect(loggedWarnings[0]?.reason).toContain('test validation failure');
    });

    it('allows engine:tick to continue processing other timers after one fails validation', () => {
        // Create two timers: one that fails, one that succeeds
        const snapshot = makeSnapshot({
            timers: {
                ['failing-timer' as TimerId]: {
                    id: 'failing-timer' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:conditional_validate_failure',
                    payload: { shouldFail: true },
                    active: true,
                },
                ['succeeding-timer' as TimerId]: {
                    id: 'succeeding-timer' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:conditional_validate_failure',
                    payload: { shouldFail: false },
                    active: true,
                },
            },
        });

        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });

        // Reset loggedWarnings
        loggedWarnings = [];

        // Process should NOT throw
        const result = pipeline.process(snapshot, tickEnvelope);

        expect(result).toBeDefined();

        // Both timers should have been attempted:
        // - One failed and logged a warning
        // - One succeeded (no warning)
        expect(loggedWarnings).toHaveLength(1);
        expect(loggedWarnings[0]?.timerId).toBe('failing-timer');
    });
});

// ─── Save round-trip serialization ──────────────────────────────────────────────

describe('GameTimer integration — save round-trip serialization', () => {
    let pipeline: ActionPipeline;

    beforeEach(() => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        pipeline = new ActionPipeline(registry);
    });

    it('preserves timer registry through a complete game tick without mutation', () => {
        // Create a snapshot with an active timer and an inactive timer
        const originalSnapshot = makeSnapshot({
            timers: {
                ['active-timer' as TimerId]: {
                    id: 'active-timer' as TimerId,
                    remainingTicks: 5,
                    intervalTicks: 3,
                    actionType: 'game:test_action',
                    payload: { value: 42 },
                    active: true,
                },
                ['inactive-timer' as TimerId]: {
                    id: 'inactive-timer' as TimerId,
                    remainingTicks: 10,
                    intervalTicks: 0,
                    actionType: 'game:inactive_action',
                    payload: { other: 'data' },
                    active: false,
                },
            },
        });

        // Freeze the original to ensure it's not mutated
        const frozenSnapshot = Object.freeze({
            ...originalSnapshot,
            timers: Object.freeze({ ...originalSnapshot.timers }),
        });

        // Process an engine:tick
        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });
        const resultSnapshot = pipeline.process(frozenSnapshot, tickEnvelope);

        // The inactive timer should remain exactly the same
        expect(resultSnapshot.timers['inactive-timer' as TimerId]).toEqual(
            originalSnapshot.timers['inactive-timer' as TimerId],
        );

        // The active timer should have its remainingTicks decremented
        expect(resultSnapshot.timers['active-timer' as TimerId]).toBeDefined();
        expect(resultSnapshot.timers['active-timer' as TimerId]?.remainingTicks).toBe(4);
        expect(resultSnapshot.timers['active-timer' as TimerId]?.intervalTicks).toBe(3);
        expect(resultSnapshot.timers['active-timer' as TimerId]?.actionType).toBe(
            'game:test_action',
        );
        expect(resultSnapshot.timers['active-timer' as TimerId]?.payload).toEqual({ value: 42 });
    });

    it('maintains timer identity and field types across multiple ticks', () => {
        let snapshot = makeSnapshot({
            timers: {
                ['interval-timer' as TimerId]: {
                    id: 'interval-timer' as TimerId,
                    remainingTicks: 5,
                    intervalTicks: 3,
                    actionType: 'game:tick_effect',
                    payload: { damage: 10, target: 'enemy-1' },
                    active: true,
                },
            },
        });

        // Tick 0: remainingTicks 5 → 4
        let tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 }, 0);
        snapshot = pipeline.process(snapshot, tickEnvelope);
        expect(snapshot.timers['interval-timer' as TimerId]?.remainingTicks).toBe(4);

        // Tick 1: remainingTicks 4 → 3
        snapshot = { ...snapshot, tick: 1 };
        tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 8 }, 1);
        snapshot = pipeline.process(snapshot, tickEnvelope);
        // Still counting down
        expect(snapshot.timers['interval-timer' as TimerId]?.remainingTicks).toBe(3);
        expect(snapshot.timers['interval-timer' as TimerId]?.active).toBe(true);

        // Verify payload is preserved through all ticks
        expect(snapshot.timers['interval-timer' as TimerId]?.payload).toEqual({
            damage: 10,
            target: 'enemy-1',
        });
        expect(snapshot.timers['interval-timer' as TimerId]?.intervalTicks).toBe(3);
    });

    it('serializes empty timer registry as empty object (backward compatible)', () => {
        const snapshot = makeSnapshot({ timers: {} });
        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });

        const result = pipeline.process(snapshot, tickEnvelope);

        expect(result.timers).toStrictEqual({});
        expect(Object.keys(result.timers)).toHaveLength(0);
    });

    it('preserves complex payload structures through multiple timers', () => {
        const complexPayload = {
            nested: { value: 123, flag: true },
            array: [1, 2, 3],
            string: 'test',
            number: 42,
        };

        const snapshot = makeSnapshot({
            timers: {
                ['complex-timer' as TimerId]: {
                    id: 'complex-timer' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 0,
                    actionType: 'game:complex_effect',
                    payload: complexPayload,
                    active: true,
                },
            },
        });

        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });
        const result = pipeline.process(snapshot, tickEnvelope);

        // Payload should be deep-equal to original (field by field check)
        expect(result.timers['complex-timer' as TimerId]?.payload).toEqual(complexPayload);
    });

    // Invariant #54: covers the "serialised, loaded, and replayed" clause of the
    // GameTimer rule.
    it('produces identical results when replayed from a JSON-serialized snapshot', () => {
        const originalSnapshot = makeSnapshot({
            timers: {
                ['serialized-timer' as TimerId]: {
                    id: 'serialized-timer' as TimerId,
                    remainingTicks: 3,
                    intervalTicks: 2,
                    actionType: 'game:tick_effect',
                    payload: { damage: 5, target: 'enemy-1' },
                    active: true,
                },
            },
        });

        // Save: serialize to JSON string (simulates persistence layer)
        const serialized = JSON.stringify(originalSnapshot);

        // Load: deserialize from JSON string (simulates restore from disk)
        const loaded = JSON.parse(serialized) as BaseGameSnapshot;

        // The loaded snapshot must be deep-equal to the original before processing
        expect(loaded).toEqual(originalSnapshot);

        // Replay: processing the loaded snapshot must produce the same result as
        // processing the in-memory original — proving serialize→load→replay fidelity.
        const tickEnvelope = makeEnvelope('engine:tick', hostId, { seed: 7 });
        const resultFromOriginal = pipeline.process(originalSnapshot, tickEnvelope);
        const resultFromLoaded = pipeline.process(loaded, tickEnvelope);

        expect(resultFromLoaded).toEqual(resultFromOriginal);
        expect(resultFromLoaded.timers['serialized-timer' as TimerId]?.remainingTicks).toBe(2);
        expect(resultFromLoaded.timers['serialized-timer' as TimerId]?.intervalTicks).toBe(2);
        expect(resultFromLoaded.timers['serialized-timer' as TimerId]?.payload).toEqual({
            damage: 5,
            target: 'enemy-1',
        });
    });
});

// ─── Fired one-shot removal (§4.20) ──────────────────────────────────────────

/**
 * A fired one-shot leaves `snapshot.timers` in the same `engine:tick` that
 * fired it. The registry is snapshot-resident, so a `{ active: false }`
 * tombstone would sit in every later save checkpoint for the rest of the
 * session — one dead entry per fire.
 *
 * Pre-existing inactive entries are NOT swept: a cancelled timer, or a
 * tombstone written by an engine that still left them behind, loads and is
 * skipped exactly as before, so no save migration is needed.
 */
describe('GameTimer integration — fired one-shot removal', () => {
    let pipeline: ActionPipeline;

    beforeEach(() => {
        const registry = new ActionRegistry();
        registerEngineActions(registry);
        registry.register({
            type: 'game:fired',
            parsePayload: () => ({}),
            validate: () => ({ ok: true }),
            reduce: (state) => ({ ...state, tick: state.tick + 1 }),
        } satisfies ActionDefinition<Record<string, never>>);
        pipeline = new ActionPipeline(registry);
    });

    it('drops the fired one-shot from snapshot.timers in the tick that fired it', () => {
        const snapshot = makeSnapshot({
            timers: {
                ['one-shot' as TimerId]: {
                    id: 'one-shot' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:fired',
                    payload: {},
                    active: true,
                },
            },
        });

        const next = pipeline.process(snapshot, makeEnvelope('engine:tick', hostId, { seed: 7 }));

        // The child dispatch ran (tick advanced twice) AND the entry is gone —
        // absent, not present-and-inactive.
        expect(next.tick).toBe(2);
        expect('one-shot' in next.timers).toBe(false);
        expect(next.timers).toEqual({});
    });

    it('keeps snapshot.timers by reference on the beat after the fire', () => {
        // With the entry removed the registry is `{}`, so the next beat takes
        // `TimerManager.advance`'s fast path and `engine:tick` writes no new
        // registry. A tombstone would have been skipped too, so this is not the
        // removal's killer (the unit test's `toEqual({})` is); it pins that
        // removal keeps the pipeline's clock-only broadcast reachable.
        const snapshot = makeSnapshot({
            timers: {
                ['one-shot' as TimerId]: {
                    id: 'one-shot' as TimerId,
                    remainingTicks: 1,
                    intervalTicks: 0,
                    actionType: 'game:fired',
                    payload: {},
                    active: true,
                },
            },
        });
        const afterFire = pipeline.process(
            snapshot,
            makeEnvelope('engine:tick', hostId, { seed: 7 }),
        );

        const afterIdle = pipeline.process(
            afterFire,
            makeEnvelope('engine:tick', hostId, { seed: 7 }, afterFire.tick),
        );

        expect(afterIdle.timers).toBe(afterFire.timers);
    });

    it('loads a checkpoint carrying a tombstone through the migrator and ignores it', () => {
        // A save written while fired one-shots were still tombstoned carries
        // `{ active: false }` entries. No migration strips them: the chain
        // leaves a current-version file untouched, the tombstone is skipped by
        // `advance()` as any inactive entry is, and the registry is kept by
        // reference because nothing in it is live.
        const tombstone = {
            id: 'spent' as TimerId,
            remainingTicks: 0,
            intervalTicks: 0,
            actionType: 'game:fired',
            payload: {},
            active: false,
        };
        const checkpoint = makeSnapshot({ timers: { [tombstone.id]: tombstone } });
        const file: SaveFile = {
            header: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'autosave',
                savedAt: 1_700_000_000_000,
                turnNumber: 0,
                playerNames: ['p1', 'p2'],
            },
            checkpoint,
            deltaActions: [],
            pendingCommitments: {},
            stagedReveals: {},
            session: {
                matchId: 'match-fixture',
                maxPlayers: 2,
                seats: [
                    { playerId: hostId, control: 'host', slotIndex: 0 },
                    { playerId: guestId, control: 'remote', slotIndex: 1 },
                ],
            },
        };

        const loaded = createDefaultMigrator().migrate(file);
        const next = pipeline.process(
            loaded.checkpoint,
            makeEnvelope('engine:tick', hostId, { seed: 7 }, loaded.checkpoint.tick),
        );

        expect(loaded.checkpoint.timers).toStrictEqual({ [tombstone.id]: tombstone });
        expect(next.timers).toBe(loaded.checkpoint.timers);
        expect(next.tick).toBe(loaded.checkpoint.tick + 1);
    });
});
