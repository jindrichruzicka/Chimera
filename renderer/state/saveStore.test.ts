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
import { toSlotId } from '@chimera/electron/preload/api-types.js';
import type { SaveSlotMeta } from '@chimera/electron/preload/api-types.js';

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

// Reset the singleton between tests so state does not leak
beforeEach(() => {
    useSaveStore.setState({ slots: [], isLoading: true });
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
});
