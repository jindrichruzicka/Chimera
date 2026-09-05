/**
 * simulation/engine/ActionHistory.test.ts
 *
 * Unit tests dedicated to the ActionHistory contract:
 *   - TURN_MEMENTO_RETENTION and MAX_ACTION_HISTORY_ENTRIES constants
 *   - InMemoryActionHistory — basic contract, pruneTo boundary, overflow cap
 *
 * Architecture reference: §4.5 — ActionHistory
 * Issue: #362
 *
 * Tests written FIRST (red) before TURN_MEMENTO_RETENTION / MAX_ACTION_HISTORY_ENTRIES
 * are exported and before the overflow cap exists in InMemoryActionHistory.
 *
 * Invariants:
 *   #43 — No Math.random() or Date.now() — pure data operations only
 *   #45 — ActionHistory bounded by MAX_ACTION_HISTORY_ENTRIES=10_000;
 *          overflow evicts oldest on every append AND emits an
 *          'action-history:overflow' log once per saturation episode
 */

import { describe, expect, it, vi } from 'vitest';
import {
    InMemoryActionHistory,
    TURN_MEMENTO_RETENTION,
    MAX_ACTION_HISTORY_ENTRIES,
} from './UndoManager.js';
import type { ActionHistoryEntry } from './UndoManager.js';
import type { Logger } from '../foundation/logging.js';
import { playerId as toPlayerId } from './types.js';

const P1 = toPlayerId('player-1');

const makeEntry = (tickApplied: number, turnNumber = 1): ActionHistoryEntry => ({
    tickApplied,
    turnNumber,
    action: {
        type: 'game:noop',
        playerId: P1,
        tick: tickApplied,
        payload: {},
    },
});

const makeNoopLogger = (): Logger => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis() as Logger['child'],
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('ActionHistory constants', () => {
    it('TURN_MEMENTO_RETENTION equals 4 (Invariant #45)', () => {
        expect(TURN_MEMENTO_RETENTION).toBe(4);
    });

    it('MAX_ACTION_HISTORY_ENTRIES equals 10_000 (Invariant #45)', () => {
        expect(MAX_ACTION_HISTORY_ENTRIES).toBe(10_000);
    });
});

// ─── InMemoryActionHistory — basic contract ───────────────────────────────────

describe('InMemoryActionHistory — basic contract', () => {
    it('is empty on construction', () => {
        const history = new InMemoryActionHistory();
        expect(history.sinceLastMemento()).toEqual([]);
    });

    it('append increases the entry count by one', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1));
        expect(history.sinceLastMemento()).toHaveLength(1);
    });

    it('sinceLastMemento returns entries in insertion order', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 1));
        const result = history.sinceLastMemento();
        expect(result.map((e) => e.tickApplied)).toEqual([1, 2, 3]);
    });

    it('sinceLastMemento returns a snapshot — mutations to the result do not affect internal state', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1));
        const snapshot = history.sinceLastMemento() as ActionHistoryEntry[];
        snapshot.push(makeEntry(99));
        expect(history.sinceLastMemento()).toHaveLength(1);
    });

    it('sinceLastMemento returns only entries appended after markMementoBoundary', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1));
        history.markMementoBoundary();
        history.append(makeEntry(2));

        expect(history.sinceLastMemento().map((entry) => entry.tickApplied)).toEqual([2]);
    });
});

// ─── InMemoryActionHistory — pruneTo ─────────────────────────────────────────

describe('InMemoryActionHistory — pruneTo', () => {
    it('removes entries whose turnNumber is strictly less than the cutoff', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3));
        history.pruneTo(2);
        expect(history.sinceLastMemento().every((e) => e.turnNumber >= 2)).toBe(true);
    });

    it('keeps entries whose turnNumber equals the cutoff', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 2));
        history.pruneTo(2);
        expect(history.sinceLastMemento()).toHaveLength(1);
    });

    it('removes all entries when all turnNumbers are below the cutoff', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.pruneTo(10);
        expect(history.sinceLastMemento()).toHaveLength(0);
    });

    it('pruneTo(0) removes no entries (no turnNumber is negative)', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.pruneTo(0);
        expect(history.sinceLastMemento()).toHaveLength(1);
    });

    // Invariant #45: pruning evicts entries at TURN_MEMENTO_RETENTION=4 boundary exactly
    it('pruneTo(currentTurn - TURN_MEMENTO_RETENTION) evicts exactly entries older than retention window (Invariant #45)', () => {
        const history = new InMemoryActionHistory();
        // Add entries at turns 0 through 5 (6 entries)
        for (let turn = 0; turn <= 5; turn++) {
            history.append(makeEntry(turn, turn));
        }
        const currentTurn = 5;
        // cutoff = 5 - 4 = 1 — entries with turnNumber < 1 (only turn 0) are evicted
        history.pruneTo(currentTurn - TURN_MEMENTO_RETENTION);
        const result = history.sinceLastMemento();
        expect(result.some((e) => e.turnNumber === 0)).toBe(false);
        expect(result.some((e) => e.turnNumber === 1)).toBe(true);
        expect(result).toHaveLength(5); // turns 1–5 kept
    });
});

