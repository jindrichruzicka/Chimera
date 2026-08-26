// @vitest-environment jsdom

/**
 * renderer/components/shell/ShellStateBridge.test.tsx
 *
 * The single route-classification site (§4.37.18): the bridge resolves the
 * active game's declared shell routes, classifies the current route into a
 * `ShellSurface`, and publishes it — with the normalized pathname and the
 * `?gameId=` context — on the shell-state store.
 *
 * Tests written first (TDD — red confirmed: the component did not exist).
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import {
    _resetShellStateForTest,
    armShellTransition,
    getShellState,
    shellStateStore,
} from '../../shell/shellStateStore';
import { ShellStateBridge } from './ShellStateBridge';

const { mockLoadRendererGameShell, navigationState } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
    navigationState: { pathname: '/main-menu', search: '' },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => navigationState.pathname,
    useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

/**
 * Set both the router mock and the history entry. They agree in every case but
 * the one that deliberately makes them disagree, which is where the source the
 * bridge actually reads is pinned.
 */
function setRoute(pathname: string, search = ''): void {
    navigationState.pathname = pathname;
    navigationState.search = search;
    window.history.replaceState({}, '', `${pathname}${search === '' ? '' : `?${search}`}`);
}

beforeEach(() => {
    _resetShellStateForTest();
    setRoute('/main-menu');
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ShellStateBridge — engine routes', () => {
    it('renders nothing', () => {
        const { container } = render(<ShellStateBridge />);

        expect(container.innerHTML).toBe('');
    });

    it('publishes the engine surface, the normalized pathname and the game context', () => {
        setRoute('/settings', 'gameId=tactics');

        render(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({
            surface: 'settings',
            pathname: '/settings',
            gameId: 'tactics',
        });
    });

    it('publishes a null gameId on a route that declares none', () => {
        setRoute('/main-menu');

        render(<ShellStateBridge />);

        expect(getShellState().gameId).toBeNull();
    });

    it('normalizes the static-export spellings of an engine route', () => {
        setRoute('/replays/player/index.html', 'gameId=tactics');

        render(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({
            surface: 'replay-player',
            pathname: '/replays/player',
        });
    });

    it('never fetches the shell payload for an engine route', () => {
        setRoute('/game', 'gameId=tactics');

        render(<ShellStateBridge />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        expect(getShellState().surface).toBe('match');
    });

    it('never fetches the shell payload with no game context', () => {
        setRoute('/credits');

        render(<ShellStateBridge />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        expect(getShellState().surface).toBe('boot');
    });
});

describe('ShellStateBridge — declared game pages', () => {
    it('classifies a declared route as a page once the declaration resolves', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);

        render(<ShellStateBridge />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(getShellState().surface).toBe('boot');
        await waitFor(() => {
            expect(getShellState().surface).toBe('page');
        });
        expect(getShellState().pathname).toBe('/credits');
    });

    it('keeps an undeclared route on boot even after the declaration resolves', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/atlas'],
        } satisfies LoadedRendererGameShell);

        render(<ShellStateBridge />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalled();
        });
        expect(getShellState().surface).toBe('boot');
    });

    it('normalizes both sides of a declared route', async () => {
        setRoute('/credits/', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);

        render(<ShellStateBridge />);

        await waitFor(() => {
            expect(getShellState()).toMatchObject({ surface: 'page', pathname: '/credits' });
        });
    });

    it('falls back to boot when the shell payload fails to load', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockRejectedValue(new Error('nope'));

        render(<ShellStateBridge />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalled();
        });
        expect(getShellState().surface).toBe('boot');
    });

    it('never reports the PREVIOUS game declaration while the next payload is in flight', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        const { rerender } = render(<ShellStateBridge />);
        await waitFor(() => {
            expect(getShellState().surface).toBe('page');
        });

        setRoute('/credits', 'gameId=other');
        mockLoadRendererGameShell.mockReturnValue(new Promise<LoadedRendererGameShell>(() => {}));
        rerender(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'boot', gameId: 'other' });
    });

    it('re-classifies when the route changes under one game', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        const { rerender } = render(<ShellStateBridge />);
        await waitFor(() => {
            expect(getShellState().surface).toBe('page');
        });

        setRoute('/main-menu', 'gameId=tactics');
        rerender(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'main-menu', pathname: '/main-menu' });
    });

    it('picks the declaration up when the game context arrives on an already-mounted route', async () => {
        setRoute('/credits');
        const { rerender } = render(<ShellStateBridge />);
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();

        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        rerender(<ShellStateBridge />);

        await waitFor(() => {
            expect(getShellState().surface).toBe('page');
        });
    });
});

