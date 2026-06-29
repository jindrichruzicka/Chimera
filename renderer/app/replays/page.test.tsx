// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PerspectiveReplayAPI,
    ReplayAPI,
    ReplayListItem,
} from '@chimera-engine/simulation/bridge/api-types.js';
import ReplaysPage from './page';

// Perspective rows navigate to the player with a client `router.push` (the
// player reads its `?path=`/`?kind=` query reactively via `useSearchParams`).
// Hoisted so the mock factory can close over a stable spy.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
}));

const PERSPECTIVE_PATH = '/replays/tactics/persp-1.chimera-perspective-replay';

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

/**
 * Install a bridge that answers both the deterministic `list` and the
 * perspective `perspective.list`; either defaults to an empty result so a test
 * only has to supply the surface it exercises.
 */
function installBridge(
    opts: {
        list?: ReplayAPI['list'];
        perspectiveList?: PerspectiveReplayAPI['list'];
        openInPlayer?: ReplayAPI['openInPlayer'];
    } = {},
): void {
    const replay = {
        list: opts.list ?? vi.fn(() => Promise.resolve([])),
        openInPlayer: opts.openInPlayer ?? vi.fn(() => Promise.resolve()),
        perspective: { list: opts.perspectiveList ?? vi.fn(() => Promise.resolve([])) },
    } as unknown as ReplayAPI;
    Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });
}

beforeEach(() => {
    push.mockClear();
    window.history.replaceState({}, '', '/replays?gameId=tactics');
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('ReplaysPage', () => {
    it('lists deterministic replays with their metadata and a Deterministic badge', async () => {
        const list = vi.fn(() =>
            Promise.resolve([
                makeItem({ path: '/replays/tactics/a.chimera-replay', gameVersion: '1.2.3' }),
                makeItem({
                    path: '/replays/tactics/b.chimera-replay',
                    playerIds: ['alice', 'bob'],
                }),
            ]),
        );
        installBridge({ list });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
        });
        expect(list).toHaveBeenCalledWith('tactics');
        expect(screen.getByText(/alice/)).toBeInTheDocument();
        expect(screen.getAllByText(/^deterministic$/i).length).toBeGreaterThan(0);
    });

    it('lists perspective replays with a filename label and a Perspective badge', async () => {
        const perspectiveList = vi.fn(() => Promise.resolve([PERSPECTIVE_PATH]));
        installBridge({ perspectiveList });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByText(/persp-1\.chimera-perspective-replay/)).toBeInTheDocument();
        });
        expect(perspectiveList).toHaveBeenCalledWith('tactics');
        expect(screen.getByText(/^perspective$/i)).toBeInTheDocument();
    });

    it('lists both replay kinds together for the active game', async () => {
        const list = vi.fn(() => Promise.resolve([makeItem()]));
        const perspectiveList = vi.fn(() => Promise.resolve([PERSPECTIVE_PATH]));
        installBridge({ list, perspectiveList });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByText(/^perspective$/i)).toBeInTheDocument();
        });
        expect(screen.getAllByText(/^deterministic$/i).length).toBeGreaterThan(0);
        expect(list).toHaveBeenCalledWith('tactics');
        expect(perspectiveList).toHaveBeenCalledWith('tactics');
    });

    it('tags the page container and Open buttons with E2E test ids', async () => {
        installBridge({ list: vi.fn(() => Promise.resolve([makeItem()])) });

        render(<ReplaysPage />);

        expect(screen.getByTestId('replays-page')).toBeInTheDocument();
        expect(await screen.findByTestId('replay-open-btn')).toBeInTheDocument();
    });

    it('shows the empty state only when both kinds are empty', async () => {
        installBridge({});

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByLabelText(/no replays saved yet/i)).toBeInTheDocument();
        });
    });

    it('shows a loading state before the lists resolve', () => {
        installBridge({ list: vi.fn(() => new Promise<ReplayListItem[]>(() => undefined)) });

        render(<ReplaysPage />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an error state when listing deterministic replays fails', async () => {
        installBridge({ list: vi.fn(() => Promise.reject(new Error('disk gone'))) });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    it('shows an error state when listing perspective replays fails', async () => {
        installBridge({
            perspectiveList: vi.fn(() => Promise.reject(new Error('perspective gone'))),
        });

        render(<ReplaysPage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    it('opens a deterministic replay in the player via openInPlayer', async () => {
        const openInPlayer = vi.fn(() => Promise.resolve());
        installBridge({
            list: vi.fn(() =>
                Promise.resolve([makeItem({ path: '/replays/tactics/pick.chimera-replay' })]),
            ),
            openInPlayer,
        });

        render(<ReplaysPage />);

        const openButton = await screen.findByRole('button', { name: /open replay/i });
        await userEvent.click(openButton);

        expect(openInPlayer).toHaveBeenCalledWith('/replays/tactics/pick.chimera-replay');
        expect(push).not.toHaveBeenCalled();
    });

    it('opens a perspective replay by routing with kind=perspective, carrying the active gameId', async () => {
        // The active `?gameId=` (set in beforeEach) must ride along onto the player
        // route — otherwise leaving the replay drops back to the engine-default menu.
        installBridge({ perspectiveList: vi.fn(() => Promise.resolve([PERSPECTIVE_PATH])) });

        render(<ReplaysPage />);

        const openButton = await screen.findByRole('button', {
            name: /open perspective replay/i,
        });
        await userEvent.click(openButton);

        expect(push).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent(PERSPECTIVE_PATH)}&kind=perspective&gameId=tactics`,
        );
    });
});
