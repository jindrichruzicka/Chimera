/**
 * simulation/engine/prediction/ReconcileBuffer.test.ts
 *
 * Tests written first (red phase) per TDD mandate — ReconcileBuffer.ts does
 * not exist yet.
 *
 * Architecture reference: §6 — simulation/prediction/ · Client Prediction
 * Task: F18 (issue #367)
 *
 * Acceptance criteria (from issue #367):
 *   ✓ reconcile() returns authoritative snapshot when buffer is empty
 *   ✓ reconcile() replays one unconfirmed action (tick > snapshot.tick) and
 *     returns the predicted snapshot
 *   ✓ reconcile() evicts a confirmed entry (tick <= snapshot.tick) and does
 *     not replay it
 *   ✓ clear() empties the buffer; subsequent reconcile() returns snapshot
 *     unchanged
 *   ✓ pendingCount reflects accurate queue depth after enqueue/reconcile/clear
 *   ✓ No imports from renderer/, electron/, games/*, or any DOM API
 *   ✓ pnpm typecheck exits 0 on the new file
 *
 * Invariants upheld:
 *   #1 — simulation/ is side-effect-free; no Node.js or Electron imports.
 *   #2 — applyAction/definition.reduce are pure — reconcile replay must not
 *         produce side effects.
 *   #3 — GameSnapshot never leaves the main process — ReconcileBuffer
 *         operates on BaseGameSnapshot only.
 *   #43 — No Math.random, Date.now, performance.now inside the buffer.
 */

import { describe, it, expect } from 'vitest';

import { ReconcileBuffer, MAX_BUFFER_DEPTH } from './ReconcileBuffer.js';
import { ClientPredictor } from './ClientPredictor.js';
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

// ─── Test helpers ─────────────────────────────────────────────────────────────

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

function makeAction(
    type: string,
    tick: number,
    playerId: PlayerId = toPlayerId('p1'),
): EngineAction {
    return {
        type,
        playerId,
        tick,
        payload: {},
    };
}

