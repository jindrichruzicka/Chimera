// @vitest-environment jsdom

/**
 * renderer/state/saveStore.test.ts
 *
 * Unit tests for the saveStore Zustand store.
 * Uses jsdom environment (no real Electron IPC).
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #373
 *
 * Invariant #1: GameSnapshot never leaves the main process — saveStore holds
 * only SaveSlotMeta (metadata), never GameSnapshot or SaveFile content.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSaveStore, useSaveStore } from './saveStore';
import { playerId, toSlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    RestoreStatusEvent,
    SaveSlotMeta,
} from '@chimera-engine/simulation/bridge/api-types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlot(slotId: string, overrides: Partial<SaveSlotMeta> = {}): SaveSlotMeta {
    return {
        slotId: toSlotId(slotId),
        gameId: 'tactics',
        tick: 1,
        savedAt: 1_000_000,
        ...overrides,
    };
}

function makeRestoreEvent(overrides: Partial<RestoreStatusEvent> = {}): RestoreStatusEvent {
    return {
        state: 'waiting',
        gameId: 'tactics',
        matchId: 'match-1',
        lobbyCode: 'ABCD',
        pendingSeats: [playerId('p2'), playerId('p3')],
        ...overrides,
    };
}

// Terminal events carry no lobbyCode and empty pendingSeats (schema-enforced);
// built separately because exactOptionalPropertyTypes forbids `lobbyCode: undefined`.
function makeTerminalRestoreEvent(
    state: 'ready' | 'cancelled' | 'failed',
    overrides: Partial<RestoreStatusEvent> = {},
): RestoreStatusEvent {
    return {
        state,
        gameId: 'tactics',
        matchId: 'match-1',
        pendingSeats: [],
        ...overrides,
    };
}

// Reset the singleton between tests so state does not leak
beforeEach(() => {
    useSaveStore.setState({
        slots: [],
        isLoading: true,
        restore: null,
        restoreExpectedSeats: null,
        restoreLatchMatchId: null,
    });
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('saveStore — initial state', () => {
    it('initialises with isLoading: true', () => {
        const store = createSaveStore();
        expect(store.getState().isLoading).toBe(true);
    });

    it('initialises with an empty slots array', () => {
        const store = createSaveStore();
        expect(store.getState().slots).toEqual([]);
    });
});

// ── applySaveSlots ───────────────────────────────────────────────────────────

describe('saveStore.applySaveSlots()', () => {
    it('sets the provided slots', () => {
        const store = createSaveStore();
        const slots = [makeSlot('slot-1'), makeSlot('slot-2')];
        store.getState().applySaveSlots(slots);
        expect(store.getState().slots).toEqual(slots);
    });

    it('transitions isLoading to false', () => {
        const store = createSaveStore();
        store.getState().applySaveSlots([makeSlot('slot-1')]);
        expect(store.getState().isLoading).toBe(false);
    });

    it('replaces existing slots on subsequent calls', () => {
        const store = createSaveStore();
        const first = [makeSlot('slot-1')];
        const second = [makeSlot('slot-2'), makeSlot('slot-3')];
        store.getState().applySaveSlots(first);
        store.getState().applySaveSlots(second);
        expect(store.getState().slots).toEqual(second);
    });

    it('accepts an empty array and still clears isLoading', () => {
        const store = createSaveStore();
        store.getState().applySaveSlots([]);
        expect(store.getState().isLoading).toBe(false);
        expect(store.getState().slots).toEqual([]);
    });

    it('preserves all SaveSlotMeta fields unchanged', () => {
        const store = createSaveStore();
        const slot = makeSlot('slot-1', { label: 'Manual save', tick: 42, savedAt: 9_999 });
        store.getState().applySaveSlots([slot]);
        expect(store.getState().slots[0]).toEqual(slot);
    });
});

// ── restore slice ─────────────────────────────────────────────────────────────

describe('saveStore — restore slice initial state', () => {
    it('initialises with restore: null (idle)', () => {
        const store = createSaveStore();
        expect(store.getState().restore).toBeNull();
    });

    it('initialises with restoreExpectedSeats: null', () => {
        const store = createSaveStore();
        expect(store.getState().restoreExpectedSeats).toBeNull();
    });

    it('initialises with restoreLatchMatchId: null', () => {
        const store = createSaveStore();
        expect(store.getState().restoreLatchMatchId).toBeNull();
    });
});

describe('saveStore.applyRestoreStatus()', () => {
    it('stores a waiting event verbatim', () => {
        const store = createSaveStore();
        const event = makeRestoreEvent();
        store.getState().applyRestoreStatus(event);
        expect(store.getState().restore).toEqual(event);
    });

    it('latches restoreExpectedSeats on the idle → waiting transition', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        expect(store.getState().restoreExpectedSeats).toBe(2);
    });

    it('keeps the latched baseline while pendingSeats shrink across waiting pushes', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().applyRestoreStatus(makeRestoreEvent({ pendingSeats: [playerId('p3')] }));
        expect(store.getState().restoreExpectedSeats).toBe(2);
        expect(store.getState().restore?.pendingSeats).toEqual([playerId('p3')]);
    });

    it('stores terminal events as-is (ready)', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        const ready = makeTerminalRestoreEvent('ready');
        store.getState().applyRestoreStatus(ready);
        expect(store.getState().restore).toEqual(ready);
    });

    it('stores terminal events as-is (cancelled and failed)', () => {
        const store = createSaveStore();
        const cancelled = makeTerminalRestoreEvent('cancelled');
        store.getState().applyRestoreStatus(cancelled);
        expect(store.getState().restore).toEqual(cancelled);

        const failed = makeTerminalRestoreEvent('failed', { matchId: '' });
        store.getState().applyRestoreStatus(failed);
        expect(store.getState().restore).toEqual(failed);
    });

    it('re-latches restoreExpectedSeats when a new restore enters waiting after a terminal state', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().applyRestoreStatus(makeTerminalRestoreEvent('ready'));
        store
            .getState()
            .applyRestoreStatus(
                makeRestoreEvent({ matchId: 'match-2', pendingSeats: [playerId('p4')] }),
            );
        expect(store.getState().restoreExpectedSeats).toBe(1);
    });

    it('restores the same-match baseline when waiting resumes after a dismiss (failed cancel)', () => {
        // cancelRestore is fire-and-forget; if it fails main-side the restore
        // keeps running and the next waiting push resurrects the overlay. The
        // baseline must survive the dismiss or the roster shows e.g. "0 / 1"
        // instead of "1 / 2".
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().dismissRestore();
        store.getState().applyRestoreStatus(makeRestoreEvent({ pendingSeats: [playerId('p3')] }));
        expect(store.getState().restoreExpectedSeats).toBe(2);
    });

    it('latches fresh when a different match enters waiting after a dismiss', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().dismissRestore();
        store
            .getState()
            .applyRestoreStatus(
                makeRestoreEvent({ matchId: 'match-2', pendingSeats: [playerId('p4')] }),
            );
        expect(store.getState().restoreExpectedSeats).toBe(1);
    });

    it('grows the baseline if a seat drops mid-wait and pendingSeats exceed the latch', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent({ pendingSeats: [playerId('p2')] }));
        store.getState().applyRestoreStatus(makeTerminalRestoreEvent('cancelled'));
        store.getState().applyRestoreStatus(makeRestoreEvent());
        expect(store.getState().restoreExpectedSeats).toBe(2);
    });
});

describe('saveStore.dismissRestore()', () => {
    it('resets restore to null but keeps the latch for a same-match resurrect', () => {
        const store = createSaveStore();
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().dismissRestore();
        expect(store.getState().restore).toBeNull();
        expect(store.getState().restoreExpectedSeats).toBe(2);
        expect(store.getState().restoreLatchMatchId).toBe('match-1');
    });

    it('leaves the slot list untouched', () => {
        const store = createSaveStore();
        store.getState().applySaveSlots([makeSlot('slot-1')]);
        store.getState().applyRestoreStatus(makeRestoreEvent());
        store.getState().dismissRestore();
        expect(store.getState().slots).toHaveLength(1);
    });
});

// ── useSaveStore hook ─────────────────────────────────────────────────────────

describe('useSaveStore singleton', () => {
    it('getState() reflects applySaveSlots changes on the singleton', () => {
        const slots = [makeSlot('autosave')];
        useSaveStore.getState().applySaveSlots(slots);
        expect(useSaveStore.getState().slots).toEqual(slots);
    });

    it('getState() reflects isLoading reset on the singleton', () => {
        expect(useSaveStore.getState().isLoading).toBe(true);
        useSaveStore.getState().applySaveSlots([]);
        expect(useSaveStore.getState().isLoading).toBe(false);
    });

    it('getState() reflects applyRestoreStatus changes on the singleton', () => {
        const event = makeRestoreEvent();
        useSaveStore.getState().applyRestoreStatus(event);
        expect(useSaveStore.getState().restore).toEqual(event);
        expect(useSaveStore.getState().restoreExpectedSeats).toBe(2);
    });
});
