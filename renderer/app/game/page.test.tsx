// @vitest-environment jsdom
// renderer/app/game/page.test.tsx
//
// Unit tests for the game route page.
//
// Tests written first — confirmed RED before game/page.tsx was created.
//
// Architecture reference: §4.33–§4.34 — GameScreenRegistry, GameShell
// Task: issue #494 — Extract match UI into renderer/app/game/page.tsx
//
// Invariants upheld:
//   #1  — Only PlayerSnapshot (never GameSnapshot) enters the store mock.
//   #48 — GameShell is game-agnostic; game/page receives renderer game
//          modules from renderer/game/rendererGameRegistry.
//   #80 — Verified by the board being injected via registry prop.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type LobbyState,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameHudProps,
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { DeviceInfo } from '../../device/DeviceInfo.js';
import { useToastStore } from '../../state/toastStore';
import { useUiStore } from '../../state/uiStore';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Providers } from '../providers';
import GamePage from './page';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockSendAction = vi.fn();
const mockReset = vi.fn();
const mockSetLeavingToMainMenu = vi.fn();
const mockClearLocalLobbyContext = vi.fn();
const mockSave = vi.fn();
let mockSnapshot: PlayerSnapshot | null = null;
let mockCurrentTick: number | undefined = undefined;
let mockLocalPlayerId: string | null = null;
let mockLeavingToMainMenu = false;
let mockLobbyState: LobbyState | null = null;
let mockHasLoadedInitialLobbyState = true;
const loadRendererGameMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('../../state/gameStore', () => ({
    useGameStore: Object.assign(
        (
            selector: (state: {
                readonly snapshot: PlayerSnapshot | null;
                readonly currentTick: number | undefined;
            }) => unknown,
        ) => selector({ snapshot: mockSnapshot, currentTick: mockCurrentTick }),
        { getState: () => ({ reset: mockReset }) },
    ),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: Object.assign(
        (
            selector: (state: {
                readonly localPlayerId: string | null;
                readonly leavingToMainMenu: boolean;
            }) => unknown,
        ) =>
            selector({
                localPlayerId: mockLocalPlayerId,
                leavingToMainMenu: mockLeavingToMainMenu,
            }),
        {
            getState: () => ({
                setLeavingToMainMenu: mockSetLeavingToMainMenu,
                clearLocalLobbyContext: mockClearLocalLobbyContext,
            }),
        },
    ),
}));

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: (
        selector: (state: {
            readonly lobbyState: LobbyState | null;
            readonly hasLoadedInitialState: boolean;
        }) => unknown,
    ) =>
        selector({
            lobbyState: mockLobbyState,
            hasLoadedInitialState: mockHasLoadedInitialLobbyState,
        }),
}));

vi.mock('../../bridge/useSendAction', () => ({
    useSendAction: () => mockSendAction,
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: loadRendererGameMock,
}));

// useInputAction mock — captures registered callbacks so tests can fire them manually.
interface InputEvent {
    pressed: boolean;
}
type InputActionId = string;
type InputCallback = (event: InputEvent) => void;
const inputActionCallbacks = new Map<InputActionId, InputCallback>();
vi.mock('../../input/useInputAction.js', () => ({
    useInputAction: (id: InputActionId, cb: InputCallback) => {
        inputActionCallbacks.set(id, cb);
    },
}));

