// renderer/app/SaveStoreBootstrap.test.tsx
//
// Verifies that <SaveStoreBootstrap /> wires the saves API into the
// saveStore singleton on mount and unsubscribes on unmount.
// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 19 expects this global flag to be set before any act() runs in
// tests; without it the warning "The current testing environment is not
// configured to support act(...)" prints on every render.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../state/saveStoreBootstrap', () => ({
    bootstrapSaveStore: vi.fn(),
}));

// The active shell game id (URL `?gameId=` ?? live session) — the ONLY source of
// game context. Mocked so each test states the context explicitly.
let mockActiveShellGameId: string | null = null;
vi.mock('../shell/useActiveShellGameId', () => ({
    useActiveShellGameId: () => mockActiveShellGameId,
}));

import { bootstrapSaveStore } from '../state/saveStoreBootstrap';
import { SaveStoreBootstrap } from './SaveStoreBootstrap';

const bootstrapSaveStoreMock = vi.mocked(bootstrapSaveStore);

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    // Default to a game context present; the no-context case sets this to null.
    mockActiveShellGameId = 'some-game';
    bootstrapSaveStoreMock.mockReset();
});

afterEach(() => {
    if (mounted) {
        act(() => {
            root.unmount();
        });
    }
    container.remove();
    delete (globalThis as { __chimera?: unknown }).__chimera;
});

describe('SaveStoreBootstrap', () => {
    it('does nothing when window.__chimera.saves is unavailable', () => {
        act(() => {
            root.render(<SaveStoreBootstrap />);
        });
        expect(bootstrapSaveStoreMock).not.toHaveBeenCalled();
    });

    it('names NO game when there is no game context — the engine invents none', () => {
        // Regression guard: this component used to default the id to the literal
        // 'tactics', so the game-agnostic engine core named a concrete game and
        // fetched its saves on every route, including a bare `/main-menu`.
        bootstrapSaveStoreMock.mockReturnValue(vi.fn());
        const saves = { list: vi.fn(), onSlotUpdate: vi.fn(), onRestoreStatus: vi.fn() };
        (globalThis as { __chimera?: unknown }).__chimera = { saves };
        mockActiveShellGameId = null;

        act(() => {
            root.render(<SaveStoreBootstrap />);
        });

        expect(bootstrapSaveStoreMock).not.toHaveBeenCalled();
    });

    it('bootstraps with the active shell game id when a game context exists', () => {
        const unsubscribe = vi.fn();
        bootstrapSaveStoreMock.mockReturnValue(unsubscribe);
        const saves = { list: vi.fn(), onSlotUpdate: vi.fn(), onRestoreStatus: vi.fn() };
        (globalThis as { __chimera?: unknown }).__chimera = { saves };
        mockActiveShellGameId = 'some-game';

        act(() => {
            root.render(<SaveStoreBootstrap />);
        });

        expect(bootstrapSaveStoreMock).toHaveBeenCalledTimes(1);
        expect(bootstrapSaveStoreMock).toHaveBeenCalledWith(saves, 'some-game');
    });

    it('calls the unsubscribe returned by bootstrapSaveStore on unmount', () => {
        const unsubscribe = vi.fn();
        bootstrapSaveStoreMock.mockReturnValue(unsubscribe);
        const saves = { list: vi.fn(), onSlotUpdate: vi.fn(), onRestoreStatus: vi.fn() };
        (globalThis as { __chimera?: unknown }).__chimera = { saves };

        act(() => {
            root.render(<SaveStoreBootstrap />);
        });
        expect(unsubscribe).not.toHaveBeenCalled();

        act(() => {
            root.unmount();
        });
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        mounted = false;
    });
});
