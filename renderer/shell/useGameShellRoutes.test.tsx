// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGameShell } from '../game/rendererGameRegistry';
import { useGameShellRoutes } from './useGameShellRoutes';

const { mockLoadRendererGameShell, navigationState } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
    navigationState: { pathname: '/credits' },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => navigationState.pathname,
}));

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function Probe(): React.ReactElement {
    const routes = useGameShellRoutes();
    return <div data-testid="routes">{routes.join('|')}</div>;
}

function setRoute(pathname: string, search = ''): void {
    navigationState.pathname = pathname;
    window.history.replaceState({}, '', `${pathname}${search}`);
}

beforeEach(() => {
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
    setRoute('/credits', '?gameId=tactics');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useGameShellRoutes', () => {
    it('resolves the game-declared shell routes on a candidate route', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits', '/atlas'],
        } satisfies LoadedRendererGameShell);

        render(<Probe />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        await waitFor(() => {
            expect(screen.getByTestId('routes')).toHaveTextContent('/credits|/atlas');
        });
    });

    it('starts empty before the shell payload resolves', () => {
        mockLoadRendererGameShell.mockReturnValue(new Promise<LoadedRendererGameShell>(() => {}));

        render(<Probe />);

        expect(screen.getByTestId('routes')).toHaveTextContent('');
    });

    it('resolves empty when the game declares no shell routes', async () => {
        render(<Probe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(screen.getByTestId('routes')).toHaveTextContent('');
    });

    it('resolves empty when the shell load fails', async () => {
        mockLoadRendererGameShell.mockRejectedValue(new Error('nope'));

        render(<Probe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(screen.getByTestId('routes')).toHaveTextContent('');
    });

    it('loads nothing when the URL carries no game context', () => {
        setRoute('/credits');

        render(<Probe />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        expect(screen.getByTestId('routes')).toHaveTextContent('');
    });

    it('loads nothing on a route the engine itself ships', () => {
        // The engine owns /game, so no declaration can make it a game page —
        // and the game route must not pay for a second shell load.
        setRoute('/game', '?gameId=tactics');

        render(<Probe />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('loads nothing on an engine route reached on the exported trailing-slash spelling', () => {
        setRoute('/game/', '?gameId=tactics');

        render(<Probe />);

        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('re-resolves when navigating from an engine route onto a candidate route', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        setRoute('/main-menu', '?gameId=tactics');

        const rendered = render(<Probe />);
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();

        setRoute('/credits', '?gameId=tactics');
        rendered.rerender(<Probe />);

        await waitFor(() => {
            expect(screen.getByTestId('routes')).toHaveTextContent('/credits');
        });
    });

    it('drops the previous game routes when navigating into another game context', async () => {
        // The URL is re-read in an effect keyed on the PATHNAME (the
        // useActiveShellGameId contract), so the game context changes on a
        // navigation — which is the only way it changes in the shipped app.
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);

        const rendered = render(<Probe />);
        await waitFor(() => {
            expect(screen.getByTestId('routes')).toHaveTextContent('/credits');
        });

        mockLoadRendererGameShell.mockReturnValue(new Promise<LoadedRendererGameShell>(() => {}));
        setRoute('/atlas', '?gameId=other');
        rendered.rerender(<Probe />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('other');
        });
        expect(screen.getByTestId('routes')).toHaveTextContent('');
    });

    it('returns the same array reference across renders while nothing changes', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);
        const seen: (readonly string[])[] = [];

        function RefProbe(): React.ReactElement {
            const routes = useGameShellRoutes();
            seen.push(routes);
            return <div data-testid="routes">{routes.join('|')}</div>;
        }

        const rendered = render(<RefProbe />);
        await waitFor(() => {
            expect(screen.getByTestId('routes')).toHaveTextContent('/credits');
        });
        const resolved = seen.at(-1);
        rendered.rerender(<RefProbe />);

        // A fresh array per render would re-fire every consumer effect that lists
        // this value as a dependency.
        expect(seen.at(-1)).toBe(resolved);
    });
});