describe('ShellStateBridge — republishing', () => {
    it('notifies nobody when a re-render republishes the route it already published', () => {
        setRoute('/main-menu', 'gameId=tactics');
        const { rerender } = render(<ShellStateBridge />);
        const publishes: unknown[] = [];
        const stop = shellStateStore.subscribe((state) => publishes.push(state));

        rerender(<ShellStateBridge />);

        expect(publishes).toEqual([]);
        stop();
    });

    it('leaves a transition armed on the way to the match armed until the match surface lands', () => {
        setRoute('/main-menu', 'gameId=tactics');
        const { rerender } = render(<ShellStateBridge />);
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        rerender(<ShellStateBridge />);
        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 200 });

        setRoute('/game', 'gameId=tactics');
        rerender(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'match', transition: null });
    });
});

describe('ShellStateBridge — what it re-publishes on', () => {
    it('publishes a game-context change that leaves the surface unchanged', async () => {
        // The background host keys its own payload load on `gameId`, so a
        // `?gameId=` swap under one surface has to reach the store. An effect
        // that listed only `surface` would publish nothing here.
        setRoute('/main-menu', 'gameId=tactics');
        const { rerender } = render(<ShellStateBridge />);
        expect(getShellState().gameId).toBe('tactics');

        setRoute('/main-menu', 'gameId=other');
        rerender(<ShellStateBridge />);

        expect(getShellState().gameId).toBe('other');
        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('other');
        });
    });

    it('publishes a pathname change that leaves the surface unchanged', () => {
        // Two UNdeclared routes are both `boot`; only `pathname` separates them,
        // and it is what a game page reads to know which page it is on.
        setRoute('/credits', 'gameId=tactics');
        const { rerender } = render(<ShellStateBridge />);
        expect(getShellState()).toMatchObject({ surface: 'boot', pathname: '/credits' });

        setRoute('/atlas', 'gameId=tactics');
        rerender(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'boot', pathname: '/atlas' });
    });

    it('classifies the ROUTER pathname, not window.location, when the two disagree', () => {
        // Next updates the history entry in a passive effect AFTER the
        // navigation commits, so `window.location` still holds the route the
        // player just left during the render that first sees the new pathname —
        // and nothing re-renders this component afterwards. Reading it there
        // left the surface on `lobby` across the hop into `/game` and failed
        // five e2e specs.
        navigationState.pathname = '/game';
        navigationState.search = '';
        window.history.replaceState({}, '', '/lobby');

        render(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'match', pathname: '/game' });
    });
});

describe('ShellStateBridge — resolving the declaration before it is needed', () => {
    it('resolves the declaration on a shell route, so the hop onto a game page classifies on its FIRST commit', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        const { rerender } = render(<ShellStateBridge />);
        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });

        setRoute('/credits', 'gameId=tactics');
        rerender(<ShellStateBridge />);

        // No `waitFor`: a gap here is a frame in which the background unmounts.
        expect(getShellState().surface).toBe('page');
    });

    it('resolves the declaration on the settings and lobby routes too', async () => {
        for (const route of ['/settings', '/lobby']) {
            _resetShellStateForTest();
            mockLoadRendererGameShell.mockClear();
            setRoute(route, 'gameId=tactics');
            const view = render(<ShellStateBridge />);
            await waitFor(() => {
                expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
            });
            view.unmount();
        }
    });

    it('never resolves the declaration on the match route', () => {
        setRoute('/game', 'gameId=tactics');

        render(<ShellStateBridge />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('never resolves the declaration on the saves or replay routes', () => {
        for (const route of ['/saves', '/replays', '/replays/player']) {
            setRoute(route, 'gameId=tactics');
            const view = render(<ShellStateBridge />);
            expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
            view.unmount();
        }
    });

    it('re-resolves for the next game rather than reusing the previous declaration', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        const { rerender } = render(<ShellStateBridge />);
        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });

        setRoute('/credits', 'gameId=other');
        mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
        rerender(<ShellStateBridge />);

        expect(getShellState()).toMatchObject({ surface: 'boot', gameId: 'other' });
        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('other');
        });
        expect(getShellState().surface).toBe('boot');
    });
});
