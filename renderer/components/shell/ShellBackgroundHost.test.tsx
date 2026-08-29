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
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, GLTFModelAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManager } from '../../assets/AssetManager';
import * as assetManagerModule from '../../assets/AssetManager';
import { AssetManagerContext, useAssetManager } from '../../assets/AssetManagerContext.js';
import { createDelegatingAssetManager } from '../../assets/DelegatingAssetManager';
import { SetGameAssetManagerContext } from '../../assets/SetGameAssetManagerContext';
import { useAsset } from '../../assets/useAsset';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import {
    _resetShellStateForTest,
    setShellRoute,
    useShellState,
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

/**
 * The instance id is a module-level counter, so it differs per test run. Every
 * OTHER byte of the host's markup is the claim, so the id is normalised out
 * rather than dropped from the comparison.
 */
function withStableInstanceId(html: string): string {
    return html.replace(
        /data-shell-background-instance-id="\d+"/,
        'data-shell-background-instance-id="#"',
    );
}

/**
 * The host's markup for a game that contributes a background and declares NO
 * `shellBackgroundAssets` — an inline literal rather than a re-derivation of
 * `hostStyle`, so a changed attribute, a changed style token or an interposed
 * wrapper element all fail here.
 */
const ZERO_DECLARATION_HOST_HTML =
    '<div data-testid="shell-background" data-shell-background-kind="game" ' +
    'data-shell-background-instance-id="#" data-shell-game-id="tactics" ' +
    'style="position: fixed; inset: var(--ch-space-none); z-index: var(--ch-z-base); ' +
    'pointer-events: none; overflow: hidden; background-color: var(--ch-color-surface);" ' +
    'aria-hidden="true"><div data-testid="tactics-shell-background"></div></div>';

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

    it('lets the match route commit before the background tears down on a real router hop', async () => {
        // Measured, and pinned because the natural reading is the opposite one:
        // a route-driven surface would tear the background down in the router's
        // own commit. The bridge publishes the surface from an EFFECT, so the
        // store flip is a later commit, and anything gated on the pathname —
        // the `/game` page and the canvas it mounts — is already there.
        //
        // What this separates is a publish from an effect against a publish
        // during render; which KIND of effect the bridge uses is invisible
        // here, and no sentence in this file claims otherwise. Nothing here
        // asserts the order is desirable either — it pins what is true, so a
        // later task that wants the other one fails this case rather than
        // discovering it in a GL context.
        const events: string[] = [];

        function BackgroundSubtree(): React.ReactElement {
            React.useEffect(() => {
                return () => {
                    events.push('background:unmount');
                };
            }, []);
            return <div data-testid="tactics-shell-background" />;
        }

        function PathnameGatedRoute(): React.ReactElement | null {
            const isMatchRoute = navigationState.pathname === '/game';
            React.useEffect(() => {
                if (isMatchRoute) {
                    events.push('match-route:mount');
                }
            }, [isMatchRoute]);
            return isMatchRoute ? <div data-testid="match-route" /> : null;
        }

        function ShellWithMatchRoute(): React.ReactElement {
            return (
                <>
                    <ShellStateBridge />
                    <ShellBackgroundHost />
                    <PathnameGatedRoute />
                </>
            );
        }

        setRoute('/main-menu', 'gameId=tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: BackgroundSubtree,
        } satisfies LoadedRendererGameShell);

        const rendered = render(<ShellWithMatchRoute />);
        await screen.findByTestId('tactics-shell-background');
        const beforeHop = events.length;

        setRoute('/game', 'gameId=tactics');
        rendered.rerender(<ShellWithMatchRoute />);

        expect(events.slice(beforeHop)).toEqual(['match-route:mount', 'background:unmount']);
    });
});

