// @vitest-environment jsdom

/**
 * renderer/app/saves/page.test.tsx
 *
 * Unit tests for the SavesPage component.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #374
 *
 * Invariant #1: GameSnapshot never leaves the main process — page reads only
 *   SaveSlotMeta from saveStore, never raw SaveFile or GameSnapshot.
 */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SavesPage from './page';
import { toSlotId } from '@chimera/simulation/bridge/api-types.js';
import type { SaveSlotMeta } from '@chimera/simulation/bridge/api-types.js';
import { useToastStore } from '../../state/toastStore';

// ── Mock window.__chimera.saves ───────────────────────────────────────────────

const mockSave = vi.fn(
    async (): Promise<SaveSlotMeta> => ({
        slotId: toSlotId('slot-1'),
        gameId: 'tactics',
        tick: 1,
        savedAt: 1_000_000,
    }),
);
const mockLoad = vi.fn(async () => undefined);
const mockDelete = vi.fn(async () => undefined);

beforeEach(() => {
    vi.resetAllMocks();
    useToastStore.getState().dismissAll();
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            saves: {
                save: mockSave,
                load: mockLoad,
                delete: mockDelete,
            },
        },
    });
});

afterEach(() => {
    cleanup();
});

// ── Mock useSaveStore ─────────────────────────────────────────────────────────

let mockSlots: readonly SaveSlotMeta[] = [];
let mockIsLoading = false;

vi.mock('../../state/saveStore', () => ({
    useSaveStore: (
        selector: (state: { slots: readonly SaveSlotMeta[]; isLoading: boolean }) => unknown,
    ) => selector({ slots: mockSlots, isLoading: mockIsLoading }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlot(slotId: string, overrides: Partial<SaveSlotMeta> = {}): SaveSlotMeta {
    return {
        slotId: toSlotId(slotId),
        gameId: 'tactics',
        tick: 5,
        savedAt: 1_714_000_000_000,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SavesPage — loading state', () => {
    it('shows a loading skeleton when isLoading is true', () => {
        mockIsLoading = true;
        mockSlots = [];

        render(<SavesPage />);

        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('does not render slot rows while loading', () => {
        mockIsLoading = true;
        mockSlots = [makeSlot('slot-1')];

        render(<SavesPage />);

        expect(screen.queryByText('slot-1')).toBeNull();
    });
});

describe('SavesPage — empty state', () => {
    it('uses shared Typography primitives for the page heading, form label, and empty message', () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        expect(screen.getByRole('heading', { level: 1, name: 'Saves' })).toHaveAttribute(
            'data-ch-heading-level',
            '1',
        );
        expect(screen.getByText('Slot ID')).toHaveAttribute('data-ch-label-state', 'default');
        expect(screen.getByText(/no save slots found/i)).toHaveAttribute(
            'data-ch-caption-tone',
            'muted',
        );
    });

    it('shows an empty state message when slots is empty and not loading', () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        expect(screen.getByText(/no save slots/i)).toBeTruthy();
    });
});

describe('SavesPage — slot list', () => {
    it('renders a row for each slot', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1'), makeSlot('slot-2'), makeSlot('slot-3')];

        render(<SavesPage />);

        expect(screen.getByText('slot-1')).toBeTruthy();
        expect(screen.getByText('slot-2')).toBeTruthy();
        expect(screen.getByText('slot-3')).toBeTruthy();
    });

    it('displays the tick number for each slot', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1', { tick: 42 })];

        render(<SavesPage />);

        expect(screen.getByText('42')).toBeTruthy();
    });

    it('displays the savedAt timestamp for each slot', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1', { savedAt: 1_714_000_000_000 })];

        render(<SavesPage />);

        // The page formats the timestamp — just verify it appears
        expect(screen.getByTestId('slot-saved-at-slot-1')).toBeTruthy();
    });

    it('displays the optional label when present', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1', { label: 'Before boss fight' })];

        render(<SavesPage />);

        expect(screen.getByText('Before boss fight')).toBeTruthy();
    });
});

describe('SavesPage — Save action', () => {
    it('calls window.__chimera.saves.save with the correct slotId', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('my-slot')];

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: 'Save my-slot' }));

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ slotId: 'my-slot' }));
    });
});

describe('SavesPage — Load action', () => {
    it('calls window.__chimera.saves.load with the correct slotId', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('my-slot')];

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /load/i }));

        expect(mockLoad).toHaveBeenCalledTimes(1);
        expect(mockLoad).toHaveBeenCalledWith('my-slot');
    });
});

describe('SavesPage — Delete action', () => {
    it('calls window.__chimera.saves.delete with the correct slotId', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('my-slot')];

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /delete/i }));

        expect(mockDelete).toHaveBeenCalledTimes(1);
        expect(mockDelete).toHaveBeenCalledWith('my-slot');
    });
});

