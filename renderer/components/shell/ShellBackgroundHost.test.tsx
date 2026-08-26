// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import { ShellBackgroundHost } from './ShellBackgroundHost';

const { mockLoadRendererGameShell, navigationState } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
    navigationState: {
        pathname: '/main-menu',
        search: '',
    },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => navigationState.pathname,
    useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

let tacticsBackgroundRenders = 0;

function TacticsBackground(): React.ReactElement {
    tacticsBackgroundRenders += 1;
    return <div data-testid="tactics-shell-background" />;
}

function setRoute(pathname: string, search = ''): void {
    navigationState.pathname = pathname;
    navigationState.search = search;
}

beforeEach(() => {
    tacticsBackgroundRenders = 0;
    setRoute('/main-menu');
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ShellBackgroundHost', () => {
    it('renders the engine default solid background on shell routes without a game context', () => {
        render(<ShellBackgroundHost />);

        const host = screen.getByTestId('shell-background');
        expect(host).toHaveAttribute('data-shell-background-kind', 'engine-default');
        expect(host).toHaveStyle({ backgroundColor: 'var(--ch-color-surface)' });
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('loads and renders a game shell background component when a shell route has game context', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'game',
        );
    });

    it('does not paint the engine default background while a game shell background is loading', () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockReturnValue(new Promise<LoadedRendererGameShell>(() => {}));

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(screen.queryByTestId('shell-background')).toBeNull();
    });

    it('keeps the engine default background when the lobby route omits gameId', () => {
        setRoute('/lobby');

        render(<ShellBackgroundHost />);

        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'engine-default',
        );
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('uses explicit URL game context on the lobby route', async () => {
        setRoute('/lobby', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
    });

    it('keeps the engine default background when the lobby route declares an explicit theme without gameId', () => {
        setRoute('/lobby', 'themeId=engine-default');

        render(<ShellBackgroundHost />);

        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'engine-default',
        );
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('does not render or load a shell background on the game route', () => {
        setRoute('/game', 'gameId=tactics');

        render(<ShellBackgroundHost />);

        expect(screen.queryByTestId('shell-background')).toBeNull();
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('keeps the same mounted host instance while navigating between shell routes', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        const rendered = render(<ShellBackgroundHost />);

        const firstHost = await screen.findByTestId('shell-background');
        const firstInstanceId = firstHost.getAttribute('data-shell-background-instance-id');

        setRoute('/settings', 'gameId=tactics');
        rendered.rerender(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-instance-id',
                firstInstanceId,
            );
        });
    });

    it('keeps the same mounted host instance from main menu to lobby when game context is explicit', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        const rendered = render(<ShellBackgroundHost />);

        const firstHost = await screen.findByTestId('shell-background');
        const firstInstanceId = firstHost.getAttribute('data-shell-background-instance-id');

        setRoute('/lobby', 'gameId=tactics');
        rendered.rerender(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-instance-id',
                firstInstanceId,
            );
        });
    });
});

describe('ShellBackgroundHost — game-declared shell routes', () => {
    function declaringShell(): LoadedRendererGameShell {
        return { shellBackground: TacticsBackground, shellRoutes: ['/credits'] };
    }

    it('mounts the game background on a declared shell route', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue(declaringShell());

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'game',
        );
    });

    it('matches a declared route reached on the exported trailing-slash spelling', async () => {
        // `trailingSlash: true` means the router reports `/credits/` for the page
        // the game declared as `'/credits'`; a raw === comparison never matches.
        setRoute('/credits/', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue(declaringShell());

        render(<ShellBackgroundHost />);

        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
    });

    it('does not mount on a non-engine route the game did not declare', async () => {
        setRoute('/atlas', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue(declaringShell());

        render(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(screen.queryByTestId('shell-background')).toBeNull();
    });

    it('keeps the SAME mounted host instance across /main-menu → /credits → /settings → /main-menu', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue(declaringShell());

        const rendered = render(<ShellBackgroundHost />);

        const firstInstanceId = (await screen.findByTestId('shell-background')).getAttribute(
            'data-shell-background-instance-id',
        );
        expect(firstInstanceId).not.toBeNull();

        // The instance id lives in a ref, so it survives a remount of the host's
        // subtree — a `key` on the rendered element would tear the background
        // down and rebuild it on every hop and the id would not notice. Counting
        // the background component's renders is what makes persistence mean what
        // it says: the SAME mounted component, not a new one with the same id.
        expect(tacticsBackgroundRenders).toBeGreaterThan(0);
        const firstBackgroundNode = screen.getByTestId('tactics-shell-background');

        for (const pathname of ['/credits', '/settings', '/main-menu']) {
            setRoute(pathname, 'gameId=tactics');
            rendered.rerender(<ShellBackgroundHost />);

            await waitFor(() => {
                const host = screen.getByTestId('shell-background');
                expect(host).toHaveAttribute(
                    'data-shell-background-instance-id',
                    firstInstanceId ?? '',
                );
                expect(host).toHaveAttribute('data-shell-background-kind', 'game');
            });
        }

        // React re-renders a mounted component on a state or prop change, so the
        // count may rise; what a remount would show is the component being torn
        // down and rebuilt, which `TacticsBackground` cannot survive — its module
        // counter is the only witness either way, so assert the element identity
        // too: a remount replaces the DOM node.
        expect(screen.getByTestId('tactics-shell-background')).toBe(firstBackgroundNode);
    });

    it('leaves a game that declares nothing on the engine route set alone', async () => {
        setRoute('/credits', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(screen.queryByTestId('shell-background')).toBeNull();
    });

    it('never paints the previous game context payload, not even for one commit', async () => {
        // The settled DOM cannot see this: the effect clears the payload as soon
        // as the game context goes away, so a render that used the stale one
        // would be corrected on the very next commit. Counting the background
        // component's RENDERS is what makes that commit observable — and a
        // one-frame flash of the previous game's background on a route with no
        // game context is exactly what the render-time staleness check prevents.
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue(declaringShell());

        const rendered = render(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        tacticsBackgroundRenders = 0;
        setRoute('/main-menu');
        rendered.rerender(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
        });
        expect(tacticsBackgroundRenders).toBe(0);
    });

    it('does not load the shell on an engine route outside the background set', () => {
        // /saves is the engine's own page: no declaration can make it a game
        // page, so the payload is never fetched to ask.
        setRoute('/saves', 'gameId=tactics');

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        expect(screen.queryByTestId('shell-background')).toBeNull();
    });
});
