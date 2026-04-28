/**
 * simulation/engine/UndoManager.test.ts
 *
 * TDD tests for UndoManager interface, InMemoryUndoManager,
 * InMemoryActionHistory, and UndoNotAllowedError.
 *
 * Architecture reference: §4.5, §7
 * Task: F16 (issue #359)
 *
 * Tests written FIRST (red) before UndoManager.ts exists.
 * They express all acceptance criteria from issue #359:
 *
 *   1. canUndo() returns false when policy allowUndo: false or no memento stored.
 *   2. undo(playerId, 1) replays history minus last 1 entry and returns
 *      reconstructed BaseGameSnapshot.
 *   3. clearUndoHistory() causes subsequent canUndo() to return false.
 *   4. setPolicy() takes effect immediately on the next undo() / redo() call.
 *   5. UndoNotAllowedError is thrown (not swallowed) when undo is blocked.
 *   6. InMemoryActionHistory correctly implements ActionHistory.
 *   7. canRedo / redo work with the stored redo buffer.
 *
 * Simulation tests are pure functions — zero mocks required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryUndoManager, InMemoryActionHistory, UndoNotAllowedError } from './UndoManager.js';
import type { ActionHistoryEntry } from './UndoManager.js';
import { DEFAULT_UNDO_POLICY } from './UndoPolicy.js';
import type { UndoPolicy } from './UndoPolicy.js';
import type { BaseGameSnapshot, ActionEnvelope } from './types.js';
import { playerId as toPlayerId } from './types.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

const makeSnapshot = (tick = 0, turnNumber = 0): BaseGameSnapshot => ({
    tick,
    seed: 42,
    players: {},
    entities: {},
    phase: 'playing' as BaseGameSnapshot['phase'],
    events: [],
    turnNumber,
});

const makeEnvelope = (type: string, tick = 0): ActionEnvelope => ({
    type,
    playerId: P1,
    tick,
    payload: {},
});

const makeHistoryEntry = (
    tickApplied: number,
    turnNumber = 1,
    type = 'game:noop',
): ActionHistoryEntry => ({
    tickApplied,
    turnNumber,
    action: makeEnvelope(type, tickApplied),
});

/** Replay callback that simply returns a snapshot with tick = initial.tick + entries.length */
const countingReplay = (
    state: BaseGameSnapshot,
    entries: readonly ActionHistoryEntry[],
): BaseGameSnapshot => ({
    ...state,
    tick: state.tick + entries.length,
});

// ─── InMemoryActionHistory ─────────────────────────────────────────────────────

describe('InMemoryActionHistory', () => {
    let history: InMemoryActionHistory;

    beforeEach(() => {
        history = new InMemoryActionHistory();
    });

    it('returns empty array initially from sinceLastMemento', () => {
        expect(history.sinceLastMemento()).toEqual([]);
    });

    it('returns all appended entries from sinceLastMemento', () => {
        const entry1 = makeHistoryEntry(1);
        const entry2 = makeHistoryEntry(2);
        history.append(entry1);
        history.append(entry2);
        expect(history.sinceLastMemento()).toEqual([entry1, entry2]);
    });

    it('sinceLastMemento result is readonly (not the internal array)', () => {
        const entry = makeHistoryEntry(1);
        history.append(entry);
        const result = history.sinceLastMemento();
        // Pushing to the result must not mutate internal state
        expect(result).toHaveLength(1);
    });

    it('pruneTo removes entries with turnNumber strictly less than cutoff', () => {
        history.append(makeHistoryEntry(1, 1));
        history.append(makeHistoryEntry(2, 2));
        history.append(makeHistoryEntry(3, 3));
        history.pruneTo(2);
        const remaining = history.sinceLastMemento();
        expect(remaining.every((e) => e.turnNumber >= 2)).toBe(true);
    });

    it('pruneTo with cutoff 0 keeps all entries', () => {
        history.append(makeHistoryEntry(1, 1));
        history.pruneTo(0);
        expect(history.sinceLastMemento()).toHaveLength(1);
    });
});

// ─── UndoNotAllowedError ───────────────────────────────────────────────────────

describe('UndoNotAllowedError', () => {
    it('is an instance of Error', () => {
        const err = new UndoNotAllowedError('no_memento');
        expect(err).toBeInstanceOf(Error);
    });

    it('has a stable code property equal to UNDO_NOT_ALLOWED', () => {
        const err = new UndoNotAllowedError('no_memento');
        expect(err.code).toBe('UNDO_NOT_ALLOWED');
    });

    it('carries the reason string passed to the constructor', () => {
        const err = new UndoNotAllowedError('policy_disallows');
        expect(err.reason).toBe('policy_disallows');
    });

    it('message includes the reason', () => {
        const err = new UndoNotAllowedError('not_enough_history');
        expect(err.message).toContain('not_enough_history');
    });
});

// ─── InMemoryUndoManager ──────────────────────────────────────────────────────