// ─── InMemoryActionHistory — overflow cap (Invariant #45) ─────────────────────

describe('InMemoryActionHistory — overflow cap (Invariant #45)', () => {
    it('does not evict entries until the cap is reached', () => {
        const cap = 3;
        const history = new InMemoryActionHistory({ maxEntries: cap });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3));
        // Exactly at cap — no eviction yet
        expect(history.sinceLastMemento()).toHaveLength(3);
    });

    it('evicts the oldest entry when the cap would be exceeded', () => {
        const cap = 3;
        const history = new InMemoryActionHistory({ maxEntries: cap });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3));
        // Append a 4th entry — oldest (tick=1) should be evicted to stay at cap
        history.append(makeEntry(4, 4));
        const result = history.sinceLastMemento();
        expect(result).toHaveLength(3);
        expect(result.some((e) => e.tickApplied === 1)).toBe(false);
        expect(result.map((e) => e.tickApplied)).toEqual([2, 3, 4]);
    });

    it('emits an action-history:overflow warn log when the cap is exceeded', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        // This append causes overflow
        history.append(makeEntry(3, 3));
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith('action-history:overflow', expect.any(Object));
    });

    it('stays silent at exactly the cap and reports on the eviction that follows', () => {
        const cap = 3;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        for (let i = 1; i <= cap; i++) history.append(makeEntry(i, i));

        // Full, but nothing has been dropped: retention is still lossless, and
        // the warn means retention has BECOME lossy. Reporting on reaching the
        // cap rather than on the first eviction would fire here.
        expect(history.sinceLastMemento()).toHaveLength(cap);
        expect(logger.warn).not.toHaveBeenCalled();

        history.append(makeEntry(cap + 1, cap + 1));
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('warns ONCE across a long run of overflowing appends, not once per append', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        // Saturation is a state transition — retention just became lossy — not a
        // per-append event, however long the run past it goes.
        for (let i = 1; i <= cap + 50; i++) {
            history.append(makeEntry(i, i));
        }
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith('action-history:overflow', { capacity: cap });
    });

    it('warns again for a second episode, once pruneTo has freed space', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        // Episode 1: saturate and overflow.
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3));
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // A turn-based game prunes on end_turn; the history drops below capacity.
        history.pruneTo(3);
        expect(history.sinceLastMemento().length).toBeLessThan(cap);

        // Episode 2: saturating again is a NEW transition and reports again.
        history.append(makeEntry(4, 4));
        history.append(makeEntry(5, 5));
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('re-arms on freed space while tombstoned slots are still uncompacted', () => {
        // The re-arm guard must read the LIVE size, not the backing array's
        // length. They differ only while the head cursor holds tombstoned slots
        // that `#compactIfNeeded()` has not yet reclaimed, and no append/prune
        // sequence at cap 2 reaches the guard in a state where the two answer
        // the comparison differently — so a test written at that cap cannot see
        // which accessor is used. Cap 4 reaches the check with head = 2 and a
        // backing array of 5, where they disagree.
        const cap = 4;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        for (let i = 1; i <= cap; i++) history.append(makeEntry(i, i));
        history.append(makeEntry(5, 5)); // overflow — episode 1
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // Frees exactly one entry; the live size drops to 3 while the backing
        // array is still 5 long.
        history.pruneTo(3);
        expect(history.sinceLastMemento()).toHaveLength(cap - 1);

        history.append(makeEntry(6, 6)); // back to capacity, no eviction
        history.append(makeEntry(7, 7)); // evicts — episode 2
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('does not re-arm on a pruneTo that frees nothing', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        history.append(makeEntry(1, 5));
        history.append(makeEntry(2, 5));
        history.append(makeEntry(3, 5)); // overflow — warns once
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // Every live entry is at or above the cutoff, so the head does not move
        // and the history is still saturated. Nothing transitioned.
        history.pruneTo(5);
        history.append(makeEntry(4, 5));
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('evicts oldest on every overflowing append, latched warn or not', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        for (let i = 1; i <= 6; i++) {
            history.append(makeEntry(i, i));
        }
        // Retention is unchanged by the latch: the cap still holds and the
        // survivors are still the newest `cap` entries.
        expect(history.sinceLastMemento().map((e) => e.tickApplied)).toEqual([5, 6]);
    });

    it('does not call warn when the cap has not been reached', () => {
        const cap = 5;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('overflow cap defaults to MAX_ACTION_HISTORY_ENTRIES when maxEntries option is absent', () => {
        // Verify that without the option, no eviction occurs below MAX_ACTION_HISTORY_ENTRIES
        const history = new InMemoryActionHistory();
        for (let i = 0; i < 100; i++) {
            history.append(makeEntry(i, i));
        }
        expect(history.sinceLastMemento()).toHaveLength(100);
    });

    it('the warn log context includes the capacity that was exceeded', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3));
        const [, ctx] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
            string,
            Record<string, unknown>,
        ];
        expect(ctx).toMatchObject({ capacity: cap });
    });
});

