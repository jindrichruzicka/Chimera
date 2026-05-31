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

function TacticsBackground(): React.ReactElement {
    return <div data-testid="tactics-shell-background" />;
}

function setRoute(pathname: string, search = ''): void {
    navigationState.pathname = pathname;
    navigationState.search = search;
}

beforeEach(() => {
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
