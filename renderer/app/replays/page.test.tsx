// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PerspectiveReplayAPI,
    ReplayAPI,
    ReplayListItem,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { EscapeStackProvider } from '../../components/ui';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useToastStore } from '../../state/toastStore.js';
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
        delete?: ReplayAPI['delete'];
        perspectiveDelete?: PerspectiveReplayAPI['delete'];
    } = {},
): void {
    const replay = {
        list: opts.list ?? vi.fn(() => Promise.resolve([])),
        openInPlayer: opts.openInPlayer ?? vi.fn(() => Promise.resolve()),
        delete: opts.delete ?? vi.fn(() => Promise.resolve()),
        perspective: {
            list: opts.perspectiveList ?? vi.fn(() => Promise.resolve([])),
            delete: opts.perspectiveDelete ?? vi.fn(() => Promise.resolve()),
        },
    } as unknown as ReplayAPI;
    Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });
}

// The page itself and its confirm dialog are <Modal>s, which register
// Escape-to-close on the shared overlay stack; render under EscapeStackProvider
// so `useEscapeLayer` resolves. The page's user-facing strings come from
// `useTranslate()`, which throws outside an I18nProvider, so that wraps it too.
function renderPage(gameOverride?: Record<string, string>): ReturnType<typeof render> {
    return render(
        <I18nProvider {...(gameOverride === undefined ? {} : { gameOverride })}>
            <EscapeStackProvider>
                <ReplaysPage />
            </EscapeStackProvider>
        </I18nProvider>,
    );
}

beforeEach(() => {
    push.mockClear();
    useToastStore.getState().dismissAll();
    window.history.replaceState({}, '', '/replays?gameId=tactics');
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    useToastStore.getState().dismissAll();
    vi.restoreAllMocks();
});

