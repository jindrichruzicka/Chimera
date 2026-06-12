// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotResult } from '@chimera/electron/preload/debug-api-types.js';
import { createDebugApiMock, makeSnapshotResult } from './__test-support__/DebugApiStubs';
import { SnapshotInspectorPanel } from './SnapshotInspectorPanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('SnapshotInspectorPanel', () => {
    it('shows an empty state and fetches nothing while no tick is selected', () => {
        const api = createDebugApiMock();
        render(<SnapshotInspectorPanel api={api} selectedTick={null} />);

        expect(screen.getByText('Select a tick to inspect its snapshot.')).toBeInTheDocument();
        expect(api.getSnapshot).not.toHaveBeenCalled();
    });

    it('shows a loading indicator while the snapshot is pending', () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => new Promise<SnapshotResult>(() => {})),
        });
        render(<SnapshotInspectorPanel api={api} selectedTick={5} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when getSnapshot rejects', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.reject(new Error('tick_superseded_by_rewind'))),
        });
        render(<SnapshotInspectorPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('tick_superseded_by_rewind');
        });
    });

    it('renders the snapshot JSON tree for the selected tick', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() =>
                Promise.resolve(makeSnapshotResult(5, { hero: { hp: 7 }, phase: 'playing' })),
            ),
        });
        render(<SnapshotInspectorPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getByTestId('json-tree')).toBeInTheDocument();
        });
        expect(api.getSnapshot).toHaveBeenCalledWith(5);
        expect(screen.getByText(/Tick 5/)).toBeInTheDocument();
        expect(screen.getByText('hero')).toBeInTheDocument();
        expect(screen.getByText('"playing"')).toBeInTheDocument();
    });

    it('refetches when the selected tick changes', async () => {
        const getSnapshot = vi.fn((tick: number) =>
            Promise.resolve(makeSnapshotResult(tick, { marker: `tick-${tick}` })),
        );
        const api = createDebugApiMock({ getSnapshot });
        const { rerender } = render(<SnapshotInspectorPanel api={api} selectedTick={1} />);

        await waitFor(() => {
            expect(screen.getByText('"tick-1"')).toBeInTheDocument();
        });

        rerender(<SnapshotInspectorPanel api={api} selectedTick={2} />);

        await waitFor(() => {
            expect(screen.getByText('"tick-2"')).toBeInTheDocument();
        });
        expect(getSnapshot).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('"tick-1"')).not.toBeInTheDocument();
    });

    it('ignores a stale response that resolves after a newer selection', async () => {
        const resolvers = new Map<number, (result: SnapshotResult) => void>();
        const api = createDebugApiMock({
            getSnapshot: vi.fn(
                (tick: number) =>
                    new Promise<SnapshotResult>((resolve) => {
                        resolvers.set(tick, resolve);
                    }),
            ),
        });
        const { rerender } = render(<SnapshotInspectorPanel api={api} selectedTick={1} />);
        rerender(<SnapshotInspectorPanel api={api} selectedTick={2} />);

        await act(async () => {
            resolvers.get(2)?.(makeSnapshotResult(2, { winner: true }));
        });
        await waitFor(() => {
            expect(screen.getByText('winner')).toBeInTheDocument();
        });

        await act(async () => {
            resolvers.get(1)?.(makeSnapshotResult(1, { loser: true }));
        });

        expect(screen.queryByText('loser')).not.toBeInTheDocument();
        expect(screen.getByText('winner')).toBeInTheDocument();
    });
});