const testRegistry: GameScreenRegistry = {
    board: ({ snapshot }: GameScreenProps) => (
        <div data-testid="test-board" data-tick={snapshot.tick} />
    ),
    hud: (props: GameHudProps) => {
        const {
            tick,
            undoDisabled,
            redoDisabled,
            endTurnDisabled,
            handleUndo,
            handleRedo,
            handleEndTurn,
        } = props;
        return (
            <footer data-testid="registry-hud" aria-label="Registry HUD">
                <output data-testid="hud-tick">{tick}</output>
                <button
                    data-testid="undo"
                    type="button"
                    disabled={undoDisabled}
                    onClick={handleUndo}
                >
                    Undo
                </button>
                <button
                    data-testid="redo"
                    type="button"
                    disabled={redoDisabled}
                    onClick={handleRedo}
                >
                    Redo
                </button>
                <button
                    data-testid="end-turn"
                    type="button"
                    disabled={endTurnDisabled}
                    onClick={handleEndTurn}
                >
                    End Turn
                </button>
                {/* Capability-style prop (#825): rendered only when the shell
                    forwards saveGame — plain buttons stand in for the ui
                    barrel's SaveGameButton, whose dialog has its own tests. */}
                {props.saveGame === undefined ? null : (
                    <>
                        <button
                            data-testid="hud-save"
                            type="button"
                            onClick={() => props.saveGame?.('Alpha')}
                        >
                            Save
                        </button>
                        <button
                            data-testid="hud-save-blank"
                            type="button"
                            onClick={() => props.saveGame?.('')}
                        >
                            Save unnamed
                        </button>
                    </>
                )}
            </footer>
        );
    },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderGamePage(): ReturnType<typeof render> {
    return render(
        <Providers>
            <ThemeProvider>
                <GamePage />
            </ThemeProvider>
        </Providers>,
    );
}

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

function makeLobbyState(gameId = 'test-game'): LobbyState {
    return {
        info: {
            sessionId: 'session-1',
            hostId: 'p1',
            gameId,
        },
        players: [
            {
                playerId: 'p1',
                displayName: 'Player One',
                ready: true,
            },
        ],
    };
}

function makeDeviceInfo(): DeviceInfo {
    return {
        os: 'macos',
        osVersion: '14.5.0',
        arch: 'arm64',
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        formFactor: 'laptop',
        screens: [
            {
                id: 1,
                width: 1440,
                height: 900,
                pixelRatio: 2,
                refreshHz: 60,
                primary: true,
            },
        ],
        windowSizeClass: 'regular',
        inputs: ['mouse', 'keyboard'],
        primaryInput: 'mouse',
        battery: null,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockSnapshot = null;
    mockCurrentTick = undefined;
    mockLocalPlayerId = null;
    mockLeavingToMainMenu = false;
    mockLobbyState = makeLobbyState();
    mockHasLoadedInitialLobbyState = true;
    mockSendAction.mockReset();
    mockReplace.mockReset();
    mockReset.mockReset();
    mockSetLeavingToMainMenu.mockReset();
    mockClearLocalLobbyContext.mockReset();
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({ registry: testRegistry });
    mockSave.mockReset();
    inputActionCallbacks.clear();
    // uiStore and toastStore are module singletons shared across tests; reset
    // screen navigation and the toast queue so each test starts clean.
    useUiStore.getState().resetScreenNavigation();
    useToastStore.getState().dismissAll();
    window.history.replaceState({}, '', '/game');

    Object.defineProperty(window, '__chimera', {
        value: {
            game: { sendAction: vi.fn() },
            system: {
                getDeviceInfo: vi.fn().mockResolvedValue(makeDeviceInfo()),
                onDeviceInfoChange: vi.fn().mockReturnValue(vi.fn()),
            },
            saves: { save: mockSave },
        },
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    useToastStore.getState().dismissAll();
    vi.restoreAllMocks();
});

describe('GamePage — redirect', () => {
    it('calls router.replace("/lobby") when snapshot is null', () => {
        mockSnapshot = null;
        mockLobbyState = null;
        renderGamePage();
        expect(mockReplace).toHaveBeenCalledWith('/lobby');
    });

    it('preserves URL game context when redirecting a new-game route to lobby', () => {
        window.history.replaceState({}, '', '/game?gameId=tactics');
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/lobby?gameId=tactics');
    });

    it('does not redirect before the lobby bootstrap has loaded initial state', () => {
        mockSnapshot = null;
        mockHasLoadedInitialLobbyState = false;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not redirect while an active lobby session is waiting for the first match snapshot', () => {
        mockSnapshot = null;
        mockLobbyState = makeLobbyState();

        renderGamePage();

        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders nothing visible when snapshot is null', () => {
        mockSnapshot = null;
        mockLobbyState = null;
        renderGamePage();
        expect(screen.queryByTestId('game-canvas')).toBeNull();
    });

    it('does not redirect when snapshot is active', async () => {
        mockSnapshot = makeSnapshot();
        renderGamePage();
        await screen.findByTestId('game-canvas');
        expect(mockReplace).not.toHaveBeenCalled();
    });
});

describe('GamePage — client leave-to-main-menu (#741)', () => {
    it('routes /game → /main-menu when the leaving-intent flag is set', () => {
        mockLeavingToMainMenu = true;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/main-menu');
    });

    it('preserves the game context (?gameId) when routing /game → /main-menu', () => {
        window.history.replaceState({}, '', '/game?gameId=tactics');
        mockLeavingToMainMenu = true;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('drops the stale snapshot and consumes the flag on the leave transition', () => {
        mockLeavingToMainMenu = true;
        mockSnapshot = makeSnapshot();

        renderGamePage();

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockSetLeavingToMainMenu).toHaveBeenCalledWith(false);
    });

    it('preempts the direct-boot /lobby redirect (leave wins over no-session)', () => {
        // snapshot + lobbyState both null would normally direct-boot to /lobby;
        // the in-flight leave must win and never push /lobby.
        mockLeavingToMainMenu = true;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/main-menu');
        expect(mockReplace).not.toHaveBeenCalledWith('/lobby');
    });

    it('does not route to /main-menu when the flag is not set (direct boot still goes to /lobby)', () => {
        mockLeavingToMainMenu = false;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/lobby');
        expect(mockReplace).not.toHaveBeenCalledWith('/main-menu');
    });
});

describe('GamePage — rendering', () => {
    it('loads the active game renderer bundle from the lobby game id', async () => {
        mockLobbyState = makeLobbyState('space-arena');
        mockSnapshot = makeSnapshot();
        renderGamePage();

        await screen.findByTestId('game-canvas');

        expect(loadRendererGameMock).toHaveBeenCalledWith('space-arena');
    });

    it('renders GameShell (game-canvas testid) when snapshot is active', async () => {
        mockSnapshot = makeSnapshot();
        renderGamePage();
        expect(await screen.findByTestId('game-canvas')).toBeTruthy();
    });

    it('renders the game board inside GameShell', async () => {
        mockSnapshot = makeSnapshot();
        renderGamePage();
        expect(await screen.findByTestId('test-board')).toBeTruthy();
    });

    it('displays the current tick in hud-tick', async () => {
        mockSnapshot = makeSnapshot({ tick: 42 });
        mockCurrentTick = 43;
        renderGamePage();
        expect((await screen.findByTestId('hud-tick')).textContent).toBe('43');
    });

    it('renders the HUD override from the active game registry', async () => {
        mockSnapshot = makeSnapshot({ tick: 42 });
        renderGamePage();
        expect(await screen.findByTestId('registry-hud')).toBeTruthy();
    });

    it('renders game result banner when phase is ended', async () => {
        mockSnapshot = makeSnapshot({ phase: gamePhase('ended') });
        renderGamePage();
        expect(await screen.findByTestId('game-result-banner')).toBeTruthy();
    });

    it('does not render lobby heading', async () => {
        mockSnapshot = makeSnapshot();
        renderGamePage();
        await screen.findByTestId('game-canvas');
        expect(screen.queryByRole('heading', { name: 'Multiplayer Lobby' })).toBeNull();
    });
});

describe('GamePage — action dispatch', () => {
    it('dispatches engine:undo with localPlayerId and tick when undo is clicked', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('undo'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:undo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('dispatches engine:redo with localPlayerId and tick when redo is clicked', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: true } });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('redo'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:redo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('dispatches engine:end_turn with localPlayerId and tick when end-turn is clicked', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: true });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('end-turn'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:end_turn',
            playerId: 'p1',
            tick: 5,
            payload: {},
        });
    });

    it('dispatches with currentTick when it is newer than snapshot.tick', async () => {
        mockLocalPlayerId = 'p1';
        mockCurrentTick = 12;
        mockSnapshot = makeSnapshot({ tick: 5, isMyTurn: true });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('end-turn'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:end_turn',
            playerId: 'p1',
            tick: 12,
            payload: {},
        });
    });

    it('falls back to snapshot.viewerId when localPlayerId is null', async () => {
        mockLocalPlayerId = null;
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('undo'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:undo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('dispatches with snapshot.viewerId when the local lobby context is stale', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({
            viewerId: playerId('p2'),
            isMyTurn: true,
        });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('end-turn'));

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:end_turn',
            playerId: 'p2',
            tick: 5,
            payload: {},
        });
    });
});

