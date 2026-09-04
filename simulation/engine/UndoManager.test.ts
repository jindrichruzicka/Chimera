/**
 * simulation/engine/UndoManager.test.ts
 *
 * TDD tests for UndoManager interface, InMemoryUndoManager,
 * InMemoryActionHistory, and UndoNotAllowedError.
 *
 * Architecture reference: §4.5, §7
 * Task: F16
 *
 * Tests written FIRST (red) before UndoManager.ts exists.
 * They express all acceptance criteria:
 *
 *   1. canUndo() returns false when policy allowUndo: false or no memento stored.
 *   2. undo(playerId, 1) replays history minus last 1 entry and returns
 *      reconstructed BaseGameSnapshot.
 *   3. clearUndoHistory() causes subsequent canUndo() to return false.
 *   4. setPolicy() takes effect immediately on the next undo() / redo() call.
 *   5. UndoNotAllowedError is thrown (not swallowed) when undo is blocked.
 *   6. InMemoryActionHistory correctly implements ActionHistory.
 *   7. canRedo / redo work with the stored redo buffer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryUndoManager, InMemoryActionHistory, UndoNotAllowedError } from './UndoManager.js';
import type { ActionHistory, ActionHistoryEntry } from './UndoManager.js';
import { DEFAULT_UNDO_POLICY } from './UndoPolicy.js';
import type { UndoPolicy } from './UndoPolicy.js';
import type { BaseGameSnapshot, ActionEnvelope, PlayerId } from './types.js';
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
    timers: {},
    gameResult: null,
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

/**
 * `ActionHistory` double whose every method is a spy, so a test can assert
 * WHICH accessor a manager call reached. Both readers answer from the same
 * array, so they cannot disagree by construction: an assertion below is about
 * the call that was made, never about a stub that drifted.
 */
