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
 *   #2  — simulation/ has zero imports from renderer/, electron/, games/*, DOM
 *   #43 — No Math.random() or Date.now() — pure data operations only
 *   #45 — ActionHistory bounded by MAX_ACTION_HISTORY_ENTRIES=10_000;
 *          overflow evicts oldest AND emits 'action-history:overflow' warn log
 */

import { describe, expect, it, vi } from 'vitest';
import {
    InMemoryActionHistory,
    TURN_MEMENTO_RETENTION,
    MAX_ACTION_HISTORY_ENTRIES,
} from './UndoManager.js';
import type { ActionHistoryEntry } from './UndoManager.js';
import type { Logger } from '@chimera/shared/logging.js';
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

    it('emits a warn log on every overflow, not just the first', () => {
        const cap = 2;
        const logger = makeNoopLogger();
        const history = new InMemoryActionHistory({ maxEntries: cap, logger });
        history.append(makeEntry(1, 1));
        history.append(makeEntry(2, 2));
        history.append(makeEntry(3, 3)); // overflow #1
        history.append(makeEntry(4, 4)); // overflow #2
        expect(logger.warn).toHaveBeenCalledTimes(2);
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
