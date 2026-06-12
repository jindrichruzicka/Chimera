// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera/electron/preload/api-types.js';
import type { ChimeraDebugApi, TickEntry } from '@chimera/electron/preload/debug-api-types.js';
import {
    createDebugApiMock,
    makeLiveTickEvent,
    makeTickEntry,
    type DebugApiMock,
} from './__test-support__/DebugApiStubs';
import { TimelinePanel, type TimelinePanelProps } from './TimelinePanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

interface PanelHarness {
    readonly api: DebugApiMock;
    readonly props: TimelinePanelProps;
}

function renderPanel(
    apiOverrides: Partial<ChimeraDebugApi> = {},
    propOverrides: Partial<Omit<TimelinePanelProps, 'api'>> = {},
): PanelHarness & ReturnType<typeof render> {
    const api = createDebugApiMock(apiOverrides);
    const props: TimelinePanelProps = {
        api,
        selectedTick: null,
        liveMode: true,
        onSelectTick: vi.fn(),
        onLiveModeChange: vi.fn(),
        onTicksLoaded: vi.fn(),
        ...propOverrides,
    };
    return { ...render(<TimelinePanel {...props} />), api, props };
}

async function waitUntilLoaded(): Promise<void> {
    await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
}

const TICKS: readonly TickEntry[] = [
    makeTickEntry({
        tick: 1,
        inRingBuffer: false,
        actionType: 'engine:end_turn',
        playerId: playerId('player-a'),
        turnNumber: 1,
    }),
    makeTickEntry({ tick: 2, inRingBuffer: true }),
];

describe('TimelinePanel', () => {
    it('shows a loading indicator while listTicks is pending', () => {
        renderPanel({ listTicks: vi.fn(() => new Promise<readonly TickEntry[]>(() => {})) });

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when listTicks rejects', async () => {
        renderPanel({ listTicks: vi.fn(() => Promise.reject(new Error('bridge failed'))) });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('bridge failed');
        });
    });

    it('shows an empty state when no ticks are recorded', async () => {
        renderPanel({ listTicks: vi.fn(() => Promise.resolve<readonly TickEntry[]>([])) });

        await waitUntilLoaded();
        expect(screen.getByText('No ticks recorded yet.')).toBeInTheDocument();
    });

    it('renders tick rows ascending with action metadata when present', async () => {
        renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        const rows = screen.getAllByTestId(/timeline-tick-/);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('1');
        expect(rows[0]).toHaveTextContent('engine:end_turn');
        expect(rows[0]).toHaveTextContent('player-a');
        expect(rows[1]).toHaveTextContent('2');
    });

    it('highlights ring-buffered ticks and marks them with data-buffered', async () => {
        renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        expect(screen.getByTestId('timeline-tick-1')).toHaveAttribute('data-buffered', 'false');
        expect(screen.getByTestId('timeline-tick-2')).toHaveAttribute('data-buffered', 'true');
        expect(screen.getByTestId('timeline-tick-2')).toHaveTextContent('buffered');
    });

    it('selects a tick on row click and pauses live mode', async () => {
        const user = userEvent.setup();
        const { props } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        await user.click(screen.getByTestId('timeline-tick-1'));

        expect(props.onSelectTick).toHaveBeenCalledWith(1);
        expect(props.onLiveModeChange).toHaveBeenCalledWith(false);
    });

    it('marks the selected tick row with aria-current', async () => {
        renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) }, { selectedTick: 2 });

        await waitUntilLoaded();
        expect(screen.getByTestId('timeline-tick-2')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('timeline-tick-1')).not.toHaveAttribute('aria-current');
    });

    it('subscribes to live pushes on mount', async () => {
        const { api } = renderPanel();

        await waitUntilLoaded();
        expect(api.subscribeLive).toHaveBeenCalledOnce();
        expect(api.onLiveTick).toHaveBeenCalledOnce();
    });

    it('appends a buffered row for each live tick and dedupes repeats', async () => {
        const { api } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        act(() => {
            api.emitLiveTick(makeLiveTickEvent(3));
            api.emitLiveTick(makeLiveTickEvent(3));
            api.emitLiveTick(makeLiveTickEvent(2));
        });

        const rows = screen.getAllByTestId(/timeline-tick-/);
        expect(rows).toHaveLength(3);
        expect(screen.getByTestId('timeline-tick-3')).toHaveAttribute('data-buffered', 'true');
    });

    it('auto-scrolls the tick region to the bottom on live append while live', async () => {
        const { api } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        const region = screen.getByRole('region', { name: 'Timeline ticks' });
        // jsdom has no layout, so give the scroller a synthetic content height.
        Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 480 });

        act(() => {
            api.emitLiveTick(makeLiveTickEvent(3));
        });

        expect(region.scrollTop).toBe(480);
    });

    it('does not auto-scroll when live mode is paused', async () => {
        const { api } = renderPanel(
            { listTicks: vi.fn(() => Promise.resolve(TICKS)) },
            { liveMode: false },
        );

        await waitUntilLoaded();
        const region = screen.getByRole('region', { name: 'Timeline ticks' });
        Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 480 });

        act(() => {
            api.emitLiveTick(makeLiveTickEvent(3));
        });

        expect(region.scrollTop).toBe(0);
    });

    it('pauses live mode when the user scrolls away from the bottom', async () => {
        const { props } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        const region = screen.getByRole('region', { name: 'Timeline ticks' });
        Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 600 });
        Object.defineProperty(region, 'clientHeight', { configurable: true, value: 200 });

        region.scrollTop = 0;
        fireEvent.scroll(region);

        expect(props.onLiveModeChange).toHaveBeenCalledWith(false);
    });

    it('does not pause live mode while the view stays pinned to the bottom', async () => {
        const { props } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        const region = screen.getByRole('region', { name: 'Timeline ticks' });
        Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 600 });
        Object.defineProperty(region, 'clientHeight', { configurable: true, value: 200 });

        region.scrollTop = 400;
        fireEvent.scroll(region);

        expect(props.onLiveModeChange).not.toHaveBeenCalled();
    });

    it('resumes live mode through the Live toggle', async () => {
        const user = userEvent.setup();
        const { props } = renderPanel(
            { listTicks: vi.fn(() => Promise.resolve(TICKS)) },
            { liveMode: false },
        );

        await waitUntilLoaded();
        const toggle = screen.getByRole('button', { name: 'Live' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');

        await user.click(toggle);
        expect(props.onLiveModeChange).toHaveBeenCalledWith(true);
    });

    it('reports the loaded ticks once through onTicksLoaded', async () => {
        const { props } = renderPanel({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });

        await waitUntilLoaded();
        expect(props.onTicksLoaded).toHaveBeenCalledOnce();
        expect(props.onTicksLoaded).toHaveBeenCalledWith(TICKS);
    });

    it('removes the push listener and unsubscribes live on unmount', async () => {
        const { api, unmount } = renderPanel();

        await waitUntilLoaded();
        unmount();

        expect(api.liveTickUnsubscribe).toHaveBeenCalledOnce();
        expect(api.unsubscribeLive).toHaveBeenCalledOnce();
    });
});
