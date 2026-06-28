// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    ProjectionResult,
    SnapshotResult,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';
import {
    createDebugApiMock,
    makeProjectionResult,
    makeSnapshotResult,
} from './__test-support__/DebugApiStubs';
import { ProjectionExplorerPanel } from './ProjectionExplorerPanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const FULL_SNAPSHOT = {
    tick: 5,
    seed: 42,
    players: {
        'player-a': { gold: 10 },
        'player-b': { gold: 3 },
    },
};

function makeProjectionFor(tick: number, viewer: string): ProjectionResult {
    return makeProjectionResult(tick, viewer, {
        tick,
        viewerId: viewer,
        players: {
            'player-a': { gold: viewer === 'player-a' ? 10 : 0 },
            'player-b': { gold: viewer === 'player-b' ? 3 : 0 },
        },
    });
}

describe('ProjectionExplorerPanel', () => {
    it('shows an empty state and fetches nothing while no tick is selected', () => {
        const api = createDebugApiMock();
        render(<ProjectionExplorerPanel api={api} selectedTick={null} />);

        expect(screen.getByText('Select a tick to explore its snapshot.')).toBeInTheDocument();
        expect(api.getSnapshot).not.toHaveBeenCalled();
        expect(api.getProjection).not.toHaveBeenCalled();
    });

    it('shows a loading indicator while the full snapshot is pending', () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => new Promise<SnapshotResult>(() => {})),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when the full snapshot fetch rejects', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.reject(new Error('tick_superseded_by_rewind'))),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('tick_superseded_by_rewind');
        });
        expect(api.getProjection).not.toHaveBeenCalled();
    });

    it('shows an alert when the projection fetch rejects', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection: vi.fn(() => Promise.reject(new Error('projection unavailable'))),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('projection unavailable');
        });
    });

    it('renders both trees with the first player projected by default', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection: vi.fn((tick: number, viewer: string) =>
                Promise.resolve(makeProjectionFor(tick, viewer)),
            ),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getAllByTestId('json-tree')).toHaveLength(2);
        });
        expect(api.getProjection).toHaveBeenCalledWith(5, 'player-a');
        expect(screen.getByLabelText('Player')).toHaveValue('player-a');
        expect(screen.getByText(/Projection for player-a/)).toBeInTheDocument();
    });

    it('refetches the projection when the player selection changes', async () => {
        const user = userEvent.setup();
        const getProjection = vi.fn((tick: number, viewer: string) =>
            Promise.resolve(makeProjectionFor(tick, viewer)),
        );
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection,
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getAllByTestId('json-tree')).toHaveLength(2);
        });

        await user.selectOptions(screen.getByLabelText('Player'), 'player-b');

        await waitFor(() => {
            expect(getProjection).toHaveBeenCalledWith(5, 'player-b');
        });
        await waitFor(() => {
            expect(screen.getByText(/Projection for player-b/)).toBeInTheDocument();
        });
    });

    it('highlights fields hidden by projection in the full-snapshot tree', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection: vi.fn((tick: number, viewer: string) =>
                Promise.resolve(makeProjectionFor(tick, viewer)),
            ),
        });
        const { container } = render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getAllByTestId('json-tree')).toHaveLength(2);
        });

        // `seed` exists only in the full snapshot → hidden; `viewerId` exists
        // only in the projection → extra.
        expect(container.querySelector('[data-highlight="hidden"]')).not.toBeNull();
        expect(container.querySelector('[data-highlight="extra"]')).not.toBeNull();
    });

    it('renders the highlight legend in the full-snapshot column, not the projection column', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection: vi.fn((tick: number, viewer: string) =>
                Promise.resolve(makeProjectionFor(tick, viewer)),
            ),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getAllByTestId('json-tree')).toHaveLength(2);
        });

        const fullColumn = screen.getByText(/Full snapshot \(debug truth\)/).closest('section');
        const projectionColumn = screen.getByLabelText('Player').closest('section');
        expect(fullColumn).not.toBeNull();
        expect(projectionColumn).not.toBeNull();

        for (const label of ['hidden', 'masked', 'projection-only']) {
            expect(within(fullColumn!).getByText(label)).toBeInTheDocument();
            expect(within(projectionColumn!).queryByText(label)).toBeNull();
        }
    });

    it('renders the projection column first and the full-snapshot column second', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() => Promise.resolve(makeSnapshotResult(5, FULL_SNAPSHOT))),
            getProjection: vi.fn((tick: number, viewer: string) =>
                Promise.resolve(makeProjectionFor(tick, viewer)),
            ),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getAllByTestId('json-tree')).toHaveLength(2);
        });

        const columns = screen
            .getByTestId('snapshot-panel')
            .querySelectorAll<HTMLElement>('section');
        expect(columns).toHaveLength(2);
        expect(within(columns[0]!).getByLabelText('Player')).toBeInTheDocument();
        expect(within(columns[1]!).getByText(/Full snapshot \(debug truth\)/)).toBeInTheDocument();
    });

    it('shows an empty state when the snapshot has no players', async () => {
        const api = createDebugApiMock({
            getSnapshot: vi.fn(() =>
                Promise.resolve(makeSnapshotResult(5, { tick: 5, players: {} })),
            ),
        });
        render(<ProjectionExplorerPanel api={api} selectedTick={5} />);

        await waitFor(() => {
            expect(screen.getByText('No players in this snapshot to project.')).toBeInTheDocument();
        });
        expect(api.getProjection).not.toHaveBeenCalled();
    });
});
