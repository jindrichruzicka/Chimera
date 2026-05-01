/**
 * simulation/engine/__tests__/UndoManager.integration.test.ts
 *
 * Integration tests for the full undo/redo subsystem:
 * ActionPipeline + InMemoryUndoManager + InMemoryActionHistory wired together.
 *
 * Acceptance criteria (issue #362):
 *   1. Dispatch 3 actions → engine:undo twice → snapshot tick equals state after 1st action
 *   2. engine:redo after double-undo restores state correctly
 *   3. undoMeta.canUndo is true before undo and false after undo history is exhausted
 *
 * Architecture reference: §4.5, §7
 * Issue: #362
 *
 * Tests written FIRST (red); implementation in UndoManager.ts.
 *
 * Invariants:
 *   #2  — No imports from renderer/, electron/, games/*, DOM
 *   #43 — No Math.random() or Date.now() — countingReplay is deterministic
 *   #7  — engine:undo/redo enter the pipeline normally via Stage 3 intercept
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionPipeline } from '../ActionPipeline.js';
import { ActionRegistry } from '../ActionRegistry.js';
import { registerEngineActions } from '../EngineActions.js';
import { InMemoryUndoManager, InMemoryActionHistory } from '../UndoManager.js';
import type { ActionHistoryEntry } from '../UndoManager.js';
import { DEFAULT_UNDO_POLICY } from '../UndoPolicy.js';
import type { ActionDefinition, ActionEnvelope, BaseGameSnapshot, PlayerId } from '../types.js';
import { playerId as toPlayerId } from '../types.js';

const P1 = toPlayerId('player-1');

/** Snapshot factory with a single known player so Stage 7 broadcast fires. */
const makeBaseSnapshot = (tick = 0): BaseGameSnapshot => ({
    tick,
    seed: 42,
    players: { [P1]: { id: P1 } },
    entities: {},
    phase: 'playing' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber: 0,
    timers: {},
});

/**
 * Deterministic counting replay:
 * `tick` of the result = memento tick + number of replay entries.
 * Mirrors `advanceDef.reduce` so undo/redo tick arithmetic is consistent.
 */
const countingReplay = (
    base: BaseGameSnapshot,
    entries: readonly ActionHistoryEntry[],
): BaseGameSnapshot => ({
    ...base,
    tick: base.tick + entries.length,
});

/**
 * Simple action definition that increments tick by 1 and produces
 * a new snapshot reference — required for Stage 7 broadcast to fire.
 */
const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

/** Helpers for building envelopes with the correct tick. */
const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

const undoEnvelope = (tick: number, steps = 1): ActionEnvelope => ({
    type: 'engine:undo',
    playerId: P1,
    tick,
    payload: { steps },
});

const redoEnvelope = (tick: number, steps = 1): ActionEnvelope => ({
    type: 'engine:redo',
    playerId: P1,
    tick,
    payload: { steps },
});

// ─── Integration tests ────────────────────────────────────────────────────────

describe('UndoManager + ActionPipeline integration', () => {
    let registry: ActionRegistry;
    let history: InMemoryActionHistory;
    let undoManager: InMemoryUndoManager;
    let pipeline: ActionPipeline;

    beforeEach(() => {
        registry = new ActionRegistry();
        registerEngineActions(registry);
        registry.register(advanceDef);

        history = new InMemoryActionHistory();
        undoManager = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, countingReplay);
        pipeline = new ActionPipeline(registry, {
            context: { undoManager, history },
        });
    });

    // Acceptance criterion 1: dispatch 3 actions, undo twice, verify state equals after 1st action

    it('dispatch 3 actions then engine:undo twice returns state matching state after 1st action', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        // Dispatch 3 advancing actions: tick 0→1→2→3
        const s1 = pipeline.process(s0, advanceEnvelope(0)); // tick = 1
        const s2 = pipeline.process(s1, advanceEnvelope(1)); // tick = 2
        const s3 = pipeline.process(s2, advanceEnvelope(2)); // tick = 3

        // First undo: history has [e0, e1, e2]; replay [e0, e1] → tick = 2
        const u1 = pipeline.process(s3, undoEnvelope(s3.tick));
        // Second undo: virtual history is [e0, e1]; replay [e0] → tick = 1
        const u2 = pipeline.process(u1, undoEnvelope(u1.tick));

        // u2 should equal s1 (state after 1st action)
        expect(u2.tick).toBe(s1.tick);
    });

    // Acceptance criterion 2: engine:redo after double-undo restores state correctly

    it('engine:redo after double-undo restores state to the intermediate state', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        const s1 = pipeline.process(s0, advanceEnvelope(0)); // tick = 1
        const s2 = pipeline.process(s1, advanceEnvelope(1)); // tick = 2
        const s3 = pipeline.process(s2, advanceEnvelope(2)); // tick = 3

        // Double undo: tick 3 → 2 → 1
        const u1 = pipeline.process(s3, undoEnvelope(s3.tick));
        const u2 = pipeline.process(u1, undoEnvelope(u1.tick));

        // Redo one step: replay [e0, e1] → tick = 2 (= s2.tick)
        const r1 = pipeline.process(u2, redoEnvelope(u2.tick));
        expect(r1.tick).toBe(s2.tick);
    });

    // Acceptance criterion 3: undoMeta.canUndo transitions correctly in broadcast snapshots

    it('undoMeta.canUndo is true before undo and false after undo history is exhausted', () => {
        const capturedByPlayer = new Map<PlayerId, Readonly<Record<string, unknown>>>();

        const p = new ActionPipeline(registry, {
            context: {
                undoManager,
                history,
                broadcast: (snap, to) => {
                    capturedByPlayer.set(to, snap);
                },
            },
        });

        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        // After dispatching one action, undoMeta.canUndo should be true
        const s1 = p.process(s0, advanceEnvelope(0));
        const afterAction = capturedByPlayer.get(P1) as {
            undoMeta: { canUndo: boolean; canRedo: boolean };
        };
        expect(afterAction?.undoMeta.canUndo).toBe(true);

        // After undoing the single action, history is exhausted — canUndo must be false
        p.process(s1, undoEnvelope(s1.tick));
        const afterUndo = capturedByPlayer.get(P1) as {
            undoMeta: { canUndo: boolean; canRedo: boolean };
        };
        expect(afterUndo?.undoMeta.canUndo).toBe(false);
        expect(afterUndo?.undoMeta.canRedo).toBe(true);
    });

    // Additional integration: clearUndoHistory disables undo across the pipeline boundary

    it('clearUndoHistory disables engine:undo interception for that player', () => {
        const s0 = makeBaseSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);

        pipeline.process(s0, advanceEnvelope(0));
        expect(undoManager.canUndo(P1)).toBe(true);

        undoManager.clearUndoHistory(P1);
        expect(undoManager.canUndo(P1)).toBe(false);
    });
});