describe('ShellBackgroundHost — the shell background asset session', () => {
    /**
     * A ref the shell manifest declares, and the asset a stubbed `load` answers
     * it with. The value is a sentinel rather than a real GLTF payload: what is
     * measured is WHICH manager answered, not what a loader parsed.
     */
    const SHELL_REF = 'tactics/models/menu-diorama.glb' as AssetRef<GLTFModelAsset>;
    const SHELL_ASSET_ID = 'menu-diorama';

    function shellBackgroundManifest(gameId: string): AssetManifest {
        return {
            gameId,
            entries: [{ ref: SHELL_REF, kind: 'gltf-model', priority: 'deferred' }],
        };
    }

    /**
     * Records every manager `GameAssetSession` allocates under the host, and
     * every dispose on one, into a shared ordered log — so a case can assert on
     * the SET (StrictMode's orphan check) and on the ORDER (the teardown pin)
     * from the same instrumentation.
     *
     * `load` is replaced rather than delegated to: the real one reaches a
     * `chimera://` fetch jsdom cannot serve, and the question here is only
     * whether the ref reached a session manager at all.
     */
    function instrumentSessionManagers(events: string[]): {
        readonly allocated: AssetManager[];
        readonly disposed: AssetManager[];
    } {
        const allocated: AssetManager[] = [];
        const disposed: AssetManager[] = [];
        const createReal = assetManagerModule.createAssetManager;

        vi.spyOn(assetManagerModule, 'createAssetManager').mockImplementation((...args) => {
            const manager = createReal(...args);
            const disposeReal = manager.dispose.bind(manager);
            manager.dispose = (): void => {
                disposed.push(manager);
                events.push('session:dispose');
                disposeReal();
            };
            manager.load = async (ref): Promise<never> =>
                ({ id: String(ref) === SHELL_REF ? SHELL_ASSET_ID : 'unknown' }) as never;
            allocated.push(manager);
            return manager;
        });

        return { allocated, disposed };
    }

    /** A game background that loads a manifest ref through the ambient manager. */
    function AssetProbeBackground(): React.ReactElement {
        const { asset, error } = useAsset(SHELL_REF);
        return (
            <div
                data-testid="tactics-shell-background"
                data-asset={asset === null ? '' : String((asset as unknown as { id: string }).id)}
                data-asset-error={error === null ? '' : error.name}
            />
        );
    }

    /**
     * The app-level manager the host really renders under. No match is mounted
     * in any case here, so nothing has registered its delegate and every load
     * through it rejects `NoActiveGameSessionError`. Wrapping the host in it is
     * what makes the session's provider have something to OVERRIDE — without it
     * a missing session would read as a thrown `useAssetManager` rather than as
     * the delegate-less rejection the shell actually gets today.
     */
    function renderUnderAppLevelManager(node: React.ReactElement): ReturnType<typeof render> {
        return render(
            <AssetManagerContext.Provider value={createDelegatingAssetManager()}>
                {node}
            </AssetManagerContext.Provider>,
        );
    }

    it('resolves a background useAsset through the shell session on the main-menu surface', async () => {
        instrumentSessionManagers([]);
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: AssetProbeBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(<ShellBackgroundHost />);

        const background = await screen.findByTestId('tactics-shell-background');
        await waitFor(() => {
            expect(background).toHaveAttribute('data-asset', SHELL_ASSET_ID);
        });
        expect(background).toHaveAttribute('data-asset-error', '');
    });

    it('publishes the session manager, never the delegate-less app-level one', async () => {
        // The sibling case above passes as well on a manager that happens to
        // answer; this one names the manager the subtree actually reads, so a
        // session that published nothing cannot ride on a stubbed `load`.
        const events: string[] = [];
        const { allocated } = instrumentSessionManagers(events);
        let published: AssetManager | null = null;

        function ManagerProbeBackground(): React.ReactElement {
            published = useAssetManager();
            return <div data-testid="tactics-shell-background" />;
        }

        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: ManagerProbeBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(<ShellBackgroundHost />);

        await screen.findByTestId('tactics-shell-background');
        expect(allocated).toContain(published);
    });

    it('allocates its manager in a commit-phase effect, orphaning none under StrictMode', async () => {
        // StrictMode double-invokes render-phase factories and DISCARDS one
        // result, and a discarded render runs no cleanup — so a `useMemo`
        // allocation here would leave a manager no dispose path can reach
        // (Invariant #21). Counting allocations against disposals is what
        // catches that orphan, and the `> 1` control is what makes the counts
        // mean something: without it a session that allocated ONCE would pass
        // the equality trivially.
        const events: string[] = [];
        const { allocated, disposed } = instrumentSessionManagers(events);
        let published: AssetManager | null = null;

        function ManagerProbeBackground(): React.ReactElement {
            published = useAssetManager();
            return <div data-testid="tactics-shell-background" />;
        }

        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: ManagerProbeBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        const rendered = renderUnderAppLevelManager(
            <React.StrictMode>
                <ShellBackgroundHost />
            </React.StrictMode>,
        );
        await screen.findByTestId('tactics-shell-background');
        await waitFor(() => {
            expect(allocated.length).toBeGreaterThan(1);
        });

        // Live while mounted: every manager but the published one is already
        // disposed, and the published one is not.
        expect(disposed).toHaveLength(allocated.length - 1);
        expect(disposed).not.toContain(published);

        rendered.unmount();

        expect(new Set(disposed)).toEqual(new Set(allocated));
    });

    it('unmounts its background and disposes its session in the commit that publishes the match surface', async () => {
        // "In the commit" is the whole claim, and the settled DOM cannot carry
        // it: a host that dropped the background from an EFFECT instead of in
        // render settles to the same empty DOM one commit later. The witness is
        // a SIBLING that mounts on the same store update — it can only run its
        // mount effect after every teardown of the commit it belongs to, so a
        // deferred unmount puts its mount FIRST. It stands for nothing on the
        // match route; what happens on a real router hop is the last block's,
        // and it is not this order.
        const events: string[] = [];
        instrumentSessionManagers(events);

        function BackgroundSubtree(): React.ReactElement {
            React.useEffect(() => {
                return () => {
                    events.push('background:unmount');
                };
            }, []);
            return <div data-testid="tactics-shell-background" />;
        }

        function SameCommitWitness(): React.ReactElement | null {
            const surface = useShellState((state) => state.surface);
            React.useEffect(() => {
                if (surface === 'match') {
                    events.push('witness:mount');
                }
            }, [surface]);
            return surface === 'match' ? <div data-testid="same-commit-witness" /> : null;
        }

        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: BackgroundSubtree,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(
            <>
                <ShellBackgroundHost />
                <SameCommitWitness />
            </>,
        );
        await screen.findByTestId('tactics-shell-background');
        const beforeFlip = events.length;

        setSurface('match', '/game', 'tactics');

        // No `await`: everything asserted here happened inside the flip's own
        // `act`, which is what "in the commit that publishes the surface" means.
        const duringFlip = events.slice(beforeFlip);
        const witnessMount = duringFlip.indexOf('witness:mount');
        expect(witnessMount).toBeGreaterThanOrEqual(0);
        expect(new Set(duringFlip.slice(0, witnessMount))).toEqual(
            new Set(['background:unmount', 'session:dispose']),
        );
        expect(duringFlip.slice(witnessMount + 1)).toEqual([]);
        expect(screen.queryByTestId('shell-background')).toBeNull();
        expect(screen.getByTestId('same-commit-witness')).toBeTruthy();
    });

    it('keeps ONE session manager alive across every background surface hop', async () => {
        // "Keyed to the mount" is what makes the session survive
        // `/main-menu → /credits → /settings`, and `GameAssetSession` keys its
        // effect on the manifest's IDENTITY — so the property lives in the
        // object this host passes down, not in anything the host renders. A
        // manifest rebuilt per render (`assetManifest={{ ...assets }}`) settles
        // to the same DOM on every hop and every other case here passes, while
        // each hop disposes the manager under a still-mounted background and
        // re-runs its critical preload. Counting allocations is what sees it.
        const events: string[] = [];
        const { allocated, disposed } = instrumentSessionManagers(events);
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        const rendered = renderUnderAppLevelManager(<ShellBackgroundHost />);
        const firstBackgroundNode = await screen.findByTestId('tactics-shell-background');
        expect(allocated).toHaveLength(1);

        for (const [surface, pathname] of [
            ['page', '/credits'],
            ['settings', '/settings'],
            ['lobby', '/lobby'],
            ['main-menu', '/main-menu'],
        ] as const) {
            setSurface(surface, pathname, 'tactics');
            rendered.rerender(
                <AssetManagerContext.Provider value={createDelegatingAssetManager()}>
                    <ShellBackgroundHost />
                </AssetManagerContext.Provider>,
            );
            await waitFor(() => {
                expect(screen.getByTestId('shell-background')).toHaveAttribute(
                    'data-shell-background-kind',
                    'game',
                );
            });
        }

        expect(allocated).toHaveLength(1);
        expect(disposed).toEqual([]);
        // The same mounted background, not a new one behind a rebuilt session.
        expect(screen.getByTestId('tactics-shell-background')).toBe(firstBackgroundNode);
    });

    it('paints its plate a commit before a session-wrapped background, never with it', async () => {
        // The session sits INSIDE the host element, so the fixed
        // surface-coloured plate lands on the commit its payload lands on and
        // the background's own DOM arrives one commit later, when the session
        // has committed its manager. Hoisting the session AROUND the plate
        // settles to the same DOM and is invisible to every settled-DOM check —
        // it costs the plate a commit on every shell route. `Profiler.onRender`
        // fires in the layout phase of each commit, so each sample reads the
        // DOM that commit actually produced.
        instrumentSessionManagers([]);
        const samples: { plate: boolean; background: boolean }[] = [];
        const sample = (): void => {
            samples.push({
                plate: screen.queryByTestId('shell-background') !== null,
                background: screen.queryByTestId('tactics-shell-background') !== null,
            });
        };

        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(
            <React.Profiler id="shell-background-host" onRender={sample}>
                <ShellBackgroundHost />
            </React.Profiler>,
        );
        await screen.findByTestId('tactics-shell-background');

        const firstPlate = samples.findIndex((entry) => entry.plate);
        const firstBackground = samples.findIndex((entry) => entry.background);
        expect(firstPlate).toBeGreaterThanOrEqual(0);
        expect(firstBackground).toBeGreaterThan(firstPlate);
    });

    it('paints plate and background in ONE commit for a zero-declaration game', async () => {
        // The positive control for the case above: with no session between
        // them the two land together, so the sampler is measuring a real
        // deferral rather than reporting an ordering it always reports.
        instrumentSessionManagers([]);
        const samples: { plate: boolean; background: boolean }[] = [];
        const sample = (): void => {
            samples.push({
                plate: screen.queryByTestId('shell-background') !== null,
                background: screen.queryByTestId('tactics-shell-background') !== null,
            });
        };

        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(
            <React.Profiler id="shell-background-host" onRender={sample}>
                <ShellBackgroundHost />
            </React.Profiler>,
        );
        await screen.findByTestId('tactics-shell-background');

        const firstPlate = samples.findIndex((entry) => entry.plate);
        const firstBackground = samples.findIndex((entry) => entry.background);
        expect(firstPlate).toBeGreaterThanOrEqual(0);
        expect(firstBackground).toBe(firstPlate);
    });

    it('renders a zero-declaration game byte-identically and allocates no manager', async () => {
        const events: string[] = [];
        const { allocated } = instrumentSessionManagers(events);
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
        } satisfies LoadedRendererGameShell);

        const { container } = renderUnderAppLevelManager(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        expect(withStableInstanceId(container.innerHTML)).toBe(ZERO_DECLARATION_HOST_HTML);
        expect(allocated).toEqual([]);
        expect(events).toEqual([]);
    });

    it('opens no session for a game that declares assets but contributes no background', async () => {
        const events: string[] = [];
        const { allocated } = instrumentSessionManagers(events);
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(<ShellBackgroundHost />);

        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
        });
        expect(allocated).toEqual([]);
    });

    it('never registers the shell session as the app-level game asset delegate', async () => {
        // Invariant #21: `SetGameAssetManagerContext` exists so the app-level
        // `AudioManager` reaches a MATCH's assets. A shell session that
        // registered there would redirect every engine sound lookup at the
        // menu background's manifest. This and the sibling above are guards on
        // the session's SHAPE rather than on its arrival, so neither could be
        // red before one existed: their mutants are a host that reaches for a
        // fresh session hook instead of the one that already declines the
        // delegate, and one that builds a session with nothing to publish to.
        instrumentSessionManagers([]);
        const setGameAssetManager = vi.fn();
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: AssetProbeBackground,
            shellBackgroundAssets: shellBackgroundManifest('tactics'),
        } satisfies LoadedRendererGameShell);

        renderUnderAppLevelManager(
            <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
                <ShellBackgroundHost />
            </SetGameAssetManagerContext.Provider>,
        );

        await screen.findByTestId('tactics-shell-background');
        expect(setGameAssetManager).not.toHaveBeenCalled();
    });
});

