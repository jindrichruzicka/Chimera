// renderer/app/match/page.test.tsx
// @vitest-environment jsdom
//
// Unit tests for the match route page.
//
// Tests written first — confirmed RED before match/page.tsx was created.
//
// Architecture reference: §4.33–§4.34 — GameScreenRegistry, MatchShell
// Task: issue #494 — Extract match UI into renderer/app/match/page.tsx
//
// Invariants upheld:
//   #1  — Only PlayerSnapshot (never GameSnapshot) enters the store mock.
//   #48 — MatchShell is game-agnostic; TacticsScreenRegistry is the sole
//          coupling point and lives in match/page.tsx, not in MatchShell.
//   #80 — Verified by the board being injected via registry prop (children).

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { ThemeProvider } from '../../theme/ThemeProvider';
import MatchPage from './page';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockSendAction = vi.fn();
let mockSnapshot: PlayerSnapshot | null = null;
let mockLocalPlayerId: string | null = null;

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('../../state/gameStore', () => ({
    useGameStore: (selector: (state: { readonly snapshot: PlayerSnapshot | null }) => unknown) =>
        selector({ snapshot: mockSnapshot }),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: (selector: (state: { readonly localPlayerId: string | null }) => unknown) =>
        selector({ localPlayerId: mockLocalPlayerId }),
}));

vi.mock('../../bridge/useSendAction', () => ({
    useSendAction: () => mockSendAction,
}));

// Minimal stub for TacticsDemoBoard (games/* import; kept in match/page.tsx
// per invariant #48 — MatchShell itself never imports from games/*).
vi.mock('@chimera/games/tactics/screens/index.js', () => ({
    TacticsScreenRegistry: {
        board: ({ snapshot }: { snapshot: PlayerSnapshot }) => (
            <div data-testid="tactics-board" data-tick={snapshot.tick} />
        ),
    },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderMatchPage(): ReturnType<typeof render> {
    return render(
        <ThemeProvider>
            <MatchPage />
        </ThemeProvider>,
    );
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 5,
        viewerId: id,
        players: { [id]: { id } },
        entities: {},
        phase: gamePhase('active'),
        events: [],
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockSnapshot = null;
    mockLocalPlayerId = null;
    mockSendAction.mockReset();
    mockReplace.mockReset();

    Object.defineProperty(window, '__chimera', {
        value: { game: { sendAction: vi.fn() } },
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('MatchPage — redirect', () => {
    it('calls router.replace("/lobby") when snapshot is null', () => {
        mockSnapshot = null;
        renderMatchPage();
        expect(mockReplace).toHaveBeenCalledWith('/lobby');
    });

    it('renders nothing visible when snapshot is null', () => {
        mockSnapshot = null;
        renderMatchPage();
        expect(screen.queryByTestId('match-canvas')).toBeNull();
    });

    it('does not redirect when snapshot is active', () => {
        mockSnapshot = makeSnapshot();
        renderMatchPage();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});

describe('MatchPage — rendering', () => {
    it('renders MatchShell (match-canvas testid) when snapshot is active', () => {
        mockSnapshot = makeSnapshot();
        renderMatchPage();
        expect(screen.getByTestId('match-canvas')).toBeTruthy();
    });

    it('renders the game board inside MatchShell', () => {
        mockSnapshot = makeSnapshot();
        renderMatchPage();
        expect(screen.getByTestId('tactics-board')).toBeTruthy();
    });

    it('displays the current tick in hud-tick', () => {
        mockSnapshot = makeSnapshot({ tick: 42 });
        renderMatchPage();
        expect(screen.getByTestId('hud-tick').textContent).toBe('42');
    });

    it('renders game-over banner when phase is ended', () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('ended') });
        renderMatchPage();
        expect(screen.getByTestId('game-over-banner')).toBeTruthy();
    });

    it('does not render lobby heading', () => {
        mockSnapshot = makeSnapshot();
        renderMatchPage();
        expect(screen.queryByRole('heading', { name: 'Multiplayer Lobby' })).toBeNull();
    });
});

describe('MatchPage — action dispatch', () => {
    it('dispatches engine:undo with localPlayerId and tick when undo is clicked', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderMatchPage();

        fireEvent.click(screen.getByTestId('undo'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:undo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('dispatches engine:redo with localPlayerId and tick when redo is clicked', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: true } });
        renderMatchPage();

        fireEvent.click(screen.getByTestId('redo'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:redo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('dispatches engine:end_turn with localPlayerId and tick when end-turn is clicked', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: true });
        renderMatchPage();

        fireEvent.click(screen.getByTestId('end-turn'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:end_turn',
            playerId: 'p1',
            tick: 5,
            payload: {},
        });
    });

    it('does not dispatch undo when localPlayerId is null', () => {
        mockLocalPlayerId = null;
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderMatchPage();

        // undo button is disabled when no onUndo handler is wired
        expect(screen.getByTestId('undo').hasAttribute('disabled')).toBe(true);
    });
});

describe('MatchPage — button states', () => {
    it('disables undo button when canUndo is false', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderMatchPage();
        expect(screen.getByTestId('undo').hasAttribute('disabled')).toBe(true);
    });

    it('enables undo button when canUndo is true', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderMatchPage();
        expect(screen.getByTestId('undo').hasAttribute('disabled')).toBe(false);
    });

    it('disables redo button when canRedo is false', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderMatchPage();
        expect(screen.getByTestId('redo').hasAttribute('disabled')).toBe(true);
    });

    it('enables redo button when canRedo is true', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: true } });
        renderMatchPage();
        expect(screen.getByTestId('redo').hasAttribute('disabled')).toBe(false);
    });

    it('disables end-turn button when isMyTurn is false', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: false });
        renderMatchPage();
        expect(screen.getByTestId('end-turn').hasAttribute('disabled')).toBe(true);
    });

    it('enables end-turn button when isMyTurn is true', () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: true });
        renderMatchPage();
        expect(screen.getByTestId('end-turn').hasAttribute('disabled')).toBe(false);
    });
});
