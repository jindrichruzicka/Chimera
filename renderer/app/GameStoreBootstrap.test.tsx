// @vitest-environment jsdom

/**
 * renderer/app/GameStoreBootstrap.test.tsx
 *
 * Routing tests for GameStoreBootstrap — the global wiring component that drives
 * snapshot-phase-based navigation between /lobby and /game.
 *
 * Covers issue #741: a phase:'lobby' snapshot on /game returns to /lobby (host
 * return-to-lobby + following clients) after dropping the stale match snapshot,
 * and the pre-existing /lobby → /game redirect on the first match snapshot still
 * works.
 *
 * The IPC/perf bootstrap effects no-op here: globalThis.__chimera is left unset
 * so they early-return, and the bootstrap functions are mocked.
 *
 * Invariant #1: only PlayerSnapshot.phase is consumed for routing decisions.
 */

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { FadeProvider } from '../components/shell/FadeContext';
import { GameStoreBootstrap } from './GameStoreBootstrap';

const mockPush = vi.fn();
const mockReset = vi.fn();
let mockPathname = '/game';
let mockSnapshot: PlayerSnapshot | null = null;

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
    usePathname: () => mockPathname,
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
    mockReset.mockReset();
    mockSnapshot = null;
    mockPathname = '/game';
    window.history.replaceState({}, '', '/game');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('GameStoreBootstrap — /game → /lobby on a phase:lobby snapshot (#741)', () => {
    it('pushes /lobby and resets the store when a phase:lobby snapshot arrives on /game', () => {
        window.history.replaceState({}, '', '/game');
        mockPathname = '/game';
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('preserves the game context (?gameId) when returning to /lobby', () => {
        window.history.replaceState({}, '', '/game?gameId=tactics');
        mockPathname = '/game';
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/lobby?gameId=tactics');
    });

    it('does not navigate for a non-lobby snapshot on /game', () => {
        window.history.replaceState({}, '', '/game');
        mockPathname = '/game';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('does not navigate when there is no snapshot on /game', () => {
        window.history.replaceState({}, '', '/game');
        mockPathname = '/game';
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
        window.history.replaceState({}, '', '/replays/player');
        mockPathname = '/replays/player';
        mockSnapshot = makeSnapshot({ phase: gamePhase('lobby') });

        render(<GameStoreBootstrap />);

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('does not navigate for a non-lobby snapshot on the replay player', () => {
        window.history.replaceState({}, '', '/replays/player');
        mockPathname = '/replays/player';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — existing /lobby → /game redirect (regression)', () => {
    it('pushes /game when a snapshot arrives on /lobby', () => {
        window.history.replaceState({}, '', '/lobby');
        mockPathname = '/lobby';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('preserves the game context (?gameId) when redirecting to /game', () => {
        window.history.replaceState({}, '', '/lobby?gameId=tactics');
        mockPathname = '/lobby';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('GameStoreBootstrap — /saves → /game redirect on a playing snapshot (#828)', () => {
    it('pushes /game when a playing snapshot arrives on /saves (restore completed)', () => {
        window.history.replaceState({}, '', '/saves');
        mockPathname = '/saves';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('preserves the game context (?gameId) when redirecting from /saves', () => {
        window.history.replaceState({}, '', '/saves?gameId=tactics');
        mockPathname = '/saves';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('does not navigate when there is no snapshot on /saves', () => {
        window.history.replaceState({}, '', '/saves');
        mockPathname = '/saves';
        mockSnapshot = null;

        render(<GameStoreBootstrap />);

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate for a phase:lobby snapshot on /saves', () => {
        // A return-to-lobby broadcast must not bounce /saves through /game into
        // the game→lobby effect's reset; only a live match snapshot navigates.
        window.history.replaceState({}, '', '/saves');
        mockPathname = '/saves';
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
        window.history.replaceState({}, '', '/game');
        mockPathname = '/game';
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

    it('fades out before navigating to /game on a snapshot arriving in the lobby (lobby→game)', async () => {
        window.history.replaceState({}, '', '/lobby');
        mockPathname = '/lobby';
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