describe('GamePage — button states', () => {
    it('disables undo button when canUndo is false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderGamePage();
        expect((await screen.findByTestId('undo')).hasAttribute('disabled')).toBe(true);
    });

    it('enables undo button when canUndo is true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderGamePage();
        expect((await screen.findByTestId('undo')).hasAttribute('disabled')).toBe(false);
    });

    it('disables redo button when canRedo is false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderGamePage();
        expect((await screen.findByTestId('redo')).hasAttribute('disabled')).toBe(true);
    });

    it('enables redo button when canRedo is true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: true } });
        renderGamePage();
        expect((await screen.findByTestId('redo')).hasAttribute('disabled')).toBe(false);
    });

    it('disables end-turn button when isMyTurn is false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: false });
        renderGamePage();
        expect((await screen.findByTestId('end-turn')).hasAttribute('disabled')).toBe(true);
    });

    it('enables end-turn button when isMyTurn is true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: true });
        renderGamePage();
        expect((await screen.findByTestId('end-turn')).hasAttribute('disabled')).toBe(false);
    });

    it('disables undo, redo, and end-turn after a match result is resolved', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
            undoMeta: { canUndo: true, canRedo: true },
            isMyTurn: true,
        });
        renderGamePage();

        const undoButton = await screen.findByTestId('undo');
        const redoButton = await screen.findByTestId('redo');
        const endTurnButton = await screen.findByTestId('end-turn');

        expect(undoButton.hasAttribute('disabled')).toBe(true);
        expect(redoButton.hasAttribute('disabled')).toBe(true);
        expect(endTurnButton.hasAttribute('disabled')).toBe(true);

        fireEvent.click(undoButton);
        fireEvent.click(redoButton);
        fireEvent.click(endTurnButton);

        expect(mockSendAction).not.toHaveBeenCalled();
    });
});