describe('SavesPage — multiple slots button targeting', () => {
    it("Save button on each slot calls save with that slot's ID", () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-a'), makeSlot('slot-b')];

        render(<SavesPage />);

        const saveButtons = screen.getAllByRole('button', { name: /^save slot-/i });
        fireEvent.click(saveButtons[1]!);

        expect(mockSave).toHaveBeenCalledWith(
            expect.objectContaining({ slotId: 'slot-b', gameId: 'tactics' }),
        );
    });

    it("Load button on each slot calls load with that slot's ID", () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-a'), makeSlot('slot-b')];

        render(<SavesPage />);

        const loadButtons = screen.getAllByRole('button', { name: /load/i });
        fireEvent.click(loadButtons[0]!);

        expect(mockLoad).toHaveBeenCalledWith('slot-a');
    });

    it("Delete button on each slot calls delete with that slot's ID", () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-a'), makeSlot('slot-b')];

        render(<SavesPage />);

        const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
        fireEvent.click(deleteButtons[1]!);

        expect(mockDelete).toHaveBeenCalledWith('slot-b');
    });
});

describe('SavesPage — error reporting', () => {
    it('renders an alert with the failure message when save rejects', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockSave.mockRejectedValueOnce(new Error('no active session'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /save slot-1/i }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Save failed');
        expect(alert.textContent).toContain('no active session');
    });

    it('renders an alert when load rejects', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockLoad.mockRejectedValueOnce(new Error('save not found'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /load slot-1/i }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Load failed');
        expect(alert.textContent).toContain('save not found');
    });

    it('clears the alert on the next successful action', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockSave.mockRejectedValueOnce(new Error('boom'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /save slot-1/i }));
        await screen.findByRole('alert');

        fireEvent.click(screen.getByRole('button', { name: /load slot-1/i }));

        // Allow the promise microtask chain to settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('SavesPage — save-failed toast (§4.30 engine-wired source)', () => {
    it('pushes an error toast when a save action rejects', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockSave.mockRejectedValueOnce(new Error('disk full while writing SaveFile'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /save slot-1/i }));

        await screen.findByRole('alert');
        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('error');
        expect(queue[0]!.title).toBe('Save failed');
        // Invariant #74: the raw error text (potentially SaveFile-derived) must
        // not leak into the toast — only the static title surfaces. Detail stays
        // in the inline alert.
        expect(queue[0]!.body).toBeUndefined();
    });

    it('pushes an error toast when a new-save action rejects', async () => {
        mockIsLoading = false;
        mockSlots = [];
        mockSave.mockRejectedValueOnce(new Error('no active session'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        await screen.findByRole('alert');
        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.title).toBe('Save failed');
    });

    it('does not push a toast when a load action rejects', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockLoad.mockRejectedValueOnce(new Error('save not found'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /load slot-1/i }));

        await screen.findByRole('alert');
        expect(useToastStore.getState().queue).toHaveLength(0);
    });

    it('does not push a toast when a delete action rejects', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];
        mockDelete.mockRejectedValueOnce(new Error('permission denied'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /delete slot-1/i }));

        await screen.findByRole('alert');
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});

describe('SavesPage — new save form', () => {
    it('renders a "New Save" button when slot list is empty', () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        expect(screen.getByRole('button', { name: /new save/i })).toBeTruthy();
    });

    it('renders a "New Save" button when slot list is populated', () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-1')];

        render(<SavesPage />);

        expect(screen.getByRole('button', { name: /new save/i })).toBeTruthy();
    });

    it('calls saves.save with gameId only when slotId input is empty', async () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledWith({ gameId: 'tactics' });
    });

    it('calls saves.save with the provided slotId', async () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        fireEvent.change(screen.getByRole('textbox', { name: /slot id/i }), {
            target: { value: 'my-manual-slot' },
        });
        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        expect(mockSave).toHaveBeenCalledWith({ gameId: 'tactics', slotId: 'my-manual-slot' });
    });

    it('derives gameId from existing slots', async () => {
        mockIsLoading = false;
        mockSlots = [makeSlot('slot-a', { gameId: 'tactics' })];

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'tactics' }));
    });

    it('clears the slotId input after a successful new save', async () => {
        mockIsLoading = false;
        mockSlots = [];

        render(<SavesPage />);

        const input = screen.getByRole('textbox', { name: /slot id/i });
        fireEvent.change(input, { target: { value: 'my-slot' } });
        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        await Promise.resolve();
        await Promise.resolve();

        expect((input as HTMLInputElement).value).toBe('');
    });

    it('shows an error alert when new save fails', async () => {
        mockIsLoading = false;
        mockSlots = [];
        mockSave.mockRejectedValueOnce(new Error('no active session'));

        render(<SavesPage />);

        fireEvent.click(screen.getByRole('button', { name: /new save/i }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Save failed');
        expect(alert.textContent).toContain('no active session');
    });
});
