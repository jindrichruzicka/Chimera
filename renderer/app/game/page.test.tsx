// @vitest-environment jsdom
// renderer/app/game/page.test.tsx
//
// Unit tests for the game route page.
//
// Tests written first — confirmed RED before game/page.tsx was created.
//
// Architecture reference: §4.33–§4.34 — GameScreenRegistry, GameShell
// Task: Extract match UI into renderer/app/game/page.tsx
//
// Invariants upheld:
//   #3  — Only PlayerSnapshot (never GameSnapshot) enters the store mock.
//   #48 — GameShell is game-agnostic; game/page receives renderer game
//          modules from renderer/game/rendererGameRegistry.
//   #80 — Verified by the playfield being injected via registry prop.

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
import { I18nProvider } from '../../i18n/I18nProvider';
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
const mockClearRestoreAbort = vi.fn();
const mockSave = vi.fn();
let mockSnapshot: PlayerSnapshot | null = null;
let mockCurrentTick: number | undefined = undefined;
let mockLocalPlayerId: string | null = null;
let mockRole: 'player' | 'spectator' = 'player';
let mockLeavingToMainMenu = false;
let mockRestoreAbortPending = false;
let mockLobbyState: LobbyState | null = null;
let mockHasLoadedInitialLobbyState = true;
const loadRendererGameMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('../../state/saveStore', () => ({
    useSaveStore: Object.assign(
        (selector: (state: { readonly restoreAbortPending: boolean }) => unknown) =>
            selector({ restoreAbortPending: mockRestoreAbortPending }),
        { getState: () => ({ clearRestoreAbort: mockClearRestoreAbort }) },
    ),
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
                readonly role: 'player' | 'spectator';
                readonly leavingToMainMenu: boolean;
            }) => unknown,
        ) =>
            selector({
                localPlayerId: mockLocalPlayerId,
                role: mockRole,
                leavingToMainMenu: mockLeavingToMainMenu,
            }),
        {
            getState: () => ({
                setLeavingToMainMenu: mockSetLeavingToMainMenu,
                clearLocalLobbyContext: mockClearLocalLobbyContext,
            }),
        },
    ),
    useIsSpectator: () => mockRole === 'spectator',
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
    // Mirrors the real hook's `enabled` contract: a disabled call registers
    // NOTHING, rather than a callback the manager would still reach. What the
    // real hook does with the option is pinned in `useInputAction.test.tsx`.
    useInputAction: (
        id: InputActionId,
        cb: InputCallback,
        options?: { readonly enabled?: boolean },
    ) => {
        if (options?.enabled === false) {
            inputActionCallbacks.delete(id);
            return;
        }
        inputActionCallbacks.set(id, cb);
    },
}));