describe('GamePage — keyboard-triggered action dispatch', () => {
    it('dispatches engine:undo when engine:undo key action fires and canUndo=true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        const cb = inputActionCallbacks.get('engine:undo');
        expect(cb).toBeDefined();
        cb!({ pressed: true });

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:undo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('does not dispatch engine:undo when canUndo=false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        inputActionCallbacks.get('engine:undo')?.({ pressed: true });

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('dispatches engine:redo when engine:redo key action fires and canRedo=true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: true } });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        const cb = inputActionCallbacks.get('engine:redo');
        expect(cb).toBeDefined();
        cb!({ pressed: true });

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:redo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });

    it('does not dispatch engine:redo when canRedo=false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: false, canRedo: false } });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        inputActionCallbacks.get('engine:redo')?.({ pressed: true });

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('dispatches engine:end_turn when game:end-turn key action fires and isMyTurn=true', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: true });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        const cb = inputActionCallbacks.get('game:end-turn');
        expect(cb).toBeDefined();
        cb!({ pressed: true });

        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:end_turn',
            playerId: 'p1',
            tick: 5,
            payload: {},
        });
    });

    it('does not dispatch engine:end_turn when isMyTurn=false', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ isMyTurn: false });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        inputActionCallbacks.get('game:end-turn')?.({ pressed: true });

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('does not dispatch on key-up events (pressed=false)', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: true }, isMyTurn: true });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        inputActionCallbacks.get('engine:undo')?.({ pressed: false });
        inputActionCallbacks.get('engine:redo')?.({ pressed: false });
        inputActionCallbacks.get('game:end-turn')?.({ pressed: false });

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('does not dispatch keyboard actions after a match result is resolved', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
            undoMeta: { canUndo: true, canRedo: true },
            isMyTurn: true,
        });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        inputActionCallbacks.get('engine:undo')?.({ pressed: true });
        inputActionCallbacks.get('engine:redo')?.({ pressed: true });
        inputActionCallbacks.get('game:end-turn')?.({ pressed: true });

        expect(mockSendAction).not.toHaveBeenCalled();
    });
});