/**
 * The interactive opt-in (§4.37.9).
 *
 * jsdom performs no layout and ships no `document.elementFromPoint`, so nothing
 * here is a coordinate hit-test — what it measures is the two DECLARATIONS the
 * browser hit-tests with, read back off the element the host actually rendered.
 * The coordinate-level proof is the action app's click-through e2e.
 */
describe('ShellBackgroundHost — the interactive opt-in', () => {
    /**
     * The host's markup under the opt-in, as an inline literal twin of
     * `ZERO_DECLARATION_HOST_HTML`. Two bytes differ and both are the feature:
     * `pointer-events: auto`, and no `aria-hidden`.
     */
    const INTERACTIVE_HOST_HTML =
        '<div data-testid="shell-background" data-shell-background-kind="game" ' +
        'data-shell-background-instance-id="#" data-shell-game-id="tactics" ' +
        'style="position: fixed; inset: var(--ch-space-none); z-index: var(--ch-z-base); ' +
        'pointer-events: auto; overflow: hidden; background-color: var(--ch-color-surface);"' +
        '><div data-testid="tactics-shell-background"></div></div>';

    it('accepts pointer events and drops aria-hidden under the opt-in', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        const { container } = render(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        expect(withStableInstanceId(container.innerHTML)).toBe(INTERACTIVE_HOST_HTML);
    });

    it('stays inert decor when the shell declares the flag false', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellBackgroundInteractive: false,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);
        await screen.findByTestId('tactics-shell-background');

        const host = screen.getByTestId('shell-background');
        expect(host.style.pointerEvents).toBe('none');
        expect(host).toHaveAttribute('aria-hidden', 'true');
    });

    // The engine default paints no game subtree, so there is nothing to click
    // even when the payload says otherwise — and an `aria-hidden` dropped from a
    // plain coloured plate would expose an empty region to assistive tech.
    it('stays inert decor when the opt-in arrives without a background component', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);
        await waitFor(() => {
            expect(screen.getByTestId('shell-background')).toHaveAttribute(
                'data-shell-background-kind',
                'engine-default',
            );
        });

        const host = screen.getByTestId('shell-background');
        expect(host.style.pointerEvents).toBe('none');
        expect(host).toHaveAttribute('aria-hidden', 'true');
    });

    // A payload is answered for ONE game context. On a route with none, the
    // plate the host paints is the engine's, so the previous game's opt-in must
    // not carry into it.
    it('stays inert decor on a surface with no game context', async () => {
        setSurface('main-menu', '/main-menu', null);
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: TacticsBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        render(<ShellBackgroundHost />);

        const host = await screen.findByTestId('shell-background');
        expect(host.style.pointerEvents).toBe('none');
        expect(host).toHaveAttribute('aria-hidden', 'true');
    });
});
