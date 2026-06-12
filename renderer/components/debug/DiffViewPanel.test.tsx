// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotDiff, TickEntry } from '@chimera/electron/preload/debug-api-types.js';
import {
    createDebugApiMock,
    makeDiffEntry,
    makeSnapshotDiff,
    makeTickEntry,
} from './__test-support__/DebugApiStubs';
import { DiffViewPanel } from './DiffViewPanel';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const THREE_TICKS = [
    makeTickEntry({ tick: 1 }),
    makeTickEntry({ tick: 5 }),
    makeTickEntry({ tick: 9 }),
];

function makeSampleDiff(fromTick: number, toTick: number): SnapshotDiff {
    return makeSnapshotDiff(fromTick, toTick, [
        makeDiffEntry({ path: 'events.0', kind: 'added', after: 'spawn' }),
        makeDiffEntry({ path: 'entities.e-1', kind: 'removed', before: { hp: 5 } }),
        makeDiffEntry({
            path: 'players.player-a.gold',
            kind: 'changed',
            before: 10,
            after: 0,
        }),
    ]);
}

describe('DiffViewPanel', () => {
    it('shows a loading indicator while the tick list is pending', () => {
        const api = createDebugApiMock({
            listTicks: vi.fn(() => new Promise<readonly TickEntry[]>(() => {})),
        });
        render(<DiffViewPanel api={api} selectedTick={null} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when the tick list fetch rejects', async () => {
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.reject(new Error('bridge unavailable'))),
        });
        render(<DiffViewPanel api={api} selectedTick={null} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('bridge unavailable');
        });
    });

    it('asks for more ticks and fetches no diff when fewer than two exist', async () => {
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve([makeTickEntry({ tick: 1 })])),
        });
        render(<DiffViewPanel api={api} selectedTick={1} />);

        await waitFor(() => {
            expect(
                screen.getByText('Need at least two recorded ticks to diff.'),
            ).toBeInTheDocument();
        });
        expect(api.diff).not.toHaveBeenCalled();
    });

    it('defaults to the selected tick and its predecessor, rendering entries and summary', async () => {
        const diff = vi.fn((fromTick: number, toTick: number) =>
            Promise.resolve(makeSampleDiff(fromTick, toTick)),
        );
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff,
        });
        render(<DiffViewPanel api={api} selectedTick={9} />);

        await waitFor(() => {
            expect(diff).toHaveBeenCalledWith(5, 9);
        });
        expect(screen.getByLabelText('From tick')).toHaveValue('5');
        expect(screen.getByLabelText('To tick')).toHaveValue('9');

        expect(await screen.findByText('1 added')).toBeInTheDocument();
        expect(screen.getByText('1 removed')).toBeInTheDocument();
        expect(screen.getByText('1 changed')).toBeInTheDocument();

        expect(screen.getByText('players.player-a.gold')).toBeInTheDocument();
        expect(screen.getByText('entities.e-1')).toBeInTheDocument();
        expect(screen.getByText('events.0')).toBeInTheDocument();
        expect(screen.getByText('{"hp":5}')).toBeInTheDocument();
        expect(screen.getByText('"spawn"')).toBeInTheDocument();
    });

    it('seeds the first valid pair when the selection is the oldest tick', async () => {
        // The oldest tick has no predecessor; seeding must not degenerate
        // into a self-diff of the selected tick against itself.
        const diff = vi.fn((fromTick: number, toTick: number) =>
            Promise.resolve(makeSampleDiff(fromTick, toTick)),
        );
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff,
        });
        render(<DiffViewPanel api={api} selectedTick={1} />);

        await waitFor(() => {
            expect(diff).toHaveBeenCalledWith(1, 5);
        });
        expect(diff).not.toHaveBeenCalledWith(1, 1);
        expect(screen.getByLabelText('From tick')).toHaveValue('1');
        expect(screen.getByLabelText('To tick')).toHaveValue('5');
    });

    it('falls back to the newest tick when nothing is selected', async () => {
        const diff = vi.fn((fromTick: number, toTick: number) =>
            Promise.resolve(makeSampleDiff(fromTick, toTick)),
        );
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff,
        });
        render(<DiffViewPanel api={api} selectedTick={null} />);

        await waitFor(() => {
            expect(diff).toHaveBeenCalledWith(5, 9);
        });
    });

    it('refetches when the from-tick picker changes', async () => {
        const user = userEvent.setup();
        const diff = vi.fn((fromTick: number, toTick: number) =>
            Promise.resolve(makeSampleDiff(fromTick, toTick)),
        );
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff,
        });
        render(<DiffViewPanel api={api} selectedTick={9} />);

        await waitFor(() => {
            expect(diff).toHaveBeenCalledWith(5, 9);
        });

        await user.selectOptions(screen.getByLabelText('From tick'), '1');

        await waitFor(() => {
            expect(diff).toHaveBeenCalledWith(1, 9);
        });
    });

    it('shows an alert when the diff fetch rejects', async () => {
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff: vi.fn(() => Promise.reject(new Error('tick_superseded_by_rewind'))),
        });
        render(<DiffViewPanel api={api} selectedTick={9} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('tick_superseded_by_rewind');
        });
    });

    it('renders bigint before/after values without crashing', async () => {
        // FixedPoint simulation state is bigint (Invariant #75) and survives
        // structured-clone IPC, so diff entries can carry it verbatim.
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff: vi.fn((fromTick: number, toTick: number) =>
                Promise.resolve(
                    makeSnapshotDiff(fromTick, toTick, [
                        makeDiffEntry({
                            path: 'players.player-a.gold',
                            kind: 'changed',
                            before: { amount: 10n },
                            after: 3n,
                        }),
                    ]),
                ),
            ),
        });
        render(<DiffViewPanel api={api} selectedTick={9} />);

        expect(await screen.findByText('{"amount":"10n"}')).toBeInTheDocument();
        expect(screen.getByText('"3n"')).toBeInTheDocument();
    });

    it('reports when two ticks have no differences', async () => {
        const api = createDebugApiMock({
            listTicks: vi.fn(() => Promise.resolve(THREE_TICKS)),
            diff: vi.fn((fromTick: number, toTick: number) =>
                Promise.resolve(makeSnapshotDiff(fromTick, toTick)),
            ),
        });
        render(<DiffViewPanel api={api} selectedTick={9} />);

        await waitFor(() => {
            expect(
                screen.getByText('No differences between tick 5 and tick 9.'),
            ).toBeInTheDocument();
        });
        expect(screen.getByText('0 added')).toBeInTheDocument();
    });
});