describe('GamePage — post-game summary navigation', () => {
    const summaryRegistry: GameScreenRegistry = {
        ...testRegistry,
        screens: { summary: () => <div data-testid="test-summary" /> },
        sceneDefaultScreens: { 'engine:game': 'board', 'engine:post-game': 'summary' },
    };

    it('navigates to the post-game summary when game:end-turn (Enter) fires after the match resolves', async () => {
        mockLocalPlayerId = 'p1';
        loadRendererGameMock.mockResolvedValue({ registry: summaryRegistry });
        mockSnapshot = makeSnapshot({
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
            isMyTurn: true,
        });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        const cb = inputActionCallbacks.get('game:end-turn');
        expect(cb).toBeDefined();
        act(() => {
            cb!({ pressed: true });
        });

        expect(useUiStore.getState().activeScreenKey).toBe('summary');
        expect(await screen.findByTestId('test-summary')).toBeTruthy();
        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('does not change screens when the game declares no post-game summary screen', async () => {
        mockLocalPlayerId = 'p1';
        // testRegistry declares no sceneDefaultScreens / summary screen.
        mockSnapshot = makeSnapshot({
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
            isMyTurn: true,
        });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        act(() => {
            inputActionCallbacks.get('game:end-turn')?.({ pressed: true });
        });

        expect(useUiStore.getState().activeScreenKey).toBe('board');
        expect(mockSendAction).not.toHaveBeenCalled();
    });
});

describe('GamePage — in-game save (#825)', () => {
    function makeSaveSlotMeta(): Record<string, unknown> {
        return {
            slotId: 'slot-1',
            gameId: 'test-game',
            tick: 5,
            savedAt: 1700000000000,
            label: 'Alpha',
        };
    }

    it('exposes saveGame to the registry HUD and saves with the given label when hosting', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot();
        mockSave.mockResolvedValue(makeSaveSlotMeta());
        renderGamePage();

        fireEvent.click(await screen.findByTestId('hud-save'));

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledWith({ gameId: 'test-game', label: 'Alpha' });
    });

    it('withholds saveGame from a joined client (viewer is not the lobby host)', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot();
        const clientLobby = makeLobbyState();
        mockLobbyState = {
            ...clientLobby,
            info: { ...clientLobby.info, hostId: 'p2' },
        };
        renderGamePage();

        await screen.findByTestId('registry-hud');

        expect(screen.queryByTestId('hud-save')).not.toBeInTheDocument();
    });

    it('omits the label key entirely when the save name is blank', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot();
        mockSave.mockResolvedValue(makeSaveSlotMeta());
        renderGamePage();

        fireEvent.click(await screen.findByTestId('hud-save-blank'));

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockSave).toHaveBeenCalledWith({ gameId: 'test-game' });
        expect(mockSave.mock.calls[0]?.[0]).not.toHaveProperty('label');
    });

    it('pushes a static success toast when the save resolves', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot();
        mockSave.mockResolvedValue(makeSaveSlotMeta());
        renderGamePage();

        fireEvent.click(await screen.findByTestId('hud-save'));

        // Invariant #74: static literal title, no save metadata.
        await waitFor(() => {
            expect(useToastStore.getState().queue).toContainEqual(
                expect.objectContaining({ severity: 'success', title: 'Game saved' }),
            );
        });
    });

    it('pushes a static error toast when the save rejects', async () => {
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot();
        mockSave.mockRejectedValue(new Error('boom'));
        renderGamePage();

        fireEvent.click(await screen.findByTestId('hud-save'));

        await waitFor(() => {
            expect(useToastStore.getState().queue).toContainEqual(
                expect.objectContaining({ severity: 'error', title: 'Save failed' }),
            );
        });
        expect(useToastStore.getState().queue.some((toast) => toast.severity === 'success')).toBe(
            false,
        );
    });
});
