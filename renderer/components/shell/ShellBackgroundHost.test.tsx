// @vitest-environment jsdom

/**
 * renderer/components/shell/ShellBackgroundHost.test.tsx
 *
 * The background mount. Since §4.37.18 this component classifies nothing: it
 * reads the SURFACE `ShellStateBridge` published on the shell-state store and
 * loads the active game's background component for it. Which pathname is which
 * surface is the bridge's test; what is measured here is the mount decision,
 * the payload's game tagging, and the one-instance persistence across shell
 * surfaces (§4.37.17).
 *
 * The last block mounts the bridge WITH the host, because the property it holds
 * — the pinned instance surviving `/main-menu → /credits` — spans the pair and
 * neither half can show it alone.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import {
    _resetShellStateForTest,
    setShellRoute,
    type ShellSurface,
} from '../../shell/shellStateStore';
import { ShellBackgroundHost } from './ShellBackgroundHost';
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

let tacticsBackgroundRenders = 0;

function TacticsBackground(): React.ReactElement {
    tacticsBackgroundRenders += 1;
    return <div data-testid="tactics-shell-background" />;
}

/** Publish a classified route, exactly as the bridge does. */
function setSurface(surface: ShellSurface, pathname: string, gameId: string | null = null): void {
    act(() => {
        setShellRoute({ surface, pathname, gameId });
    });
}

/**
 * Drive the REAL bridge. `window.history` is set alongside the router mock so
 * the two never disagree here — which route source the bridge reads is its own
 * test's business, not this file's.
 */
function setRoute(pathname: string, search = ''): void {
    navigationState.pathname = pathname;
    navigationState.search = search;
    window.history.replaceState({}, '', `${pathname}${search === '' ? '' : `?${search}`}`);
}

beforeEach(() => {
    _resetShellStateForTest();
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
    it('renders the engine default solid background on a shell surface without a game context', () => {
        setSurface('main-menu', '/main-menu');

        render(<ShellBackgroundHost />);

        const host = screen.getByTestId('shell-background');
        expect(host).toHaveAttribute('data-shell-background-kind', 'engine-default');
        expect(host).toHaveStyle({ backgroundColor: 'var(--ch-color-surface)' });
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('loads and renders a game shell background component when the surface has game context', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
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
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockReturnValue(new Promise<LoadedRendererGameShell>(() => {}));

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(screen.queryByTestId('shell-background')).toBeNull();
    });

    it('keeps the engine default background when the lobby surface carries no gameId', () => {
        setSurface('lobby', '/lobby');

        render(<ShellBackgroundHost />);

        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'engine-default',
        );
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });

    it('mounts on the lobby surface with an explicit game context', async () => {
        setSurface('lobby', '/lobby', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
    });

    it('mounts on a game page surface', async () => {
        setSurface('page', '/credits', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        expect(await screen.findByTestId('tactics-shell-background')).toBeTruthy();
        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'game',
        );
    });

    it.each([
        ['match', '/game'],
        ['saves', '/saves'],
        ['replays', '/replays'],
        ['replay-player', '/replays/player'],
        ['boot', '/debug'],
    ] as const)(
        'neither renders nor loads on the %s surface',
        (surface: ShellSurface, pathname: string) => {
            setSurface(surface, pathname, 'tactics');

            render(<ShellBackgroundHost />);

            expect(screen.queryByTestId('shell-background')).toBeNull();
            expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        },
    );

    it('keeps the same mounted host instance across every background surface', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        const rendered = render(<ShellBackgroundHost />);

        const firstInstanceId = (await screen.findByTestId('shell-background')).getAttribute(
            'data-shell-background-instance-id',
        );
        expect(firstInstanceId).not.toBeNull();

        // The instance id lives in a ref, so it survives a remount of the host's
        // subtree — a `key` on the rendered element would tear the background
        // down and rebuild it on every hop and the id would not notice. Holding
        // the background component's DOM NODE is what makes persistence mean
        // what it says: the SAME mounted component, not a new one with the same id.
        expect(tacticsBackgroundRenders).toBeGreaterThan(0);
        const firstBackgroundNode = screen.getByTestId('tactics-shell-background');

        for (const [surface, pathname] of [
            ['page', '/credits'],
            ['settings', '/settings'],
            ['lobby', '/lobby'],
            ['main-menu', '/main-menu'],
        ] as const) {
            setSurface(surface, pathname, 'tactics');
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

        expect(screen.getByTestId('tactics-shell-background')).toBe(firstBackgroundNode);
    });

    it('never paints the previous game context payload, not even for one commit', async () => {
        // The settled DOM cannot see this: the effect clears the payload as soon
        // as the game context goes away, so a render that used the stale one
        // would be corrected on the very next commit. Counting the background
        // component's RENDERS is what makes that commit observable — and a
        // one-frame flash of the previous game's background on a route with no
        // game context is exactly what the render-time staleness check prevents.
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        const rendered = render(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        tacticsBackgroundRenders = 0;
        setSurface('main-menu', '/main-menu');
        rendered.rerender(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
        });
        expect(tacticsBackgroundRenders).toBe(0);
    });

    it('re-loads for the next game when the game context changes under one surface', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);
        const rendered = render(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        // The mock is swapped BEFORE the publish: `act` flushes the render and
        // the effect together, so a mock set after it would arrive too late.
        mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'other');
        rendered.rerender(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('other');
        });
        expect(screen.getByTestId('shell-background')).toHaveAttribute(
            'data-shell-background-kind',
            'engine-default',
        );
    });

    it('paints the engine default when the shell payload fails to load', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockRejectedValue(new Error('nope'));

        render(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
        });
    });
});

describe('ShellBackgroundHost + ShellStateBridge — the pinned instance across a real hop', () => {
    function Shell(): React.ReactElement {
        return (
            <>
                <ShellStateBridge />
                <ShellBackgroundHost />
            </>
        );
    }

    it('keeps the SAME background component mounted across /main-menu → /credits → /settings', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);

        const rendered = render(<Shell />);
        const firstBackgroundNode = await screen.findByTestId('tactics-shell-background');
        const firstInstanceId = screen
            .getByTestId('shell-background')
            .getAttribute('data-shell-background-instance-id');

        for (const pathname of ['/credits', '/settings', '/main-menu']) {
            setRoute(pathname, 'gameId=tactics');
            rendered.rerender(<Shell />);

            // No `waitFor` on the FIRST assertion: a classification that arrived
            // a commit late would unmount the background for that commit, and a
            // settled-DOM check would never see it.
            const host = screen.getByTestId('shell-background');
            expect(host).toHaveAttribute(
                'data-shell-background-instance-id',
                firstInstanceId ?? '',
            );
            expect(host).toHaveAttribute('data-shell-background-kind', 'game');
        }

        expect(screen.getByTestId('tactics-shell-background')).toBe(firstBackgroundNode);
    });

    it('unmounts the background on the hop into the match', async () => {
        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellRoutes: ['/credits'],
        } satisfies LoadedRendererGameShell);

        const rendered = render(<Shell />);
        await screen.findByTestId('tactics-shell-background');

        setRoute('/game', 'gameId=tactics');
        rendered.rerender(<Shell />);

        expect(screen.queryByTestId('shell-background')).toBeNull();
    });
});