function makeStubCtx(): ReduceContext {
    return { rng: makeStubRng() };
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

function makeRegistryWithPredictable(type: string): ActionRegistry<TestSnapshot> {
    const registry = new ActionRegistry<TestSnapshot>();
    registry.register(makePredictableDefinition(type));
    return registry;
}

function makePredictor(type: string): ClientPredictor<TestSnapshot> {
    const registry = makeRegistryWithPredictable(type);
    return new ClientPredictor<TestSnapshot>(registry, makeStubCtx());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReconcileBuffer', () => {
    describe('construction', () => {
        it('starts with pendingCount of 0', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            expect(buffer.pendingCount).toBe(0);
        });
    });

    describe('enqueue()', () => {
        it('increments pendingCount by 1 for each enqueued action', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();

            buffer.enqueue(makeAction('test:move', 1));
            expect(buffer.pendingCount).toBe(1);

            buffer.enqueue(makeAction('test:move', 2));
            expect(buffer.pendingCount).toBe(2);
        });

        it('evicts the oldest entry (with a warning log) when MAX_BUFFER_DEPTH is exceeded', () => {
            const warnMessages: string[] = [];
            const warnContexts: Record<string, unknown>[] = [];
            const stubLogger = {
                trace: () => undefined,
                debug: () => undefined,
                info: () => undefined,
                warn: (msg: string, ctx?: Record<string, unknown>) => {
                    warnMessages.push(msg);
                    if (ctx !== undefined) warnContexts.push(ctx);
                },
                error: () => undefined,
                fatal: () => undefined,
                child: () => stubLogger,
            };

            const buffer = new ReconcileBuffer<TestSnapshot>({ logger: stubLogger });

            // Fill exactly to the depth limit; tick=1 is the oldest action
            for (let i = 1; i <= MAX_BUFFER_DEPTH; i++) {
                buffer.enqueue(makeAction('test:move', i));
            }
            expect(buffer.pendingCount).toBe(MAX_BUFFER_DEPTH);
            expect(warnMessages).toHaveLength(0);

            // One more should evict tick=1 (the oldest), not the incoming action
            buffer.enqueue(makeAction('test:different', MAX_BUFFER_DEPTH + 1));
            expect(buffer.pendingCount).toBe(MAX_BUFFER_DEPTH);
            expect(warnMessages).toHaveLength(1);
            expect(warnMessages[0]).toMatch(/evict/i);
            // evictedActionType must be the evicted action's type, not the incoming one
            expect(warnContexts[0]).toMatchObject({ evictedActionType: 'test:move' });
        });
    });

    describe('reconcile()', () => {
        it('returns the authoritative snapshot unchanged when buffer is empty', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');
            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });

            const result = buffer.reconcile(snapshot, predictor);

            expect(result).toBe(snapshot);
        });

        it('replays one unconfirmed action (tick > snapshot.tick) and returns the predicted snapshot', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            // snapshot.tick = 5; action.tick = 6 → unconfirmed
            buffer.enqueue(makeAction('test:move', 6));
            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });

            const result = buffer.reconcile(snapshot, predictor);

            // value should be incremented by 1 (replay of the pending action)
            expect(result.value).toBe(11);
            // The action is still pending (not yet confirmed)
            expect(buffer.pendingCount).toBe(1);
        });

        it('evicts a confirmed entry (tick <= snapshot.tick) and does not replay it', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            // action.tick = 3 ≤ snapshot.tick = 5 → confirmed, should be evicted
            buffer.enqueue(makeAction('test:move', 3));
            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });

            const result = buffer.reconcile(snapshot, predictor);

            // value stays at 10 because the confirmed action is evicted, not replayed
            expect(result.value).toBe(10);
            // buffer is now empty after eviction
            expect(buffer.pendingCount).toBe(0);
        });

        it('evicts all confirmed entries and replays only unconfirmed ones', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            // tick <= 5 → confirmed (evict); tick > 5 → unconfirmed (replay)
            buffer.enqueue(makeAction('test:move', 3)); // confirmed
            buffer.enqueue(makeAction('test:move', 5)); // confirmed (tick == snapshot.tick)
            buffer.enqueue(makeAction('test:move', 6)); // unconfirmed
            buffer.enqueue(makeAction('test:move', 7)); // unconfirmed

            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });

            const result = buffer.reconcile(snapshot, predictor);

            // Only 2 unconfirmed actions replayed → value incremented twice
            expect(result.value).toBe(12);
            // 2 unconfirmed actions remain pending
            expect(buffer.pendingCount).toBe(2);
        });

        it('returns the authoritative snapshot when all buffered actions are confirmed', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            buffer.enqueue(makeAction('test:move', 1));
            buffer.enqueue(makeAction('test:move', 2));

            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });

            const result = buffer.reconcile(snapshot, predictor);

            expect(result.value).toBe(10);
            expect(buffer.pendingCount).toBe(0);
        });

        it('does not mutate the input snapshot', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            buffer.enqueue(makeAction('test:move', 6));
            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });
            const originalValue = snapshot.value;

            buffer.reconcile(snapshot, predictor);

            expect(snapshot.value).toBe(originalValue);
        });
    });

    describe('clear()', () => {
        it('empties the buffer; subsequent reconcile() returns snapshot unchanged', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            const predictor = makePredictor('test:move');

            buffer.enqueue(makeAction('test:move', 6));
            buffer.enqueue(makeAction('test:move', 7));
            expect(buffer.pendingCount).toBe(2);

            buffer.clear();

            expect(buffer.pendingCount).toBe(0);

            const snapshot = makeBaseSnapshot({ tick: 5, value: 10 });
            const result = buffer.reconcile(snapshot, predictor);

            expect(result.value).toBe(10);
            expect(result).toBe(snapshot);
        });

        it('is safe to call on an already-empty buffer', () => {
            const buffer = new ReconcileBuffer<TestSnapshot>();
            expect(() => buffer.clear()).not.toThrow();
            expect(buffer.pendingCount).toBe(0);
        });
    });

    describe('MAX_BUFFER_DEPTH', () => {
        it('is 32', () => {
            expect(MAX_BUFFER_DEPTH).toBe(32);
        });
    });
});