// ─── sizeSinceLastMemento ─────────────────────────────────────────────────────

describe('InMemoryActionHistory — sizeSinceLastMemento', () => {
    /**
     * The contract is an equivalence, not a formula: whatever start index
     * `sinceLastMemento()` slices from, the size query must report that slice's
     * length. Each case asserts both sides at the same instant, so a reader that
     * drifted from the slice fails here instead of returning a plausible number.
     */
    const expectAgreesWithSlice = (history: InMemoryActionHistory, expected: number): void => {
        expect(history.sizeSinceLastMemento()).toBe(history.sinceLastMemento().length);
        expect(history.sizeSinceLastMemento()).toBe(expected);
    };

    it('is 0 on construction', () => {
        expectAgreesWithSlice(new InMemoryActionHistory(), 0);
    });

    it('counts every append while no boundary has been marked', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 1));
        expectAgreesWithSlice(history, 3);
    });

    it('is 0 immediately after markMementoBoundary', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.markMementoBoundary();
        expectAgreesWithSlice(history, 0);
    });

    it('counts only the appends that followed markMementoBoundary', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.markMementoBoundary();
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 1));
        expectAgreesWithSlice(history, 2);
    });

    it('ignores a pruneTo that only dropped entries from below the boundary', () => {
        // head lands strictly below mementoBoundary — the state that separates a
        // reader counting from the head from one counting from the boundary.
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 2));
        history.markMementoBoundary();
        history.append(makeEntry(4, 2));
        history.append(makeEntry(5, 2));

        history.pruneTo(2);

        expectAgreesWithSlice(history, 2);
    });

    it('excludes the entries overflow eviction dropped', () => {
        const cap = 4;
        const history = new InMemoryActionHistory({ maxEntries: cap });
        for (let i = 1; i <= cap; i++) history.append(makeEntry(i, i));
        history.append(makeEntry(cap + 1, cap + 1));
        expectAgreesWithSlice(history, cap);
    });

    it('holds across the compaction that reclaims tombstoned slots', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 2));
        history.markMementoBoundary();
        history.append(makeEntry(4, 2));
        history.append(makeEntry(5, 2));
        history.append(makeEntry(6, 3));

        // Drops five of the six entries, so the tombstoned prefix outgrows the
        // live region and `#compactIfNeeded()` rebases both cursors.
        history.pruneTo(3);

        expectAgreesWithSlice(history, 1);
    });
});

// ─── hasEvictedSinceMemento ───────────────────────────────────────────────────

