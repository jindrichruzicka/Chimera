// @vitest-environment jsdom

/**
 * renderer/app/GameStoreBootstrap.test.tsx
 *
 * Routing tests for GameStoreBootstrap — the global wiring component that drives
 * snapshot-phase-based navigation between /lobby and /game.
 *
 * Covers: a phase:'lobby' snapshot on /game returns to /lobby (host
 * return-to-lobby + following clients) after dropping the stale match snapshot,
 * and the pre-existing /lobby → /game redirect on the first match snapshot still
 * works.
 *
 * Since §4.37.18 the routes themselves are not this component's business: it
 * gates on the SURFACE `ShellStateBridge` publishes on the shell-state store,
 * so each case below publishes one rather than mocking a pathname. The last
 * block mounts the bridge with it, because "the gate re-evaluates when the
 * declaration resolves" is a property of the pair.
 *
 * The IPC/perf bootstrap effects no-op here: globalThis.__chimera is left unset
 * so they early-return, and the bootstrap functions are mocked.
 *
 * Invariant #3: only PlayerSnapshot.phase is consumed for routing decisions;
 * GameSnapshot never crosses the IPC boundary.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { FadeProvider } from '../components/shell/FadeContext';
import { screenFadeMs } from '../components/shell/screenFadeDuration';
import { ShellStateBridge } from '../components/shell/ShellStateBridge';
import {
    _resetShellStateForTest,
    getShellState,
    setShellRoute,
    type ShellSurface,
} from '../shell/shellStateStore';
import { GameStoreBootstrap } from './GameStoreBootstrap';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

const mockPush = vi.fn();
const mockReset = vi.fn();
let mockPathname = '/game';
let mockSearch = '';
let mockSnapshot: PlayerSnapshot | null = null;

// ONE router object for every render. A fresh `{ push }` per call would hand
// every effect that lists `router` a dependency that changes on each render,
// which makes the rest of that list unobservable — an effect that dropped
// `shellRoutes` would still re-run when the payload resolved.
const mockRouter = { push: mockPush };

vi.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('../state/gameStore', () => ({
    useGameStore: Object.assign(
        (selector: (state: { snapshot: PlayerSnapshot | null }) => unknown) =>
            selector({ snapshot: mockSnapshot }),
        { getState: () => ({ reset: mockReset }) },
    ),
}));

vi.mock('../state/lobbyUiStore', () => ({
    useLobbyUiStore: Object.assign(
        (
            selector: (state: {
                localPlayerId: string | null;
                leavingToMainMenu: boolean;
            }) => unknown,
        ) => selector({ localPlayerId: null, leavingToMainMenu: false }),
        { getState: () => ({ localPlayerId: null, setLocalLobbyContext: vi.fn() }) },
    ),
}));

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

vi.mock('../state/gameStoreBootstrap', () => ({
    bootstrapGameStore: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('../components/shell/perf/perfStoreBootstrap.js', () => ({
    bootstrapPerfStore: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../components/shell/perf/perfStore.js', () => ({
    usePerfStore: vi.fn(),
}));

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 5,
        viewerId: id,
        players: { [id]: { id } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

beforeEach(() => {
    mockPush.mockReset();
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({});
    mockReset.mockReset();
    mockSnapshot = null;
    mockPathname = '/game';
    mockSearch = '';
    window.history.replaceState({}, '', '/game');
    _resetShellStateForTest();
});

/** Publish a classified route, exactly as `ShellStateBridge` does. */
function setSurface(surface: ShellSurface, pathname: string, gameId: string | null = null): void {
    setShellRoute({ surface, pathname, gameId });
}

/**
 * Drive the REAL bridge. `window.history` is set alongside the router mock so
 * the two never disagree here — which route source the bridge reads is its own
 * test's business, not this file's.
 */
