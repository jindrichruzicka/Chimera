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

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
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

describe('GameStoreBootstrap — existing /lobby → /game redirect (regression)', () => {
    it('pushes /game when a snapshot arrives on /lobby', () => {
        window.history.replaceState({}, '', '/lobby');
        mockPathname = '/lobby';
        mockSnapshot = makeSnapshot({ phase: gamePhase('playing') });

        render(<GameStoreBootstrap />);

        expect(mockPush).toHaveBeenCalledWith('/game');
        expect(mockReset).not.toHaveBeenCalled();
    });
});
