/**
 * electron/main/__tests__/undo-wiring.integration.test.ts
 *
 * Integration tests for the electron/main host-session undo wiring.
 *
 * Verifies that `buildHostSessionPipeline` correctly wires
 * `InMemoryActionHistory` and `InMemoryUndoManager` into `ActionPipeline`
 * via `PipelineContext`, so that:
 *   - broadcast snapshots carry live `undoMeta` values, and
 *   - `engine:undo` enters Stage 3 intercept (not the no-op fallback).
 *
 * Architecture: §4.5, §4.7, §7 — UndoManager, PipelineContext, ActionPipeline
 *   host bootstrap.
 * Issue: #364
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/runtime/HostSessionPipeline.ts`.
 *
 * Invariants verified:
 *   #2  — No imports from renderer/, games/*, DOM APIs
 *   #7  — engine:undo enters the pipeline via Stage 3 intercept when wired
 *   #43 — replay callback is pure (no Math.random(), no Date.now())
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';

// ── Type helpers ───────────────────────────────────────────────────────────────

/**
 * Extracts `undoMeta` from a broadcast snapshot (BaseGameSnapshot with injected undoMeta).
 *
 * Since the broadcast callback now receives BaseGameSnapshot without undoMeta,
 * the test injects undoMeta in the broadcast callback. This helper extracts it.
 */
function undoMetaOf(
    snap: BaseGameSnapshot & { undoMeta: { canUndo: boolean; canRedo: boolean } },
): {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
} {
    return snap.undoMeta;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

function makeBaseSnapshot(tick = 0, playerIds: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(playerIds.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

function makeTurnSnapshot(tick = 0): BaseGameSnapshot {
    return {
        ...makeBaseSnapshot(tick, [P1, P2]),
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
    };
}

/**
 * Simple action that increments tick by 1.
 * Produces a new snapshot reference — required for Stage 7 broadcast to fire.
 */
const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

const undoEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:undo',
    playerId: P1,
    tick,
    payload: {},
});

const redoEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:redo',
    playerId: P1,
    tick,
    payload: {},
});

const endTurnEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:end_turn',
    playerId: P1,
    tick,
    payload: {},
});

function makeRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(advanceDef);
    return registry;
}

// ── buildHostSessionPipeline — basic wiring ────────────────────────────────────

describe('buildHostSessionPipeline — wiring contract', () => {
    it('returns a pipeline, undoManager, and clearUndoHistory teardown', () => {
        const broadcastFn = vi.fn();
        const { pipeline, undoManager, clearUndoHistory } = buildHostSessionPipeline(
            makeRegistry(),
            broadcastFn,
        );

        expect(pipeline).toBeDefined();
        expect(undoManager).toBeDefined();
        expect(clearUndoHistory).toBeTypeOf('function');
    });

    it('pipeline processes actions without throwing', () => {
        const broadcastFn = vi.fn();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), broadcastFn);

        const s0 = makeBaseSnapshot(0);
        expect(() => pipeline.process(s0, advanceEnvelope(0))).not.toThrow();
    });
});

// ── AC2 — canUndo transitions to true after a non-trivial action ───────────────

describe('buildHostSessionPipeline — AC2: canUndo transitions to true', () => {
    let capturedByPlayer: Map<
        PlayerId,
        BaseGameSnapshot & { undoMeta: { canUndo: boolean; canRedo: boolean } }
    >;
    let pipeline: ReturnType<typeof buildHostSessionPipeline>['pipeline'];
    let undoManager: ReturnType<typeof buildHostSessionPipeline>['undoManager'];
    let clearUndoHistory: ReturnType<typeof buildHostSessionPipeline>['clearUndoHistory'];

    beforeEach(() => {
        capturedByPlayer = new Map();
        const capturedUndoManager: {
            current: ReturnType<typeof buildHostSessionPipeline>['undoManager'] | null;
        } = { current: null };
        const result = buildHostSessionPipeline(makeRegistry(), (snap, to) => {
            const manager = capturedUndoManager.current;
            if (manager === null) {
                throw new Error('undoManager must be initialized before broadcast callback use');
            }
            // Simulate StateBroadcaster: compute undoMeta and attach it
            const undoMeta = {
                canUndo: manager.canUndo(to),
                canRedo: manager.canRedo(to),
            };
            capturedByPlayer.set(to, {
                // safe: BaseGameSnapshot has no index signature; spread in test double to attach undoMeta
                ...(snap as Record<string, unknown>),
                undoMeta,
            } as BaseGameSnapshot & { undoMeta: { canUndo: boolean; canRedo: boolean } });
        });
        pipeline = result.pipeline;
        undoManager = result.undoManager;
        capturedUndoManager.current = result.undoManager;
        clearUndoHistory = result.clearUndoHistory;
    });

    it('broadcast snapshot carries undoMeta.canUndo=false before any action', () => {
        const s0 = makeBaseSnapshot(0);
        pipeline.process(s0, advanceEnvelope(0));

        // canUndo is false because no memento has been saved yet
        const snap = capturedByPlayer.get(P1);
        expect(snap).toBeDefined();
        expect(undoMetaOf(snap!).canUndo).toBe(false);
    });

    it('broadcast snapshot carries undoMeta.canUndo=true after saveTurnMemento + one action', () => {
        const s0 = makeBaseSnapshot(0);
        // saveTurnMemento establishes the undo baseline for the player's turn.
        // In production this is called when the first turn starts.
        undoManager.saveTurnMemento(s0, P1);

        pipeline.process(s0, advanceEnvelope(0));

        const snap = capturedByPlayer.get(P1);
        expect(snap).toBeDefined();
        expect(undoMetaOf(snap!).canUndo).toBe(true);
        expect(undoMetaOf(snap!).canRedo).toBe(false);
    });

    it('broadcast snapshot carries correct undoMeta after multiple actions', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0));
        const s2 = pipeline.process(s1, advanceEnvelope(1));

        // After two actions, canUndo is true, canRedo is false
        const afterS2 = capturedByPlayer.get(P1);
        expect(undoMetaOf(afterS2!).canUndo).toBe(true);
        expect(undoMetaOf(afterS2!).canRedo).toBe(false);

        void s2; // s2 available for further processing
    });

    it('clearUndoHistory removes canUndo eligibility for the specified players', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        pipeline.process(s0, advanceEnvelope(0));
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canUndo).toBe(true);

        clearUndoHistory([P1]);

        // After clear, canUndo is immediately disabled
        expect(undoManager.canUndo(P1)).toBe(false);
    });

    it('engine:end_turn broadcast carries cleared canUndo for the ending player', () => {
        const s0 = makeTurnSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0));
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canUndo).toBe(true);

        pipeline.process(s1, endTurnEnvelope(s1.tick));

        expect(undoMetaOf(capturedByPlayer.get(P1)!).canUndo).toBe(false);
    });

    it('engine:end_turn broadcast carries cleared canRedo for the ending player', () => {
        const s0 = makeTurnSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0));
        const afterUndo = pipeline.process(s1, undoEnvelope(s1.tick));
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canRedo).toBe(true);

        pipeline.process(afterUndo, endTurnEnvelope(afterUndo.tick));

        expect(undoMetaOf(capturedByPlayer.get(P1)!).canRedo).toBe(false);
    });
});