describe('ReplaysPage', () => {
    it('renders the modal title from the engine.replays.title token', async () => {
        installBridge({});

        renderPage({ 'engine.replays.title': 'Recordings' });

        expect(await screen.findByText('Recordings')).toBeInTheDocument();
    });

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

        renderPage();

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

        renderPage();

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

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/^perspective$/i)).toBeInTheDocument();
        });
        expect(screen.getAllByText(/^deterministic$/i).length).toBeGreaterThan(0);
        expect(list).toHaveBeenCalledWith('tactics');
        expect(perspectiveList).toHaveBeenCalledWith('tactics');
    });

    it('tags the page container and Open buttons with E2E test ids', async () => {
        installBridge({ list: vi.fn(() => Promise.resolve([makeItem()])) });

        renderPage();

        expect(screen.getByTestId('replays-page')).toBeInTheDocument();
        expect(await screen.findByTestId('replay-open-btn')).toBeInTheDocument();
    });

    it('shows the empty state only when both kinds are empty', async () => {
        installBridge({});

        renderPage();

        await waitFor(() => {
            expect(screen.getByLabelText(/no replays saved yet/i)).toBeInTheDocument();
        });
    });

    it('shows a loading state before the lists resolve', () => {
        installBridge({ list: vi.fn(() => new Promise<ReplayListItem[]>(() => undefined)) });

        renderPage();

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an error state when listing deterministic replays fails', async () => {
        installBridge({ list: vi.fn(() => Promise.reject(new Error('disk gone'))) });

        renderPage();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
    });

    it('shows an error state when listing perspective replays fails', async () => {
        installBridge({
            perspectiveList: vi.fn(() => Promise.reject(new Error('perspective gone'))),
        });

        renderPage();

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

        renderPage();

        const openButton = await screen.findByRole('button', { name: /open replay/i });
        await userEvent.click(openButton);

        expect(openInPlayer).toHaveBeenCalledWith('/replays/tactics/pick.chimera-replay');
        expect(push).not.toHaveBeenCalled();
    });

    it('opens a perspective replay by routing with kind=perspective, carrying the active gameId', async () => {
        // The active `?gameId=` (set in beforeEach) must ride along onto the player
        // route — otherwise leaving the replay drops back to the engine-default menu.
        installBridge({ perspectiveList: vi.fn(() => Promise.resolve([PERSPECTIVE_PATH])) });

        renderPage();

        const openButton = await screen.findByRole('button', {
            name: /open perspective replay/i,
        });
        await userEvent.click(openButton);

        expect(push).toHaveBeenCalledWith(
            `/replays/player/?path=${encodeURIComponent(PERSPECTIVE_PATH)}&kind=perspective&gameId=tactics`,
        );
    });

    it('closes back to the main menu, carrying the active gameId', async () => {
        installBridge({});

        renderPage();

        const closeButton = screen.getByTestId('replays-close-btn');
        await userEvent.click(closeButton);

        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('closes to the main menu without injecting a gameId when the URL has none', async () => {
        // No `?gameId=` in the URL → the close route must NOT fabricate the page's
        // 'tactics' fallback (main-menu deliberately has no default-game fallback).
        window.history.replaceState({}, '', '/replays');
        installBridge({});

        renderPage();

        const closeButton = screen.getByTestId('replays-close-btn');
        await userEvent.click(closeButton);

        expect(push).toHaveBeenCalledWith('/main-menu');
    });

    it('renders a delete button on every row of both kinds', async () => {
        installBridge({
            list: vi.fn(() => Promise.resolve([makeItem()])),
            perspectiveList: vi.fn(() => Promise.resolve([PERSPECTIVE_PATH])),
        });

        renderPage();

        await waitFor(() => {
            expect(screen.getAllByTestId('replay-delete-btn')).toHaveLength(2);
        });
        for (const deleteButton of screen.getAllByTestId('replay-delete-btn')) {
            expect(deleteButton).toHaveAttribute('data-ch-dismiss-button');
        }
    });

    it('opens a confirm dialog on delete click without deleting or opening the replay', async () => {
        const del = vi.fn(() => Promise.resolve());
        const openInPlayer = vi.fn(() => Promise.resolve());
        installBridge({
            list: vi.fn(() => Promise.resolve([makeItem()])),
            delete: del,
            openInPlayer,
        });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));

        expect(screen.getByTestId('replay-delete-dialog')).toBeInTheDocument();
        expect(del).not.toHaveBeenCalled();
        expect(openInPlayer).not.toHaveBeenCalled();
    });

    it('cancelling the confirm dialog deletes nothing and closes the dialog', async () => {
        const del = vi.fn(() => Promise.resolve());
        installBridge({ list: vi.fn(() => Promise.resolve([makeItem()])), delete: del });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));
        await userEvent.click(screen.getByTestId('replay-delete-cancel'));

        expect(del).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.queryByTestId('replay-delete-dialog')).not.toBeInTheDocument();
        });
    });

    it('confirming deletes a deterministic replay, drops the row, and toasts', async () => {
        const del = vi.fn(() => Promise.resolve());
        // The list resolves the item on mount, then empty on the post-delete reload.
        const list = vi
            .fn()
            .mockResolvedValueOnce([makeItem({ path: '/replays/tactics/gone.chimera-replay' })])
            .mockResolvedValue([]);
        installBridge({ list, delete: del });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));
        await userEvent.click(screen.getByTestId('replay-delete-confirm'));

        await waitFor(() => {
            expect(del).toHaveBeenCalledWith('/replays/tactics/gone.chimera-replay');
        });
        await waitFor(() => {
            expect(screen.queryByTestId('replay-open-btn')).not.toBeInTheDocument();
        });
        expect(useToastStore.getState().queue.some((toast) => /deleted/i.test(toast.title))).toBe(
            true,
        );
    });

    it('confirming a perspective row deletes via perspective.delete', async () => {
        const perspectiveDelete = vi.fn(() => Promise.resolve());
        const perspectiveList = vi
            .fn()
            .mockResolvedValueOnce([PERSPECTIVE_PATH])
            .mockResolvedValue([]);
        installBridge({ perspectiveList, perspectiveDelete });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));
        await userEvent.click(screen.getByTestId('replay-delete-confirm'));

        await waitFor(() => {
            expect(perspectiveDelete).toHaveBeenCalledWith(PERSPECTIVE_PATH);
        });
    });

    it('surfaces a failure toast when deletion rejects', async () => {
        const del = vi.fn(() => Promise.reject(new Error('disk gone')));
        installBridge({ list: vi.fn(() => Promise.resolve([makeItem()])), delete: del });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));
        await userEvent.click(screen.getByTestId('replay-delete-confirm'));

        await waitFor(() => {
            expect(
                useToastStore.getState().queue.some((toast) => /failed/i.test(toast.title)),
            ).toBe(true);
        });
    });
});

describe('ReplaysPage — Escape behaviour (chrome-less Modal conversion)', () => {
    it('closes back to the main menu on Escape, carrying the active gameId', () => {
        installBridge({});

        renderPage();

        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('Escape closes only the confirm dialog while it is open, then the page', async () => {
        installBridge({ list: vi.fn(() => Promise.resolve([makeItem()])) });

        renderPage();

        await userEvent.click(await screen.findByTestId('replay-delete-btn'));
        expect(screen.getByTestId('replay-delete-dialog')).toBeInTheDocument();

        // First Escape: the confirm (top layer) closes; the page stays.
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByTestId('replay-delete-dialog')).not.toBeInTheDocument();
        });
        expect(push).not.toHaveBeenCalled();

        // Second Escape: the page modal closes back to the main menu.
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
        expect(push).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });
});
