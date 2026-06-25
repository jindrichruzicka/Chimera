// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerfStats } from '@chimera/simulation/bridge/debug-api-types.js';
import {
    createDebugApiMock,
    makeLiveTickEvent,
    makePerfStats,
} from './__test-support__/DebugApiStubs';
import { PerformancePanel } from './PerformancePanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PerformancePanel', () => {
    it('shows a loading indicator while the stats are pending', () => {
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() => new Promise<PerfStats>(() => {})),
        });
        render(<PerformancePanel api={api} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when getPerfStats rejects', async () => {
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() => Promise.reject(new Error('bridge unavailable'))),
        });
        render(<PerformancePanel api={api} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('bridge unavailable');
        });
    });

    it('renders the stats grid, ring-buffer fill, and tick-duration graph', async () => {
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() => Promise.resolve(makePerfStats())),
        });
        const { container } = render(<PerformancePanel api={api} />);

        expect(await screen.findByTestId('stat-avg')).toHaveTextContent('1.50 ms');
        expect(screen.getByTestId('stat-max')).toHaveTextContent('4.00 ms');
        expect(screen.getByTestId('stat-samples')).toHaveTextContent('3');
        expect(screen.getByTestId('stat-actions')).toHaveTextContent('7');

        const progress = screen.getByRole('progressbar');
        expect(progress).toHaveAttribute('aria-valuenow', '3');
        expect(progress).toHaveAttribute('aria-valuemax', '128');
        expect(screen.getByText('3 / 128 snapshots buffered')).toBeInTheDocument();

        expect(screen.getByTestId('perf-graph')).toBeInTheDocument();
        const points = container.querySelector('polyline')?.getAttribute('points');
        expect(points?.trim().split(/\s+/)).toHaveLength(3);

        expect(api.subscribeLive).toHaveBeenCalled();
    });

    it('refetches and re-renders on a live tick without flashing the loader', async () => {
        const getPerfStats = vi
            .fn<() => Promise<PerfStats>>()
            .mockResolvedValueOnce(makePerfStats())
            .mockResolvedValueOnce(makePerfStats({ avgTickDurationMs: 2.25 }));
        const api = createDebugApiMock({ getPerfStats });
        render(<PerformancePanel api={api} />);

        expect(await screen.findByTestId('stat-avg')).toHaveTextContent('1.50 ms');

        act(() => {
            api.emitLiveTick(makeLiveTickEvent(10));
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByTestId('stat-avg')).toHaveTextContent('2.25 ms');
        });
        expect(getPerfStats).toHaveBeenCalledTimes(2);
    });

    it('coalesces live ticks that arrive while a refetch is in flight', async () => {
        const resolvers: ((stats: PerfStats) => void)[] = [];
        const getPerfStats = vi.fn(
            () =>
                new Promise<PerfStats>((resolve) => {
                    resolvers.push(resolve);
                }),
        );
        const api = createDebugApiMock({ getPerfStats });
        render(<PerformancePanel api={api} />);

        expect(getPerfStats).toHaveBeenCalledTimes(1);
        await act(async () => {
            resolvers[0]?.(makePerfStats());
        });

        act(() => {
            api.emitLiveTick(makeLiveTickEvent(10));
        });
        expect(getPerfStats).toHaveBeenCalledTimes(2);

        act(() => {
            api.emitLiveTick(makeLiveTickEvent(11));
            api.emitLiveTick(makeLiveTickEvent(12));
        });
        expect(getPerfStats).toHaveBeenCalledTimes(2);

        await act(async () => {
            resolvers[1]?.(makePerfStats({ avgTickDurationMs: 2 }));
        });
        expect(getPerfStats).toHaveBeenCalledTimes(3);

        await act(async () => {
            resolvers[2]?.(makePerfStats({ avgTickDurationMs: 3 }));
        });
        expect(getPerfStats).toHaveBeenCalledTimes(3);
    });

    it('shares the window-scoped live subscription across Inspector panels', async () => {
        // Main-side subscription state is one slot per window
        // (debug-bridge.ts), so two panels must subscribe once between them
        // and unsubscribe only when the last one unmounts — the panel has to
        // route through the refcounted acquireLiveSubscription helper rather
        // than calling subscribeLive directly.
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() => Promise.resolve(makePerfStats())),
        });
        const first = render(<PerformancePanel api={api} />);
        const second = render(<PerformancePanel api={api} />);
        await waitFor(() => {
            expect(screen.getAllByTestId('stat-avg')).toHaveLength(2);
        });

        expect(api.subscribeLive).toHaveBeenCalledTimes(1);

        first.unmount();
        expect(api.unsubscribeLive).not.toHaveBeenCalled();

        second.unmount();
        expect(api.unsubscribeLive).toHaveBeenCalledTimes(1);
    });

    it('tears down the live subscription on unmount', async () => {
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() => Promise.resolve(makePerfStats())),
        });
        const { unmount } = render(<PerformancePanel api={api} />);
        await screen.findByTestId('stat-avg');

        unmount();

        expect(api.liveTickUnsubscribe).toHaveBeenCalled();
        expect(api.unsubscribeLive).toHaveBeenCalled();
    });

    it('reports when no tick samples exist yet', async () => {
        const api = createDebugApiMock({
            getPerfStats: vi.fn(() =>
                Promise.resolve(makePerfStats({ recentSamples: [], sampleCount: 0 })),
            ),
        });
        render(<PerformancePanel api={api} />);

        expect(await screen.findByText('No tick samples yet.')).toBeInTheDocument();
        expect(screen.queryByTestId('perf-graph')).not.toBeInTheDocument();
    });
});