function setRoute(pathname: string, search = ''): void {
    mockPathname = pathname;
    mockSearch = search;
    window.history.replaceState({}, '', `${pathname}${search === '' ? '' : `?${search}`}`);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('GameStoreBootstrap — /game → /lobby on a phase:lobby snapshot', () => {
    it('pushes /lobby and resets the store when a phase:lobby snapshot arrives on /game', () => {
        setSurface('match', '/game');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('preserves the game context (?gameId) when returning to /lobby', () => {
        setSurface('match', '/game', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/lobby?gameId=tactics');
    });

    it('does not navigate for a non-lobby snapshot on /game', () => {
        setSurface('match', '/game');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('does not navigate when there is no snapshot on /game', () => {
        setSurface('match', '/game');
        mockSnapshot = null;

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — /replays/player → /lobby on a phase:lobby snapshot', () => {
    it('pushes /lobby and resets the store when a phase:lobby snapshot arrives on the replay player', () => {
        // A post-game replay leaves the live session alive; the host's Leave
        // (returnToLobby) broadcasts a phase:'lobby' snapshot, and the replay route
        // must navigate to the lobby just like /game does.
        setSurface('replay-player', '/replays/player');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('does not navigate for a non-lobby snapshot on the replay player', () => {
        setSurface('replay-player', '/replays/player');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — existing /lobby → /game redirect (regression)', () => {
    it('pushes /game when a snapshot arrives on /lobby', () => {
        setSurface('lobby', '/lobby');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('keeps the /lobby arm phase-independent — pre-existing behaviour the widening does not touch', () => {
        // Every OTHER member of the entry allow-set requires a non-'lobby' phase;
        // /lobby does not, and did not before this task. Pinned so a reordering
        // that pulled it under the phase gate is a failing test, not a silent
        // change to the route the lobby⇄game pair is built around.
        setSurface('lobby', '/lobby');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
    });

    it('preserves the game context (?gameId) when redirecting to /game', () => {
        setSurface('lobby', '/lobby', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — /saves → /game redirect on a playing snapshot', () => {
    it('pushes /game when a playing snapshot arrives on /saves (restore completed)', () => {
        setSurface('saves', '/saves');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('preserves the game context (?gameId) when redirecting from /saves', () => {
        setSurface('saves', '/saves', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('does not navigate when there is no snapshot on /saves', () => {
        setSurface('saves', '/saves');
        mockSnapshot = null;

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate for a phase:lobby snapshot on /saves', () => {
        // A return-to-lobby broadcast must not bounce /saves through /game into
        // the game→lobby effect's reset; only a live match snapshot navigates.
        setSurface('saves', '/saves');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — app-level screen fade gates the navigation', () => {
    // These mount GameStoreBootstrap inside a real <FadeProvider>, so the
    // navigation effects take the fade path (fadeOut → then navigate) instead of
    // the no-provider instant path the tests above exercise.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            return globalThis.setTimeout(() => {
                callback(Date.now());
            }, 16) as unknown as number;
        });
        vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
            globalThis.clearTimeout(frameId);
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('fades out to black BEFORE resetting + navigating on a phase:lobby snapshot (game→lobby)', async () => {
        setSurface('match', '/game');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(
            <FadeProvider>
                <GameStoreBootstrap />
            </FadeProvider>,
        );

        // The fade-out is in flight — navigation must not have happened yet, and
        // the store must NOT have been reset (the game scene is still mounted).
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });

        // Once the overlay is fully black, reset + navigate fire exactly once.
        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('fades out before navigating to /game on a snapshot arriving on /main-menu', async () => {
        // The match-entry fade is the point of the gate, not an accident of the
        // /lobby arm: a menu-born session must reach the scene the same way.
        setSurface('main-menu', '/main-menu');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(
            <FadeProvider>
                <GameStoreBootstrap />
            </FadeProvider>,
        );

        expect(mockPush).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('fades out before navigating to /game on a snapshot arriving in the lobby (lobby→game)', async () => {
        setSurface('lobby', '/lobby');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(
            <FadeProvider>
                <GameStoreBootstrap />
            </FadeProvider>,
        );

        expect(mockPush).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — the snapshot gate reaches the main menu and game shell pages', () => {
    // The allow-set the effect gates on is the `lobby`, `saves`, `main-menu`
    // and `page` surfaces; the last three additionally require a non-'lobby'
    // phase so a return-to-lobby broadcast cannot bounce them through /game.
    it('pushes /game when a playing snapshot arrives on /main-menu', () => {
        setSurface('main-menu', '/main-menu');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('preserves the game context (?gameId) when redirecting from /main-menu', () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('does not navigate for a phase:lobby snapshot on /main-menu', () => {
        setSurface('main-menu', '/main-menu');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('pushes /game when a playing snapshot arrives on a game page surface', () => {
        setSurface('page', '/credits', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('does not navigate for a phase:lobby snapshot on a game page surface', () => {
        setSurface('page', '/credits', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate from an unclassified route with a live game context', () => {
        // An UNdeclared page classifies as boot, and boot is outside the
        // allow-set — which is what keeps a route nobody named out of the hop.
        setSurface('boot', '/atlas', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });

    it.each([
        ['replays', '/replays'],
        ['replay-player', '/replays/player'],
        ['settings', '/settings'],
    ] as const)(
        'does not navigate from the %s surface on a playing snapshot',
        (surface: ShellSurface, pathname: string) => {
            setSurface(surface, pathname, 'tactics');
            mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

            render(<GameStoreBootstrap />);

            expect(mockPush).not.toHaveBeenCalled();
        },
    );

    it('does not navigate from /debug, an engine route outside the allow-set', () => {
        setSurface('boot', '/debug', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — the gate arms the shell transition', () => {
    it('arms a to-match transition the moment the entry begins, not when it lands', () => {
        setSurface('main-menu', '/main-menu', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        // `screenFadeMs()` collapses to 0 under the e2e flag and reduced motion;
        // what the arm carries is whatever the fade this hop runs on is.
        expect(getShellState().transition).toEqual({
            kind: 'to-match',
            durationMs: screenFadeMs(),
        });
    });

    it('arms a to-shell transition on the reverse hop out of the match', () => {
        setSurface('match', '/game', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(getShellState().transition).toEqual({
            kind: 'to-shell',
            durationMs: screenFadeMs(),
        });
    });

    it('arms nothing when the gate does not fire', () => {
        setSurface('settings', '/settings', 'tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(getShellState().transition).toBeNull();
    });

    it('arms BEFORE the fade completes, so a background has the whole fade to move', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            return globalThis.setTimeout(() => {
                callback(Date.now());
            }, 16) as unknown as number;
        });
        vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
            globalThis.clearTimeout(frameId);
        });
        try {
            setSurface('lobby', '/lobby', 'tactics');
            mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

            render(
                <FadeProvider>
                    <GameStoreBootstrap />
                </FadeProvider>,
            );

            expect(mockPush).not.toHaveBeenCalled();
            expect(getShellState().transition).toEqual({
                kind: 'to-match',
                durationMs: screenFadeMs(),
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(400);
            });
            expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
});

describe('GameStoreBootstrap + ShellStateBridge — the gate re-evaluates on the declaration', () => {
    function Shell(): React.ReactElement {
        return (
            <>
                <ShellStateBridge />
                <GameStoreBootstrap />
            </>
        );
    }

    it('navigates once the shell payload resolves, when the snapshot landed first', async () => {
        // A reload straight onto a game page can deliver the match snapshot
        // before `shellRoutes` is known. The classification must RE-EVALUATE on
        // the resolve rather than strand the player on the page with a live match.
        let releaseShell: (shell: { shellRoutes: readonly `/${string}`[] }) => void = () => {};
        mockLoadRendererGameShell.mockReturnValue(
            new Promise<{ shellRoutes: readonly `/${string}`[] }>((resolve) => {
                releaseShell = resolve;
            }),
        );
        setRoute('/credits', 'gameId=tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<Shell />);

        expect(getShellState().surface).toBe('boot');
        expect(mockPush).not.toHaveBeenCalled();

        await act(async () => {
            releaseShell({ shellRoutes: ['/credits'] });
        });

        expect(getShellState().surface).toBe('page');
        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('matches a declared page reached on the exported trailing-slash spelling', async () => {
        mockLoadRendererGameShell.mockResolvedValue({ shellRoutes: ['/credits'] });
        setRoute('/credits/', 'gameId=tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<Shell />);

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
        });
    });

    it('leaves an UNdeclared page with the same game context alone', async () => {
        mockLoadRendererGameShell.mockResolvedValue({ shellRoutes: ['/credits'] });
        setRoute('/atlas', 'gameId=tactics');
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<Shell />);

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(mockPush).not.toHaveBeenCalled();
    });
});