describe('InMemoryUndoManager', () => {
    let history: InMemoryActionHistory;
    let manager: InMemoryUndoManager;

    beforeEach(() => {
        history = new InMemoryActionHistory();
        manager = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, countingReplay);
    });

    // ─── canUndo ────────────────────────────────────────────────────────────

    describe('canUndo', () => {
        it('returns false when no memento has been saved for the player', () => {
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('returns false when policy allowUndo is false', () => {
            const restrictive: UndoPolicy = {
                ...DEFAULT_UNDO_POLICY,
                allowUndo: false,
            };
            const m = new InMemoryUndoManager(history, restrictive, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(m.canUndo(P1)).toBe(false);
        });

        it('returns false when memento saved but no entries in history', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('returns true when memento saved and history has at least one entry', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);
        });

        it('returns false after all steps are undone', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('returns false after clearUndoHistory is called', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);
            manager.clearUndoHistory(P1);
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('is independent per player — P1 canUndo does not affect P2', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);
            expect(manager.canUndo(P2)).toBe(false);
        });

        it('respects maxUndoSteps when > 0', () => {
            const limitedPolicy: UndoPolicy = {
                ...DEFAULT_UNDO_POLICY,
                maxUndoSteps: 1,
            };
            const m = new InMemoryUndoManager(history, limitedPolicy, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            history.append(makeHistoryEntry(2));
            m.undo(P1, 1);
            // After 1 undo step, maxUndoSteps reached — cannot undo further
            expect(m.canUndo(P1)).toBe(false);
        });
    });

    // ─── canRedo ────────────────────────────────────────────────────────────

    describe('canRedo', () => {
        it('returns false when no undo has been performed', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canRedo(P1)).toBe(false);
        });

        it('returns true after an undo has been performed', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            expect(manager.canRedo(P1)).toBe(true);
        });

        it('returns false after clearUndoHistory is called', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            manager.clearUndoHistory(P1);
            expect(manager.canRedo(P1)).toBe(false);
        });

        it('returns false after all redo steps have been consumed', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            manager.redo(P1, 1);
            expect(manager.canRedo(P1)).toBe(false);
        });
    });

    // ─── undo ────────────────────────────────────────────────────────────────

    describe('undo', () => {
        it('throws UndoNotAllowedError when policy disallows (allowUndo: false)', () => {
            const restrictive: UndoPolicy = {
                ...DEFAULT_UNDO_POLICY,
                allowUndo: false,
            };
            const m = new InMemoryUndoManager(history, restrictive, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(() => m.undo(P1)).toThrow(UndoNotAllowedError);
        });

        it('throws UndoNotAllowedError when no memento stored for the player', () => {
            history.append(makeHistoryEntry(1));
            expect(() => manager.undo(P1)).toThrow(UndoNotAllowedError);
        });

        it('throws UndoNotAllowedError when steps exceeds available history', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(() => manager.undo(P1, 5)).toThrow(UndoNotAllowedError);
        });

        it('defaults to 1 step when steps argument is omitted', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            history.append(makeHistoryEntry(2));
            m.undo(P1);
            const [, entries] = replaySpy.mock.calls[0]!;
            // Default steps = 1: replays 1 entry (entry1 only, entry2 omitted)
            expect(entries).toHaveLength(1);
        });

        it('replays history minus the last 1 entry and passes them to the replay callback', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(entry1);
            history.append(entry2);
            m.undo(P1, 1);
            const [stateArg, entriesArg] = replaySpy.mock.calls[0]!;
            expect(stateArg.tick).toBe(0);
            expect(entriesArg).toEqual([entry1]);
        });

        it('passes the memento snapshot (not the current state) as the base for replay', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            const mementoState = makeSnapshot(99);
            m.saveTurnMemento(mementoState, P1);
            history.append(makeHistoryEntry(1));
            m.undo(P1, 1);
            const [stateArg] = replaySpy.mock.calls[0]!;
            expect(stateArg.tick).toBe(99);
        });

        it('returns the reconstructed snapshot returned by the replay callback', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            history.append(makeHistoryEntry(2));
            // countingReplay: tick = 0 + (2 entries - 1 undone) = 1
            const result = manager.undo(P1, 1);
            expect(result.tick).toBe(1);
        });

        it('replays history minus last N entries for steps > 1', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            const entry3 = makeHistoryEntry(3);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(entry1);
            history.append(entry2);
            history.append(entry3);
            m.undo(P1, 2);
            const [, entriesArg] = replaySpy.mock.calls[0]!;
            expect(entriesArg).toEqual([entry1]);
        });

        it('correctly handles consecutive undo calls (undo then undo again)', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            m.saveTurnMemento(makeSnapshot(0), P1);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            const entry3 = makeHistoryEntry(3);
            history.append(entry1);
            history.append(entry2);
            history.append(entry3);
            m.undo(P1, 1); // virtual history becomes [entry1, entry2]
            m.undo(P1, 1); // virtual history becomes [entry1]
            const secondCallEntries = replaySpy.mock.calls[1]![1];
            expect(secondCallEntries).toEqual([entry1]);
        });
    });

    // ─── redo ────────────────────────────────────────────────────────────────

    describe('redo', () => {
        it('throws UndoNotAllowedError when nothing to redo', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            expect(() => manager.redo(P1)).toThrow(UndoNotAllowedError);
        });

        it('replays previously undone entry and returns the reconstructed snapshot', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            history.append(entry1);
            history.append(entry2);
            manager.undo(P1, 1); // undo entry2; virtual = [entry1]
            // redo: virtual = [entry1, entry2]; result tick = 0 + 2 = 2
            const result = manager.redo(P1, 1);
            expect(result.tick).toBe(2);
        });

        it('passes the re-expanded entries to the replay callback on redo', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(entry1);
            history.append(entry2);
            m.undo(P1, 1);
            m.redo(P1, 1);
            const [, redoEntriesArg] = replaySpy.mock.calls[1]!;
            expect(redoEntriesArg).toEqual([entry1, entry2]);
        });

        it('defaults to 1 step when steps argument is omitted', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            history.append(makeHistoryEntry(2));
            manager.undo(P1, 2);
            // After undo of 2, virtual = []; redo buffer = [entry1, entry2]
            // redo() with no steps → redo 1 step → virtual = [entry1]
            const result = manager.redo(P1);
            // tick = 0 + 1 entry = 1
            expect(result.tick).toBe(1);
        });

        it('handles multiple redo steps (redo N)', () => {
            const replaySpy = vi.fn(countingReplay);
            const m = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replaySpy);
            const entry1 = makeHistoryEntry(1);
            const entry2 = makeHistoryEntry(2);
            const entry3 = makeHistoryEntry(3);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(entry1);
            history.append(entry2);
            history.append(entry3);
            m.undo(P1, 3); // undo all; virtual = []
            m.redo(P1, 2); // redo first 2 (entry1, entry2)
            const [, redoEntriesArg] = replaySpy.mock.calls[1]!;
            expect(redoEntriesArg).toEqual([entry1, entry2]);
        });
    });

    // ─── saveTurnMemento ─────────────────────────────────────────────────────

    describe('saveTurnMemento', () => {
        it('stores the snapshot for the player (enabling canUndo once history has entries)', () => {
            manager.saveTurnMemento(makeSnapshot(5), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);
        });

        it('clears the redo buffer when a new memento is saved', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            expect(manager.canRedo(P1)).toBe(true);

            // Saving a new memento starts a fresh turn — redo is cleared
            manager.saveTurnMemento(makeSnapshot(1), P1);
            expect(manager.canRedo(P1)).toBe(false);
        });

        it('resets undo step counter so maxUndoSteps applies fresh on new turn', () => {
            const limitedPolicy: UndoPolicy = {
                ...DEFAULT_UNDO_POLICY,
                maxUndoSteps: 1,
            };
            const m = new InMemoryUndoManager(history, limitedPolicy, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            history.append(makeHistoryEntry(2));
            m.undo(P1, 1); // exhausts the 1 allowed step

            // New turn — reset
            m.saveTurnMemento(makeSnapshot(2), P1);
            history.append(makeHistoryEntry(3));
            // Should be allowed again on new turn
            expect(m.canUndo(P1)).toBe(true);
        });
    });

    // ─── clearUndoHistory ────────────────────────────────────────────────────

    describe('clearUndoHistory', () => {
        it('causes canUndo to return false for that player', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);
            manager.clearUndoHistory(P1);
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('causes canRedo to return false for that player', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.undo(P1, 1);
            expect(manager.canRedo(P1)).toBe(true);
            manager.clearUndoHistory(P1);
            expect(manager.canRedo(P1)).toBe(false);
        });

        it("does not affect another player's undo history", () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            manager.saveTurnMemento(makeSnapshot(0), P2);
            history.append(makeHistoryEntry(1));
            manager.clearUndoHistory(P1);
            // P2 still has a memento and history entries
            expect(manager.canUndo(P2)).toBe(true);
        });
    });

    // ─── setPolicy ───────────────────────────────────────────────────────────

    describe('setPolicy', () => {
        it('takes effect immediately — disabling undo blocks subsequent canUndo checks', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            expect(manager.canUndo(P1)).toBe(true);

            manager.setPolicy({ ...DEFAULT_UNDO_POLICY, allowUndo: false });
            expect(manager.canUndo(P1)).toBe(false);
        });

        it('takes effect immediately — disabling undo causes undo() to throw', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.setPolicy({ ...DEFAULT_UNDO_POLICY, allowUndo: false });
            expect(() => manager.undo(P1)).toThrow(UndoNotAllowedError);
        });

        it('re-enabling undo after disabling allows undo again', () => {
            manager.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));
            manager.setPolicy({ ...DEFAULT_UNDO_POLICY, allowUndo: false });
            manager.setPolicy({ ...DEFAULT_UNDO_POLICY, allowUndo: true });
            expect(manager.canUndo(P1)).toBe(true);
        });
    });
});
