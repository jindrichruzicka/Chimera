// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayAPI, ReplayListItem } from '@chimera/electron/preload/api-types.js';
import ReplaysPage from './page';

function makeItem(overrides: Partial<ReplayListItem> = {}): ReplayListItem {
    return {
        path: '/replays/tactics/abc.chimera-replay',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        engineVersion: '0.1.0',
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: 9,
        playerIds: ['p1', 'p2'],
        ...overrides,
    };
}

function installReplayBridge(replay: Partial<ReplayAPI>): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { replay },
    });
}

beforeEach(() => {
    window.history.replaceState({}, '', '/replays?gameId=tactics');
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('ReplaysPage', () => {
    it('lists replays for the active game with their metadata', async () => {
        const list = vi.fn(() =>
            Promise.resolve([
                makeItem({ path: '/replays/tactics/a.chimera-replay', gameVersion: '1.2.3' }),
                makeItem({
                    path: '/replays/tactics/b.chimera-replay',
                    playerIds: ['alice', 'bob'],
                }),
            ]),
        );
        installReplayBridge({ list });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
        });
        expect(list).toHaveBeenCalledWith('tactics');
        expect(screen.getByText(/alice/)).toBeInTheDocument();
    });

    it('shows an accessible empty state when there are no replays', async () => {
        installReplayBridge({ list: vi.fn(() => Promise.resolve([])) });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByLabelText(/no replays saved yet/i)).toBeInTheDocument();
        });
    });

    it('shows a loading state before the list resolves', () => {
        installReplayBridge({ list: vi.fn(() => new Promise<ReplayListItem[]>(() => undefined)) });

        render(<ReplaysPage />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an error state when listing fails', async () => {
        installReplayBridge({ list: vi.fn(() => Promise.reject(new Error('disk gone'))) });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    it('opens the selected replay in the player via openInPlayer', async () => {
        const openInPlayer = vi.fn(() => Promise.resolve());
        installReplayBridge({
            list: vi.fn(() =>
                Promise.resolve([makeItem({ path: '/replays/tactics/pick.chimera-replay' })]),
            ),
            openInPlayer,
        });

        render(<ReplaysPage />);

        const openButton = await screen.findByRole('button', { name: /open replay/i });
        await userEvent.click(openButton);

        expect(openInPlayer).toHaveBeenCalledWith('/replays/tactics/pick.chimera-replay');
    });
});