// ── AC3 — engine:undo round-trip via Stage 3 intercept ───────────────────────

describe('buildHostSessionPipeline — AC3: engine:undo Stage 3 intercept', () => {
    let capturedByPlayer: Map<
        PlayerId,
        BaseGameSnapshot & { undoMeta: { canUndo: boolean; canRedo: boolean } }
    >;
    let pipeline: ReturnType<typeof buildHostSessionPipeline>['pipeline'];
    let undoManager: ReturnType<typeof buildHostSessionPipeline>['undoManager'];

    beforeEach(() => {
        capturedByPlayer = new Map();
        const capturedUndoManager: {
            current: ReturnType<typeof buildHostSessionPipeline>['undoManager'] | null;
        } = { current: null };
        const result = buildHostSessionPipeline(makeRegistry(), (snap, to) => {
            const manager = capturedUndoManager.current;
            if (manager === null) {
                throw new Error('undoManager must be initialized before broadcast callback use');
            }
            // Simulate StateBroadcaster: compute undoMeta and attach it
            const undoMeta = {
                canUndo: manager.canUndo(to),
                canRedo: manager.canRedo(to),
            };
            capturedByPlayer.set(to, {
                // safe: BaseGameSnapshot has no index signature; spread in test double to attach undoMeta
                ...(snap as Record<string, unknown>),
                undoMeta,
            } as BaseGameSnapshot & { undoMeta: { canUndo: boolean; canRedo: boolean } });
        });
        pipeline = result.pipeline;
        undoManager = result.undoManager;
        capturedUndoManager.current = result.undoManager;
    });

    it('engine:undo transitions canUndo to false after history is exhausted', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0));

        // After one action, canUndo is true
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canUndo).toBe(true);

        // engine:undo short-circuits at Stage 3 (not the no-op fallback)
        pipeline.process(s1, undoEnvelope(s1.tick));

        // After undoing the single action, history is exhausted — canUndo must be false
        const afterUndo = capturedByPlayer.get(P1);
        expect(afterUndo).toBeDefined();
        expect(undoMetaOf(afterUndo!).canUndo).toBe(false);
        // canRedo is true because we can redo the undone action
        expect(undoMetaOf(afterUndo!).canRedo).toBe(true);
    });

    it('engine:undo restores prior tick (Stage 3 intercept reconstructs state)', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0)); // tick 0→1
        const s2 = pipeline.process(s1, advanceEnvelope(1)); // tick 1→2

        // Undo one step: should restore state from after s1 (tick=1)
        const afterUndo = pipeline.process(s2, undoEnvelope(s2.tick));

        // Stage 3 intercept reconstructed the state from UndoManager
        expect(afterUndo.tick).toBe(s1.tick);
    });

    it('engine:redo after engine:undo restores canRedo=false', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0));
        const afterUndo = pipeline.process(s1, undoEnvelope(s1.tick));

        // After undo, canRedo is true
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canRedo).toBe(true);

        // Redo the action
        pipeline.process(afterUndo, redoEnvelope(afterUndo.tick));

        // After redo, canRedo is false again
        expect(undoMetaOf(capturedByPlayer.get(P1)!).canRedo).toBe(false);
    });

    it('engine:undo does NOT fall through to the no-op stub (state changes)', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0)); // tick = 1

        // If Stage 3 fires the real intercept, undoManager.undo() is called
        // and the returned state tick will be 0 (back to memento), not 1.
        // If it fell through to the no-op stub, tick would remain 1.
        const s0Restored = pipeline.process(s1, undoEnvelope(s1.tick));
        expect(s0Restored.tick).toBe(s0.tick); // Must be 0, not 1
    });

    it('undoMeta is derived per-viewer — P2 canUndo is independent of P1', () => {
        const s0 = makeBaseSnapshot(0, [P1, P2]);
        undoManager.saveTurnMemento(s0, P1);
        // P2 has no memento saved → canUndo remains false

        pipeline.process(s0, advanceEnvelope(0));

        const p1snap = capturedByPlayer.get(P1);
        const p2snap = capturedByPlayer.get(P2);

        expect(undoMetaOf(p1snap!).canUndo).toBe(true);
        expect(undoMetaOf(p2snap!).canUndo).toBe(false);
    });
});