describe('InMemoryActionHistory — hasEvictedSinceMemento', () => {
    const CAP = 4;

    /** Fills the history to the cap and marks the boundary on the live tail. */
    const atBoundary = (): InMemoryActionHistory => {
        const history = new InMemoryActionHistory({ maxEntries: CAP });
        for (let i = 1; i <= CAP; i++) history.append(makeEntry(i, 1));
        history.markMementoBoundary();
        return history;
    };

    it('is false on construction', () => {
        expect(new InMemoryActionHistory().hasEvictedSinceMemento()).toBe(false);
    });

    it('is false while appends stay below the cap', () => {
        const history = new InMemoryActionHistory({ maxEntries: CAP });
        history.append(makeEntry(1, 1));
        history.markMementoBoundary();
        history.append(makeEntry(2, 1));
        expect(history.hasEvictedSinceMemento()).toBe(false);
    });

    it('is false while eviction is still dropping entries from before the boundary', () => {
        const history = atBoundary();
        // Exactly CAP evictions, and the history held CAP pre-boundary entries:
        // every entry recorded since the boundary is still there.
        for (let i = 1; i <= CAP; i++) history.append(makeEntry(CAP + i, 1));

        expect(history.sinceLastMemento().map((e) => e.tickApplied)).toEqual([5, 6, 7, 8]);
        expect(history.hasEvictedSinceMemento()).toBe(false);
    });

    it('is true once eviction drops an entry recorded after the boundary', () => {
        const history = atBoundary();
        for (let i = 1; i <= CAP + 1; i++) history.append(makeEntry(CAP + i, 1));

        // Tick 5 was recorded after the boundary and is gone; what survives no
        // longer starts where the memento's baseline left off.
        expect(history.sinceLastMemento().map((e) => e.tickApplied)).toEqual([6, 7, 8, 9]);
        expect(history.hasEvictedSinceMemento()).toBe(true);
    });

    it('is false again after markMementoBoundary re-anchors to the live tail', () => {
        const history = atBoundary();
        for (let i = 1; i <= CAP + 1; i++) history.append(makeEntry(CAP + i, 1));
        expect(history.hasEvictedSinceMemento()).toBe(true);

        history.markMementoBoundary();

        expect(history.hasEvictedSinceMemento()).toBe(false);
    });

    it('is false for a pruneTo that stops below the boundary', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 2));
        history.markMementoBoundary();
        history.append(makeEntry(4, 2));
        history.append(makeEntry(5, 2));

        history.pruneTo(2);

        expect(history.hasEvictedSinceMemento()).toBe(false);
    });

    it('is true for a pruneTo that walks past the boundary', () => {
        const history = new InMemoryActionHistory();
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 1));
        history.append(makeEntry(3, 2));
        history.markMementoBoundary();
        history.append(makeEntry(4, 2));
        history.append(makeEntry(5, 2));

        // Drops ticks 4 and 5, which were recorded after the boundary.
        history.pruneTo(3);

        expect(history.hasEvictedSinceMemento()).toBe(true);
    });
});

/**
 * What the overflow report MEANS depends on whether anything replays this
 * history (Invariant #45).
 *
 * The warn was written for a retention failure — a capability the player has,
 * quietly reduced. A game that declares no undo has no such capability: the
 * entries the cap drops are read back only through the undo manager, since
 * `HistoryContext.history` narrows this type to `append` and `pruneTo` for
 * every other consumer.
 *
 * The report is kept rather than dropped, at `info` and under the same message
 * and context. What changes is that it no longer claims something is wrong.
 * Why `info` and not `debug` is a host sink-threshold question — see
 * `resolveFileLogLevel` (§4.27).
 */
describe('InMemoryActionHistory — what the overflow report claims (Invariant #45)', () => {
    const cap = 2;

    /** Saturate and then overflow a history built with `options`. */
    function overflow(options: { readonly logger: Logger; readonly undoable?: boolean }): void {
        const history = new InMemoryActionHistory({ maxEntries: cap, ...options });
        for (let i = 1; i <= cap + 1; i++) {
            history.append(makeEntry(i, i));
        }
    }

    it('reports at info when no undo replays this history', () => {
        const logger = makeNoopLogger();
        overflow({ logger, undoable: false });

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledOnce();
        expect(logger.info).toHaveBeenCalledWith('action-history:overflow', { capacity: cap });
    });

    it('still warns when undo does replay it', () => {
        const logger = makeNoopLogger();
        overflow({ logger, undoable: true });

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith('action-history:overflow', { capacity: cap });
    });

    it('warns when nothing is declared, so an existing caller is unchanged', () => {
        const logger = makeNoopLogger();
        overflow({ logger });

        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('latches the demoted report too, so a saturated run reports once', () => {
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger, undoable: false });
        for (let i = 1; i <= cap + 50; i++) {
            history.append(makeEntry(i, i));
        }

        expect(logger.info).toHaveBeenCalledOnce();
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