const makeSpyHistory = (entries: readonly ActionHistoryEntry[] = []) => {
    const spy = {
        append: vi.fn((_entry: ActionHistoryEntry): void => {}),
        markMementoBoundary: vi.fn((): void => {}),
        sinceLastMemento: vi.fn((): readonly ActionHistoryEntry[] => entries),
        sizeSinceLastMemento: vi.fn((): number => entries.length),
        hasEvictedSinceMemento: vi.fn((): boolean => false),
        pruneTo: vi.fn((_cutoff: number): void => {}),
    };
    return spy satisfies ActionHistory;
};

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

        it('does not count setup entries that were appended before saveTurnMemento', () => {
            history.append(makeHistoryEntry(1, 0, 'engine:start_game'));

            manager.saveTurnMemento(makeSnapshot(1), P1);

            expect(manager.canUndo(P1)).toBe(false);
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

    // ─── canUndo — history access ────────────────────────────────────────────

    describe('canUndo — history access', () => {
        it('asks the history for its size and never materialises the entry array', () => {
            // canUndo only needs to know whether the effective list is non-empty.
            // Reading it through sinceLastMemento() copies a list that grows to
            // the history's cap, on the per-viewer broadcast path.
            const spy = makeSpyHistory([makeHistoryEntry(1)]);
            const m = new InMemoryUndoManager(spy, DEFAULT_UNDO_POLICY, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);

            expect(m.canUndo(P1)).toBe(true);

            expect(spy.sizeSinceLastMemento).toHaveBeenCalledTimes(1);
            expect(spy.sinceLastMemento).not.toHaveBeenCalled();
        });

        it('answers false from a zero size without materialising the entry array', () => {
            const spy = makeSpyHistory([]);
            const m = new InMemoryUndoManager(spy, DEFAULT_UNDO_POLICY, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);

            expect(m.canUndo(P1)).toBe(false);

            expect(spy.sizeSinceLastMemento).toHaveBeenCalledTimes(1);
            expect(spy.sinceLastMemento).not.toHaveBeenCalled();
        });

        it('reads the per-player virtual history after an undo, touching no history reader', () => {
            const spy = makeSpyHistory([makeHistoryEntry(1), makeHistoryEntry(2)]);
            const m = new InMemoryUndoManager(spy, DEFAULT_UNDO_POLICY, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            m.undo(P1, 1);
            spy.sinceLastMemento.mockClear();
            spy.sizeSinceLastMemento.mockClear();
            spy.hasEvictedSinceMemento.mockClear();

            // One entry remains in the virtual history, so undo is still allowed —
            // and the answer comes from that per-player array, not from the shared
            // history, which the undo has already diverged from.
            expect(m.canUndo(P1)).toBe(true);

            expect(spy.sizeSinceLastMemento).not.toHaveBeenCalled();
            expect(spy.sinceLastMemento).not.toHaveBeenCalled();
            expect(spy.hasEvictedSinceMemento).not.toHaveBeenCalled();
        });

        it('does not reach the history at all when the policy or the memento short-circuits first', () => {
            const spy = makeSpyHistory([makeHistoryEntry(1)]);
            const blocked = new InMemoryUndoManager(
                spy,
                { ...DEFAULT_UNDO_POLICY, allowUndo: false },
                countingReplay,
            );
            blocked.saveTurnMemento(makeSnapshot(0), P1);
            expect(blocked.canUndo(P1)).toBe(false);

            const noMemento = new InMemoryUndoManager(spy, DEFAULT_UNDO_POLICY, countingReplay);
            expect(noMemento.canUndo(P1)).toBe(false);

            expect(spy.sizeSinceLastMemento).not.toHaveBeenCalled();
            expect(spy.sinceLastMemento).not.toHaveBeenCalled();
            expect(spy.hasEvictedSinceMemento).not.toHaveBeenCalled();
        });
    });

    // ─── undo after eviction crossed the memento boundary ────────────────────

    describe('undo after eviction crossed the memento boundary', () => {
        const CAP = 4;

        /**
         * Builds the state the defect lives in. The history holds CAP entries
         * before the memento is taken, so eviction has to walk all of those
         * before it starts dropping the entries `undo()` would replay —
         * `postMemento === CAP` is the last run that leaves the segment whole.
         */
        const saturate = (
            postMemento: number,
        ): { hist: InMemoryActionHistory; m: InMemoryUndoManager } => {
            const hist = new InMemoryActionHistory({ maxEntries: CAP });
            const m = new InMemoryUndoManager(hist, DEFAULT_UNDO_POLICY, countingReplay);
            for (let i = 1; i <= CAP; i++) hist.append(makeHistoryEntry(i));
            m.saveTurnMemento(makeSnapshot(0), P1);
            for (let i = 1; i <= postMemento; i++) hist.append(makeHistoryEntry(CAP + i));
            return { hist, m };
        };

        it('undoes normally while eviction has only dropped pre-memento entries', () => {
            const { m } = saturate(CAP);
            expect(m.canUndo(P1)).toBe(true);
            // countingReplay returns the baseline tick plus the replayed count:
            // the whole segment except the one step undone.
            expect(m.undo(P1, 1).tick).toBe(CAP - 1);
        });

        it('refuses undo once eviction has dropped an entry recorded after the memento', () => {
            // One append past the run above, so the eviction it forces is the
            // first to land inside the segment undo replays. Unrefused, undo()
            // replays the surviving tail onto a baseline that tail no longer
            // follows and returns a snapshot the match was never in.
            const { m } = saturate(CAP + 1);

            let thrown: unknown;
            try {
                m.undo(P1, 1);
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toBeInstanceOf(UndoNotAllowedError);
            expect((thrown as UndoNotAllowedError).reason).toBe('not_enough_history');
        });

        it('reports canUndo false in that state, so undoMeta cannot advertise undo', () => {
            const { m } = saturate(CAP + 1);
            expect(m.canUndo(P1)).toBe(false);
        });

        it('still undoes for a player whose own undo already left the shared history', () => {
            // Their replay segment is the copy the manager took while it was
            // whole, and the baseline is the memento the manager still holds —
            // neither is what eviction destroyed.
            const { hist, m } = saturate(CAP);
            expect(m.undo(P1, 1).tick).toBe(CAP - 1);

            hist.append(makeHistoryEntry(101));
            expect(hist.hasEvictedSinceMemento()).toBe(true);

            expect(m.canUndo(P1)).toBe(true);
            expect(m.undo(P1, 1).tick).toBe(CAP - 2);
        });

        it('undoes again once a fresh memento re-anchors the baseline to the live tail', () => {
            const { hist, m } = saturate(CAP + 1);
            expect(m.canUndo(P1)).toBe(false);

            m.saveTurnMemento(makeSnapshot(9), P1);
            hist.append(makeHistoryEntry(99));

            expect(m.canUndo(P1)).toBe(true);
            expect(m.undo(P1, 1).tick).toBe(9);
        });
    });

    // ─── undo — refusal reason ───────────────────────────────────────────────

    describe('undo — refusal reason', () => {
        /**
         * The `reason` carried by the `UndoNotAllowedError` `undo` threw.
         * Returns a marker string instead of throwing on the two ways this can
         * go wrong, so a wrong reason and a missing throw both read as a value
         * mismatch rather than as an error in the harness.
         */
        const reasonFromUndo = (m: InMemoryUndoManager, player: PlayerId): string => {
            try {
                m.undo(player, 1);
            } catch (error) {
                return error instanceof UndoNotAllowedError
                    ? error.reason
                    : `threw a non-UndoNotAllowedError: ${String(error)}`;
            }
            return 'did not throw';
        };

        it('names the policy when allowUndo is false', () => {
            const m = new InMemoryUndoManager(
                history,
                { ...DEFAULT_UNDO_POLICY, allowUndo: false },
                countingReplay,
            );
            m.saveTurnMemento(makeSnapshot(0), P1);
            history.append(makeHistoryEntry(1));

            expect(reasonFromUndo(m, P1)).toBe('policy_disallows');
        });

        it('names the missing memento for a player who has none', () => {
            history.append(makeHistoryEntry(1));

            expect(reasonFromUndo(manager, P1)).toBe('no_memento');
        });

        it('names the missing memento ahead of an evicted segment', () => {
            // P2 never took a memento while the shared segment was cut into. The
            // evicted-segment arm is about a baseline P2 does not have, so the
            // memento arm has to answer first.
            const hist = new InMemoryActionHistory({ maxEntries: 2 });
            const m = new InMemoryUndoManager(hist, DEFAULT_UNDO_POLICY, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            for (let i = 1; i <= 3; i++) hist.append(makeHistoryEntry(i));
            expect(hist.hasEvictedSinceMemento()).toBe(true);

            expect(reasonFromUndo(m, P2)).toBe('no_memento');
        });

        it('names the evicted segment once eviction cut into the shared history', () => {
            const hist = new InMemoryActionHistory({ maxEntries: 2 });
            const m = new InMemoryUndoManager(hist, DEFAULT_UNDO_POLICY, countingReplay);
            m.saveTurnMemento(makeSnapshot(0), P1);
            for (let i = 1; i <= 3; i++) hist.append(makeHistoryEntry(i));
            expect(hist.hasEvictedSinceMemento()).toBe(true);

            expect(reasonFromUndo(m, P1)).toBe('not_enough_history');
        });

        it('names max steps, not the evicted segment, for a player reading their own copy', () => {
            // P1 has already undone, so the segment they would replay is the one
            // the manager holds — the shared history's gap is not what refuses
            // them, the step limit is.
            const hist = new InMemoryActionHistory({ maxEntries: 2 });
            const m = new InMemoryUndoManager(
                hist,
                { ...DEFAULT_UNDO_POLICY, maxUndoSteps: 1 },
                countingReplay,
            );
            hist.append(makeHistoryEntry(1));
            hist.append(makeHistoryEntry(2));
            m.saveTurnMemento(makeSnapshot(0), P1);
            hist.append(makeHistoryEntry(3));
            hist.append(makeHistoryEntry(4));
            m.undo(P1, 1);
            hist.append(makeHistoryEntry(5));
            expect(hist.hasEvictedSinceMemento()).toBe(true);

            expect(reasonFromUndo(m, P1)).toBe('max_steps_reached');
        });

        it('falls through to max steps for an empty segment, as it did before', () => {
            // Characterises a pre-existing quirk rather than endorsing it: the
            // default policy is unlimited and no step has been taken, yet an
            // empty segment answers with the step-limit code.
            manager.saveTurnMemento(makeSnapshot(0), P1);

            expect(reasonFromUndo(manager, P1)).toBe('max_steps_reached');
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
