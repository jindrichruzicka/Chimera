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

    it('invokes bootstrapSaveStore with the saves bridge and the default gameId', () => {
        const unsubscribe = vi.fn();
        bootstrapSaveStoreMock.mockReturnValue(unsubscribe);
        const saves = { list: vi.fn(), onSlotUpdate: vi.fn(), onRestoreStatus: vi.fn() };
        (globalThis as { __chimera?: unknown }).__chimera = { saves };

        act(() => {
            root.render(<SaveStoreBootstrap />);
        });

        expect(bootstrapSaveStoreMock).toHaveBeenCalledTimes(1);
        expect(bootstrapSaveStoreMock).toHaveBeenCalledWith(saves, 'tactics');
    });

    it('passes the activeGameId prop through to bootstrapSaveStore', () => {
        bootstrapSaveStoreMock.mockReturnValue(vi.fn());
        const saves = { list: vi.fn(), onSlotUpdate: vi.fn(), onRestoreStatus: vi.fn() };
        (globalThis as { __chimera?: unknown }).__chimera = { saves };

        act(() => {
            root.render(<SaveStoreBootstrap activeGameId="custom-game" />);
        });

        expect(bootstrapSaveStoreMock).toHaveBeenCalledWith(saves, 'custom-game');
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
