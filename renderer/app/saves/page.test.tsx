// @vitest-environment jsdom

/**
 * renderer/app/saves/page.test.tsx
 *
 * Unit tests for the SavesPage load/delete browser (replay-browser pattern).
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #824
 *
 * Invariant #1: GameSnapshot never leaves the main process — page reads only
 *   SaveSlotMeta from saveStore, never raw SaveFile or GameSnapshot.
 * Invariant #74: toast titles are static literals (asserted by exact equality).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toSlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import type { SaveSlotMeta, SavesAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { EscapeStackProvider } from '../../components/ui';
import { useToastStore } from '../../state/toastStore.js';
import SavesPage from './page';

// The close button routes back to the main menu with a client `router.push`.
// Hoisted so the mock factory can close over a stable spy.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
}));

// ── Mock useSaveStore ─────────────────────────────────────────────────────────
// The page reads `slots`/`isLoading` through narrow selectors; tests drive these
// module-level values instead of the real Zustand store (the store's push
// refresh via `onSlotUpdate` is wired by SaveStoreBootstrap, not the page).

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

/**
 * Install a `window.__chimera.saves` bridge; each surface defaults to resolving
 * so a test only has to supply the method it exercises.
 */
function installBridge(
    opts: {
        load?: SavesAPI['load'];
        delete?: SavesAPI['delete'];
    } = {},
): void {
    const saves = {
        load: opts.load ?? vi.fn(() => Promise.resolve()),
        delete: opts.delete ?? vi.fn(() => Promise.resolve()),
    } as unknown as SavesAPI;
    Object.defineProperty(window, '__chimera', { configurable: true, value: { saves } });
}

// The page itself and its confirm dialog are <Modal>s, which register
// Escape-to-close on the shared overlay stack; render the page under the
// provider so `useEscapeLayer` resolves.
function renderPage(): ReturnType<typeof render> {
    return render(
        <EscapeStackProvider>
            <SavesPage />
        </EscapeStackProvider>,
    );
}

beforeEach(() => {
    push.mockClear();
    mockSlots = [];
    mockIsLoading = false;
    useToastStore.getState().dismissAll();
    installBridge();
    window.history.replaceState({}, '', '/saves?gameId=tactics');
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    useToastStore.getState().dismissAll();
    vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SavesPage — loading state', () => {
    it('shows a loading status inside the tagged page while the store loads', () => {
        mockIsLoading = true;

        renderPage();

        expect(screen.getByTestId('saves-page')).toBeInTheDocument();
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('does not render slot rows while loading', () => {
        mockIsLoading = true;
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        expect(screen.getByTestId('saves-page')).toBeInTheDocument();
        expect(screen.queryByTestId('save-load-btn')).not.toBeInTheDocument();
    });
});

describe('SavesPage — empty state', () => {
    it('shows a muted empty caption when there are no saves', () => {
        renderPage();

        expect(screen.getByText(/no saves yet/i)).toHaveAttribute('data-ch-caption-tone', 'muted');
    });
});

describe('SavesPage — rows', () => {
    it('renders one row per slot with a load button and a trailing delete button', () => {
        mockSlots = [makeSlot('slot-1'), makeSlot('slot-2', { tick: 12 })];

        renderPage();

        expect(screen.getAllByTestId('save-load-btn')).toHaveLength(2);
        expect(screen.getAllByTestId('save-delete-btn')).toHaveLength(2);
    });

    it('titles a row with its label when present', () => {
        mockSlots = [makeSlot('slot-1', { label: 'Before the boss' })];

        renderPage();

        expect(screen.getByText('Before the boss')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /load before the boss/i })).toBeInTheDocument();
    });

    it('falls back to the slot id when a slot has no label', () => {
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        expect(screen.getByText('slot-1')).toBeInTheDocument();
        expect(screen.getByTestId('save-load-btn')).toHaveAccessibleName(/load slot-1/i);
    });

    it('shows a muted caption with the saved-at timestamp and tick', () => {
        const slot = makeSlot('slot-1', { tick: 42 });
        mockSlots = [slot];

        renderPage();

        const savedAtText = new Date(slot.savedAt).toLocaleString().replace(/\s+/g, ' ');
        expect(screen.getByText(`${savedAtText} · tick 42`)).toHaveAttribute(
            'data-ch-caption-tone',
            'muted',
        );
    });
});

