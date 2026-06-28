// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionHistoryEntry } from '@chimera-engine/simulation/bridge/debug-api-types.js';
import { createDebugApiMock, makeActionHistoryEntry } from './__test-support__/DebugApiStubs';
import { ActionLogPanel } from './ActionLogPanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const ENTRIES: readonly ActionHistoryEntry[] = [
    makeActionHistoryEntry({
        tickApplied: 1,
        turnNumber: 1,
        type: 'engine:end_turn',
        playerId: 'player-a',
    }),
    makeActionHistoryEntry({
        tickApplied: 2,
        turnNumber: 2,
        type: 'game:move',
        playerId: 'player-b',
        payload: { x: 3 },
    }),
    makeActionHistoryEntry({
        tickApplied: 3,
        turnNumber: 2,
        type: 'game:attack',
        playerId: 'player-b',
    }),
];

function renderPanel(
    overrides: Partial<Parameters<typeof createDebugApiMock>[0]> = {},
    selectedTick: number | null = null,
): ReturnType<typeof createDebugApiMock> {
    const api = createDebugApiMock({
        getActionLog: vi.fn(() => Promise.resolve(ENTRIES)),
        ...overrides,
    });
    render(<ActionLogPanel api={api} selectedTick={selectedTick} />);
    return api;
}

async function waitUntilLoaded(): Promise<void> {
    await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
}

describe('ActionLogPanel', () => {
    it('shows a loading indicator while the log is pending', () => {
        renderPanel({
            getActionLog: vi.fn(() => new Promise<readonly ActionHistoryEntry[]>(() => {})),
        });

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when getActionLog rejects', async () => {
        renderPanel({ getActionLog: vi.fn(() => Promise.reject(new Error('log unavailable'))) });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('log unavailable');
        });
    });

    it('shows an empty state when no actions are recorded', async () => {
        renderPanel({
            getActionLog: vi.fn(() => Promise.resolve<readonly ActionHistoryEntry[]>([])),
        });

        await waitUntilLoaded();
        expect(screen.getByText('No actions recorded yet.')).toBeInTheDocument();
    });

    it('renders one table row per entry with tick, turn, type, player, and payload', async () => {
        renderPanel();

        await waitUntilLoaded();
        expect(screen.getByRole('table')).toBeInTheDocument();
        const row = screen.getByTestId('action-row-2');
        expect(row).toHaveTextContent('2');
        expect(row).toHaveTextContent('game:move');
        expect(row).toHaveTextContent('player-b');
        expect(row).toHaveTextContent('{"x":3}');
        expect(screen.getAllByTestId(/action-row-/)).toHaveLength(3);
    });

    it('filters by player id', async () => {
        const user = userEvent.setup();
        renderPanel();

        await waitUntilLoaded();
        await user.type(screen.getByLabelText('Player'), 'player-a');

        expect(screen.getByTestId('action-row-1')).toBeInTheDocument();
        expect(screen.queryByTestId('action-row-2')).not.toBeInTheDocument();
        expect(screen.queryByTestId('action-row-3')).not.toBeInTheDocument();
    });

    it('filters by action type', async () => {
        const user = userEvent.setup();
        renderPanel();

        await waitUntilLoaded();
        await user.type(screen.getByLabelText('Action type'), 'game:');

        expect(screen.queryByTestId('action-row-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('action-row-2')).toBeInTheDocument();
        expect(screen.getByTestId('action-row-3')).toBeInTheDocument();
    });

    it('filters by inclusive tick range with independent bounds', async () => {
        const user = userEvent.setup();
        renderPanel();

        await waitUntilLoaded();
        await user.type(screen.getByLabelText('From tick'), '2');

        expect(screen.queryByTestId('action-row-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('action-row-2')).toBeInTheDocument();
        expect(screen.getByTestId('action-row-3')).toBeInTheDocument();

        await user.type(screen.getByLabelText('To tick'), '2');

        expect(screen.getByTestId('action-row-2')).toBeInTheDocument();
        expect(screen.queryByTestId('action-row-3')).not.toBeInTheDocument();
    });

    it('composes filters with AND semantics', async () => {
        const user = userEvent.setup();
        renderPanel();

        await waitUntilLoaded();
        await user.type(screen.getByLabelText('Player'), 'player-b');
        await user.type(screen.getByLabelText('Action type'), 'attack');

        expect(screen.getAllByTestId(/action-row-/)).toHaveLength(1);
        expect(screen.getByTestId('action-row-3')).toBeInTheDocument();
    });

    it('shows a distinct message when filters match no entries', async () => {
        const user = userEvent.setup();
        renderPanel();

        await waitUntilLoaded();
        await user.type(screen.getByLabelText('Player'), 'nobody');

        expect(screen.getByText('No entries match the current filters.')).toBeInTheDocument();
        expect(screen.queryByText('No actions recorded yet.')).not.toBeInTheDocument();
    });

    it('refetches the log when Refresh is clicked', async () => {
        const user = userEvent.setup();
        const getActionLog = vi
            .fn<() => Promise<readonly ActionHistoryEntry[]>>()
            .mockResolvedValueOnce([ENTRIES[0]!])
            .mockResolvedValueOnce(ENTRIES);
        renderPanel({ getActionLog });

        await waitUntilLoaded();
        expect(screen.getAllByTestId(/action-row-/)).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Refresh' }));

        await waitFor(() => {
            expect(screen.getAllByTestId(/action-row-/)).toHaveLength(3);
        });
        expect(getActionLog).toHaveBeenCalledTimes(2);
    });

    it('marks the row matching the shared selected tick', async () => {
        renderPanel({}, 2);

        await waitUntilLoaded();
        expect(screen.getByTestId('action-row-2')).toHaveAttribute('data-selected', 'true');
        expect(screen.getByTestId('action-row-1')).toHaveAttribute('data-selected', 'false');
    });

    it('reports loaded entries through onEntriesLoaded after each fetch', async () => {
        const user = userEvent.setup();
        const onEntriesLoaded = vi.fn();
        const api = createDebugApiMock({
            getActionLog: vi.fn(() => Promise.resolve(ENTRIES)),
        });
        render(<ActionLogPanel api={api} onEntriesLoaded={onEntriesLoaded} selectedTick={null} />);

        await waitUntilLoaded();
        expect(onEntriesLoaded).toHaveBeenCalledTimes(1);
        expect(onEntriesLoaded).toHaveBeenCalledWith(ENTRIES);

        await user.click(screen.getByRole('button', { name: 'Refresh' }));

        await waitFor(() => {
            expect(onEntriesLoaded).toHaveBeenCalledTimes(2);
        });
    });

    it('invokes onNavigateToSnapshot with the row tick on double-click', async () => {
        const user = userEvent.setup();
        const onNavigateToSnapshot = vi.fn();
        const api = createDebugApiMock({
            getActionLog: vi.fn(() => Promise.resolve(ENTRIES)),
        });
        render(
            <ActionLogPanel
                api={api}
                onNavigateToSnapshot={onNavigateToSnapshot}
                selectedTick={null}
            />,
        );

        await waitUntilLoaded();
        await user.dblClick(screen.getByTestId('action-row-2'));

        expect(onNavigateToSnapshot).toHaveBeenCalledTimes(1);
        expect(onNavigateToSnapshot).toHaveBeenCalledWith(2);
    });
});