const testRegistry: GameScreenRegistry = {
    playfield: ({ snapshot, sendAction }: GameScreenProps) => (
        <div data-testid="test-playfield" data-tick={snapshot.tick}>
            {/* The scene barrier's ack, dispatched from inside the shell in
                production (`useFadeTransition` inside `SceneRouter`), reaches
                the page's wrapper the same way this does — through the
                `sendAction` the shell was handed. */}
            <button
                data-testid="dispatch-scene-ready"
                type="button"
                onClick={() =>
                    sendAction({
                        type: 'engine:scene_ready',
                        playerId: playerId('p1'),
                        tick: snapshot.tick,
                        payload: { playerId: 'p1' },
                    })
                }
            >
                Ack
            </button>
            <button
                data-testid="dispatch-gameplay"
                type="button"
                onClick={() =>
                    sendAction({
                        type: 'game:move',
                        playerId: playerId('p1'),
                        tick: snapshot.tick,
                        payload: {},
                    })
                }
            >
                Move
            </button>
        </div>
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
                {/* Surfaces the forwarded host role (GameHudProps.isHost, driven
                    by GameShell verbatim) so tests can assert the value the
                    post-game summary uses to pick its exportable replay — not
                    masked by controlsLocked the way the save affordance is. */}
                <output data-testid="hud-is-host">{String(props.isHost)}</output>
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
    // GamePage renders GameShell, whose tree calls useTranslate(); in production
    // AppShell mounts the i18n provider above the route. The inert provider
    // resolves engine English so the static save-toast titles hold.
    return render(
        <I18nProvider>
            <Providers>
                <ThemeProvider>
                    <GamePage />
                </ThemeProvider>
            </Providers>
        </I18nProvider>,
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
    mockRole = 'player';
    mockLeavingToMainMenu = false;
    mockLobbyState = makeLobbyState();
    mockHasLoadedInitialLobbyState = true;
    mockRestoreAbortPending = false;
    mockSendAction.mockReset();
    mockReplace.mockReset();
    mockReset.mockReset();
    mockSetLeavingToMainMenu.mockReset();
    mockClearLocalLobbyContext.mockReset();
    mockClearRestoreAbort.mockReset();
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

describe('GamePage — client leave-to-main-menu', () => {
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

describe('GamePage — restore-abort exit to /saves', () => {
    it('routes /game → /saves when the abort marker is set', () => {
        mockRestoreAbortPending = true;
        mockSnapshot = makeSnapshot();

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/saves');
    });

    it('preserves the game context (?gameId) on the abort exit', () => {
        window.history.replaceState({}, '', '/game?gameId=tactics');
        mockRestoreAbortPending = true;
        mockSnapshot = makeSnapshot();

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/saves?gameId=tactics');
    });

    it('drops the restored checkpoint and consumes the marker on the abort exit', () => {
        mockRestoreAbortPending = true;
        mockSnapshot = makeSnapshot();

        renderGamePage();

        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(mockClearRestoreAbort).toHaveBeenCalledTimes(1);
    });

    it('preempts the no-session /lobby redirect (abort exit wins once the lobby empties)', () => {
        // After the cancel unwinds the hosted session, snapshot and lobbyState
        // are both null — the direct-boot redirect would bounce to /lobby; the
        // abort exit must win and land on /saves instead.
        mockRestoreAbortPending = true;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/saves');
        expect(mockReplace).not.toHaveBeenCalledWith('/lobby');
    });

    it('does not route to /saves when the marker is not set', () => {
        mockRestoreAbortPending = false;
        mockSnapshot = null;
        mockLobbyState = null;

        renderGamePage();

        expect(mockReplace).toHaveBeenCalledWith('/lobby');
        expect(mockReplace).not.toHaveBeenCalledWith('/saves');
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

    it('renders the game playfield inside GameShell', async () => {
        mockSnapshot = makeSnapshot();
        renderGamePage();
        expect(await screen.findByTestId('test-playfield')).toBeTruthy();
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

    it('suppresses all action dispatch for a spectator (read-only playfield, Invariant #114)', async () => {
        mockRole = 'spectator';
        mockLocalPlayerId = 'watcher-1';
        mockSnapshot = makeSnapshot({ isMyTurn: true, undoMeta: { canUndo: true, canRedo: true } });
        renderGamePage();

        // Controls render disabled…
        const endTurn = await screen.findByTestId('end-turn');
        expect(endTurn).toBeDisabled();
        expect(screen.getByTestId('undo')).toBeDisabled();
        expect(screen.getByTestId('redo')).toBeDisabled();

        // …clicking them dispatches nothing…
        fireEvent.click(endTurn);
        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));

        // …and neither do the raw keyboard handlers (the sendAction wrapper is gated).
        act(() => {
            inputActionCallbacks.get('game:end-turn')?.({ pressed: true });
            inputActionCallbacks.get('engine:undo')?.({ pressed: true });
            inputActionCallbacks.get('engine:redo')?.({ pressed: true });
        });

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('still dispatches the scene barrier ack after the match has resolved', async () => {
        // The wrapper drops every action once the snapshot is terminal, which
        // is right for gameplay and a deadlock for the barrier: a transition in
        // flight when `gameResult` lands needs this ack to complete, and the
        // host's release is denominated in ticks that only an applied action
        // advances. Nothing else would ever send one.
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({
            gameResult: { winnerIds: [playerId('p2')] },
            phase: gamePhase('ended'),
        });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('dispatch-scene-ready'));

        expect(mockSendAction).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'engine:scene_ready' }),
        );
    });

    it('still drops a GAMEPLAY action after the match has resolved', async () => {
        // The other side of the same line, so the fix above is a door and not a
        // hole: only the scene lifecycle passes the terminal guard.
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({
            gameResult: { winnerIds: [playerId('p2')] },
            phase: gamePhase('ended'),
        });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('dispatch-gameplay'));

        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('drops the scene barrier ack for a SPECTATOR even after the match resolves', async () => {
        // The spectator gate is a different rule with a different reason
        // (Invariant #114: no seat, so every action it could produce is
        // structurally invalid) and the terminal-guard change must not widen
        // it. A spectator has no seat to acknowledge for.
        mockRole = 'spectator';
        mockLocalPlayerId = 'watcher-1';
        mockSnapshot = makeSnapshot({
            gameResult: { winnerIds: [playerId('p2')] },
            phase: gamePhase('ended'),
        });
        renderGamePage();

        fireEvent.click(await screen.findByTestId('dispatch-scene-ready'));

        expect(mockSendAction).not.toHaveBeenCalled();
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
        sceneDefaultScreens: { 'engine:game': 'playfield', 'engine:post-game': 'summary' },
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

        expect(useUiStore.getState().activeScreenKey).toBe('playfield');
        expect(mockSendAction).not.toHaveBeenCalled();
    });
});

describe('GamePage — in-game save', () => {
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

    it('does not treat a host-following spectator as host (Invariant #114)', async () => {
        // A spectator that follows the host's seat projects viewerId === hostId,
        // so a viewerId-only derivation would resolve isHost = true and offer the
        // deterministic-replay export the summary reserves for the host
        // (Invariants #71 / #98). The role must win: a spectator is never host.
        mockRole = 'spectator';
        mockLocalPlayerId = 'watcher-1';
        // Default lobby hosts 'p1'; the snapshot's viewerId is 'p1' (the followed
        // host seat), so the buggy viewerId-only derivation reports host.
        mockSnapshot = makeSnapshot();
        renderGamePage();

        // GameShell forwards the derived role verbatim to the playfield/HUD, where
        // the post-game summary reads it — assert it directly (controlsLocked
        // masks the save affordance regardless, so that alone would not catch it).
        expect(await screen.findByTestId('hud-is-host')).toHaveTextContent('false');
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

        // Invariant #74: the title is a static literal — toast contents are never
        // derived from `SaveFile`.
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

describe('GamePage — the declared undo capability', () => {
    /** The shape a game's own `renderer/loaders.ts` forwards. */
    const withMatchHistory = (
        matchHistory: { undo: boolean; replay: boolean; retainActions: number } | undefined,
    ): void => {
        loadRendererGameMock.mockResolvedValue(
            matchHistory === undefined
                ? { registry: testRegistry }
                : { registry: testRegistry, matchHistory },
        );
    };

    it('registers no undo key until the game payload has resolved', async () => {
        // Before the loader resolves the capability is UNKNOWN, not absent. A
        // registration made on the way in would have to be torn down once the
        // payload said no undo — and would be live for the window in between.
        withMatchHistory({ undo: true, replay: true, retainActions: 10_000 });
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: false } });
        renderGamePage();

        expect(inputActionCallbacks.has('engine:undo')).toBe(false);
        expect(inputActionCallbacks.has('engine:redo')).toBe(false);

        await screen.findByTestId('game-canvas');
        expect(inputActionCallbacks.has('engine:undo')).toBe(true);
        expect(inputActionCallbacks.has('engine:redo')).toBe(true);
    });

    it('registers no engine:undo or engine:redo key action', async () => {
        withMatchHistory({ undo: false, replay: true, retainActions: 1000 });
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: true } });
        renderGamePage();
        await screen.findByTestId('game-canvas');

        expect(inputActionCallbacks.has('engine:undo')).toBe(false);
        expect(inputActionCallbacks.has('engine:redo')).toBe(false);
        // The unrelated registration on the same route is untouched, so the
        // assertion above is about undo and not about registration failing.
        expect(inputActionCallbacks.has('game:end-turn')).toBe(true);
    });

    it('withholds the undo and redo handlers from the shell, so the HUD pair is inert', async () => {
        withMatchHistory({ undo: false, replay: true, retainActions: 1000 });
        // canUndo/canRedo are true and the match is live, so the ONLY thing that
        // can disable the pair is the withheld handler.
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: true } });
        renderGamePage();

        const undo = await screen.findByTestId('undo');
        const redo = await screen.findByTestId('redo');
        expect(undo).toBeDisabled();
        expect(redo).toBeDisabled();

        fireEvent.click(undo);
        fireEvent.click(redo);
        expect(mockSendAction).not.toHaveBeenCalled();
        // End turn is still offered, so "everything is disabled" is not what
        // this measured.
        expect(await screen.findByTestId('end-turn')).not.toBeDisabled();
    });

    it.each([
        ['an explicit undo: true declaration', { undo: true, replay: true, retainActions: 10_000 }],
        ['no declaration at all', undefined],
    ])('keeps both registrations and both handlers for %s', async (_label, matchHistory) => {
        withMatchHistory(matchHistory);
        mockLocalPlayerId = 'p1';
        mockSnapshot = makeSnapshot({ undoMeta: { canUndo: true, canRedo: true } });
        renderGamePage();

        const undo = await screen.findByTestId('undo');
        expect(undo).not.toBeDisabled();
        expect(await screen.findByTestId('redo')).not.toBeDisabled();
        expect(inputActionCallbacks.has('engine:undo')).toBe(true);
        expect(inputActionCallbacks.has('engine:redo')).toBe(true);

        fireEvent.click(undo);
        expect(mockSendAction).toHaveBeenCalledWith({
            type: 'engine:undo',
            playerId: 'p1',
            tick: 5,
            payload: { steps: 1 },
        });
    });
});