describe('SavesPage — load', () => {
    it('loads a save when its row is clicked, without navigating', async () => {
        const load = vi.fn(() => Promise.resolve());
        installBridge({ load });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-load-btn'));

        await waitFor(() => {
            expect(load).toHaveBeenCalledWith(toSlotId('slot-1'));
        });
        expect(push).not.toHaveBeenCalled();
    });

    it('surfaces a load rejection in the inline alert without toasting', async () => {
        const load = vi.fn(() => Promise.reject(new Error('no active session')));
        installBridge({ load });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-load-btn'));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/load failed/i);
        expect(alert).toHaveTextContent(/no active session/i);
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});

describe('SavesPage — delete', () => {
    it('opens a confirm dialog on delete click without deleting or loading', async () => {
        const del = vi.fn(() => Promise.resolve());
        const load = vi.fn(() => Promise.resolve());
        installBridge({ delete: del, load });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-delete-btn'));

        expect(screen.getByTestId('save-delete-dialog')).toBeInTheDocument();
        expect(del).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
    });

    it('cancelling the confirm dialog deletes nothing and keeps the rows', async () => {
        const del = vi.fn(() => Promise.resolve());
        installBridge({ delete: del });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-delete-btn'));
        await userEvent.click(screen.getByTestId('save-delete-cancel'));

        expect(del).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.queryByTestId('save-delete-dialog')).not.toBeInTheDocument();
        });
        expect(screen.getByTestId('save-load-btn')).toBeInTheDocument();
    });

    it('confirming closes the dialog, deletes the slot, and toasts success', async () => {
        const del = vi.fn(() => Promise.resolve());
        installBridge({ delete: del });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-delete-btn'));
        await userEvent.click(screen.getByTestId('save-delete-confirm'));

        await waitFor(() => {
            expect(del).toHaveBeenCalledWith(toSlotId('slot-1'));
        });
        expect(screen.queryByTestId('save-delete-dialog')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(
                useToastStore.getState().queue.some((toast) => toast.title === 'Save deleted'),
            ).toBe(true);
        });
    });

    it('surfaces a failure toast when deletion rejects, without an inline alert', async () => {
        const del = vi.fn(() => Promise.reject(new Error('disk gone')));
        installBridge({ delete: del });
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-delete-btn'));
        await userEvent.click(screen.getByTestId('save-delete-confirm'));

        await waitFor(() => {
            expect(
                useToastStore.getState().queue.some((toast) => toast.title === 'Delete failed'),
            ).toBe(true);
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('SavesPage — close', () => {
    it('closes back to the main menu, carrying the active gameId', async () => {
        renderPage();

        await userEvent.click(screen.getByTestId('saves-close-btn'));

        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('closes to the main menu without injecting a gameId when the URL has none', async () => {
        // No `?gameId=` in the URL → the close route must NOT fabricate a
        // default (main-menu deliberately has no default-game fallback).
        window.history.replaceState({}, '', '/saves');

        renderPage();

        await userEvent.click(screen.getByTestId('saves-close-btn'));

        expect(push).toHaveBeenCalledWith('/main-menu');
    });
});

describe('SavesPage — Escape behaviour (chrome-less Modal conversion)', () => {
    it('closes back to the main menu on Escape, carrying the active gameId', () => {
        renderPage();

        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('Escape closes only the confirm dialog while it is open, then the page', async () => {
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        await userEvent.click(screen.getByTestId('save-delete-btn'));
        expect(screen.getByTestId('save-delete-dialog')).toBeInTheDocument();

        // First Escape: the confirm (top layer) closes; the page stays.
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByTestId('save-delete-dialog')).not.toBeInTheDocument();
        });
        expect(push).not.toHaveBeenCalled();

        // Second Escape: the page modal closes back to the main menu.
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });
});

describe('SavesPage — regression (pure load/delete browser)', () => {
    it('renders no New Save form', () => {
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        expect(screen.queryByText(/new save/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('renders no per-row overwrite Save button', () => {
        mockSlots = [makeSlot('slot-1')];

        renderPage();

        expect(screen.queryByRole('button', { name: /^save /i })).not.toBeInTheDocument();
    });
});
