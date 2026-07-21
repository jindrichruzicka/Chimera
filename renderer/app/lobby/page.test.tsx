// renderer/app/lobby/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { EscapeStackProvider } from '../../components/shell/EscapeStack';
import modalCss from '../../components/ui/Modal.module.css?raw';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';
import { ThemeProvider } from '../../theme/ThemeProvider';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import LobbyPage from './page';
import pageCss from './page.module.css?raw';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

interface MockLobbyStoreState {
    readonly lobbyState: {
        readonly info: {
            readonly sessionId: string;
            readonly hostId: string;
            readonly gameId: string;
        };
        readonly players: readonly {
            readonly playerId: string;
            readonly displayName: string;
            readonly ready: boolean;
        }[];
    } | null;
}

interface MockLobbyUiStoreState {
    readonly localPlayerId: string | null;
    readonly localSeatIds: readonly string[];
}

let mockLocalSeatIds: readonly string[] = [];
let mockLocalPlayerId: string | null = null;
let mockLobbyState: MockLobbyStoreState['lobbyState'] = null;
// Reassigned fresh per test in the pending-actions beforeEach so start-game tests
// can assert the lobby invoked startGame() (navigation is GameStoreBootstrap's job).
let mockStartGame = vi.fn(async (): Promise<void> => undefined);

// Game shell returned by the mocked registry. Defaults to an empty shell (no
// LobbyScreen) so the engine-default ActiveLobbyPanel renders and the existing
// tests stay green. A plain function — not vi.fn — so the global
// `restoreMocks` does not strip its implementation between tests.
let mockLobbyShell: Partial<LoadedRendererGameShell> = {};

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: () => Promise.resolve(mockLobbyShell),
}));

// Probe lobby screen: renders editable host controls (wired to the contract
// setters) or a read-only marker for clients, proving the page delivers
// `isHost` + the setters through GameLobbyScreenProps.
function StubLobbyScreen({
    isHost,
    localPlayerId,
    setMatchSetting,
    setPlayerAttribute,
}: GameLobbyScreenProps): React.ReactElement {
    return (
        <div data-testid="stub-lobby-screen">
            {/* Board colour is host-authored. */}
            {isHost ? (
                <button
                    data-testid="stub-edit-board"
                    onClick={() => {
                        setMatchSetting('boardColor', 'amber');
                    }}
                    type="button"
                >
                    Board colour
                </button>
            ) : (
                <span data-testid="stub-readonly">read-only board</span>
            )}
            {/* Player colour is owner-authored: every player edits its OWN seat. */}
            <button
                data-testid="stub-edit-color"
                onClick={() => {
                    setPlayerAttribute(localPlayerId, 'color', 'blue');
                }}
                type="button"
            >
                Player colour
            </button>
        </div>
    );
}

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: (selector: (state: MockLobbyStoreState) => unknown) =>
        selector({
            lobbyState: mockLobbyState,
        }),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: (selector: (state: MockLobbyUiStoreState) => unknown) =>
        selector({
            localPlayerId: mockLocalPlayerId,
            localSeatIds: mockLocalSeatIds,
        }),
}));

vi.mock('../../state/lobbyStoreBootstrap', () => ({
    bootstrapLobbyStore: vi.fn(() => () => undefined),
}));

interface DeferredPromise {
    readonly promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
}

function createDeferredPromise(): DeferredPromise {
    let resolveFn: () => void = () => undefined;
    let rejectFn: (error: Error) => void = () => undefined;

    const promise = new Promise<void>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });

    return {
        promise,
        resolve: resolveFn,
        reject: rejectFn,
    };
}

// The page renders through the shared Modal, whose Escape handling registers on
// the overlay stack — every render must sit inside an EscapeStackProvider. The
// page reads its chrome/footer strings through useTranslate(), which throws
// outside I18nProvider, so that wrapper is outermost; a `gameOverride` bundle
// re-keys engine tokens to prove the strings are token-driven.
function renderLobbyPageElement(gameOverride?: TranslationBundle): React.ReactElement {
    // Spread `gameOverride` only when supplied: I18nProviderProps declares it
    // optional and the tree compiles with exactOptionalPropertyTypes, so an
    // explicit `undefined` is rejected.
    const providerProps = gameOverride !== undefined ? { gameOverride } : {};
    return (
        <I18nProvider {...providerProps}>
            <EscapeStackProvider>
                <ThemeProvider>
                    <LobbyPage />
                </ThemeProvider>
            </EscapeStackProvider>
        </I18nProvider>
    );
}

function renderLobbyPage(gameOverride?: TranslationBundle): ReturnType<typeof render> {
    return render(renderLobbyPageElement(gameOverride));
}

describe('LobbyPage pending actions', () => {
    let hostDeferred: DeferredPromise;

    beforeEach(() => {
        hostDeferred = createDeferredPromise();
        mockLocalSeatIds = [];
        mockLocalPlayerId = null;
        mockLobbyState = null;
        mockPush.mockReset();
        mockStartGame = vi.fn(async () => undefined);
        // jsdom location persists across tests in a file; reset each to the URL a
        // real launch produces — `?gameId=` is always supplied externally, and
        // hosting needs it (the engine picks no game). Tests that exercise the
        // no-game-context state override this explicitly.
        window.history.replaceState({}, '', '/lobby?gameId=tactics');

        Object.defineProperty(window, '__chimera', {
            value: {
                lobby: {
                    host: vi.fn(() => hostDeferred.promise),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p2'),
                    leave: vi.fn(async () => undefined),
                    startGame: mockStartGame,
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: {
                    onConnectionStatus: vi.fn(() => () => undefined),
                },
                game: {
                    sendAction: vi.fn(),
                },
            },
            configurable: true,
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('disables the footer action while hosting is in progress', async () => {
        renderLobbyPage();

        const hostButton = screen.getByTestId('host-lobby');

        fireEvent.click(hostButton);

        await waitFor(() => {
            expect(screen.getByText('Hosting...')).toBeTruthy();
            expect(hostButton.hasAttribute('disabled')).toBe(true);
        });

        hostDeferred.resolve();
    });

    it('does not update state after unmount while host request is still pending', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const rendered = renderLobbyPage();
        const hostButton = screen.getByTestId('host-lobby');

        fireEvent.click(hostButton);

        await waitFor(() => {
            expect(screen.getByText('Hosting...')).toBeTruthy();
        });

        rendered.unmount();
        hostDeferred.resolve();

        await Promise.resolve();
        await Promise.resolve();

        expect(consoleErrorSpy.mock.calls.length).toBe(0);
    });

    it('renders lobby page object locators before a lobby is joined', () => {
        renderLobbyPage();

        expect(screen.getByTestId('host-lobby')).toBeTruthy();
        expect(screen.getByTestId('join-lobby')).toBeTruthy();
        expect(screen.getByTestId('address-input')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));

        expect(screen.getByTestId('confirm-join')).toBeTruthy();
    });

    it('renders host and join as modal tabs before a lobby is joined', () => {
        renderLobbyPage();

        expect(screen.getByRole('dialog', { name: 'Multiplayer Lobby' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Host', selected: true })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Join', selected: false })).toBeTruthy();
        expect(screen.getByTestId('host-lobby')).toBeTruthy();
        expect(screen.getByTestId('address-input')).not.toBeVisible();
        expect(screen.queryByText('tactics / 4 seats')).toBeNull();

        const hostFooter = screen.getByTestId('lobby-action-bar');
        const closeButton = screen.getByTestId('lobby-close');
        const hostButton = screen.getByTestId('host-lobby');
        expect(hostButton.parentElement).toBe(hostFooter);
        expect(closeButton.parentElement).toBe(hostFooter);
        expect(Array.from(hostFooter.querySelectorAll('button'))).toEqual([
            closeButton,
            hostButton,
        ]);

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));

        expect(screen.getByTestId('address-input')).toBeVisible();
        expect(screen.getByTestId('confirm-join')).toBeVisible();

        const joinFooter = screen.getByTestId('lobby-action-bar');
        const joinButton = screen.getByTestId('confirm-join');
        expect(joinButton.parentElement).toBe(joinFooter);
        expect(Array.from(joinFooter.querySelectorAll('button'))).toEqual([
            closeButton,
            joinButton,
        ]);
    });

    it('renders game-overridden lobby chrome and footer labels (token-driven)', () => {
        renderLobbyPage({
            'engine.lobby.title': 'Match Setup',
            'engine.lobby.hostLobby': 'Create Room',
            'engine.lobby.close': 'Back',
        });

        expect(screen.getByRole('dialog', { name: 'Match Setup' })).toBeTruthy();
        expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Match Setup');
        expect(screen.getByTestId('host-lobby').textContent).toBe('Create Room');
        expect(screen.getByTestId('lobby-close').textContent).toBe('Back');
    });

    it('closes the modal back to the main menu with game context preserved', () => {
        window.history.pushState({}, '', '/lobby?gameId=tactics');

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('lobby-close'));

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('closes to the main menu on Escape in entry mode, preserving game context', () => {
        window.history.pushState({}, '', '/lobby?gameId=tactics');

        renderLobbyPage();

        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('consumes Escape as a no-op during an active lobby session', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        // Leaving a live session stays an explicit Leave action — Escape must
        // neither navigate away nor leave the lobby.
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByTestId('active-lobby-panel')).toBeTruthy();
    });

    it('renders lobby page object locators during an active lobby', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        expect(screen.getByTestId('player-list')).toBeTruthy();
        expect(screen.getByTestId('start-game')).toBeTruthy();
    });

    it('does not render GameShell in lobby', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        expect(screen.queryByTestId('game-canvas')).toBeNull();
    });

    it('starts the match via the lobby API and does NOT navigate itself (GameStoreBootstrap owns lobby→game + its fade)', async () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Guest', ready: true },
            ],
        };

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('start-game'));

        await waitFor(() => {
            expect(mockStartGame).toHaveBeenCalledTimes(1);
        });
        // Navigation to /game (and ?gameId= preservation) is owned by
        // GameStoreBootstrap when the snapshot lands. The lobby pushing too would
        // race that fade and cancel it — so it must NOT navigate here.
        expect(mockPush).not.toHaveBeenCalledWith('/game');
        expect(mockPush).not.toHaveBeenCalledWith('/game?gameId=tactics');
    });

    it('renders the active lobby with separated info and player sections and a grouped action bar', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Guest', ready: true },
            ],
        };

        renderLobbyPage();

        expect(screen.queryByRole('heading', { level: 1, name: 'Multiplayer Lobby' })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Multiplayer Lobby' })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Host' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Join' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Current Lobby' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Lobby Information' })).toBeNull();

        expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Multiplayer Lobby');

        const mainText = screen.getByRole('main').textContent ?? '';
        expect(mainText.includes('Session ID:')).toBe(true);
        expect(mainText.includes('Host ID:')).toBe(true);
        expect(mainText.includes('Game:')).toBe(true);

        const infoSection = screen.getByTestId('lobby-session-id').closest('div');
        const playerSection = screen.getByTestId('player-list').closest('div');

        expect(infoSection).not.toBeNull();
        expect(playerSection).not.toBeNull();
        expect(infoSection).not.toBe(playerSection);

        const startButton = screen.getByTestId('start-game');
        const leaveButton = screen.getByTestId('lobby-leave-btn');
        const actionBar = startButton.parentElement;

        expect(actionBar).toBe(leaveButton.parentElement);
        expect(actionBar).toBe(screen.getByTestId('lobby-action-bar'));

        expect(leaveButton).toHaveAttribute('aria-describedby', 'leave-warning');
        expect(document.getElementById('leave-warning')).toBeTruthy();

        const actionButtons = Array.from(actionBar?.querySelectorAll('button') ?? []);

        expect(actionButtons).toHaveLength(2);
        expect(actionButtons[0]).toBe(leaveButton);
        expect(actionButtons[1]).toBe(startButton);

        // Leave/Start are Modal footer actions — small and right-aligned like
        // every other modal's buttons, rendered OUTSIDE the lobby panel body.
        expect(leaveButton).toHaveAttribute('data-ch-button-size', 'sm');
        expect(startButton).toHaveAttribute('data-ch-button-size', 'sm');
        expect(screen.getByTestId('active-lobby-panel')).not.toContainElement(actionBar);
    });

    it('offers a copy affordance for the session ID in the engine-default panel', () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });

        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        const copyButton = screen.getByTestId('lobby-session-copy');
        expect(copyButton).toHaveAccessibleName('Copy session ID');
        expect(copyButton.querySelector('svg[data-ch-icon="copy"]')).not.toBeNull();
        // Borderless (ghost) affordance — a chrome-less icon button.
        expect(copyButton).toHaveAttribute('data-ch-icon-button-variant', 'ghost');

        fireEvent.click(copyButton);
        expect(writeText).toHaveBeenCalledWith('session-1');

        Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('uses a quiet dialog surface without heading metadata badges', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: true }],
        };

        renderLobbyPage();

        const dialog = screen.getByRole('dialog', { name: 'Multiplayer Lobby' });
        expect(dialog).toHaveAttribute('data-testid', 'lobby-dialog');
        // The shared Modal traps focus, so aria-modal is consistent with
        // keyboard behaviour (resolves the old WARN-2 rationale for omitting it).
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('data-ch-modal-size', 'xl');
        expect(screen.queryByText('Game tactics')).toBeNull();
        expect(screen.queryByText('Max 4')).toBeNull();
        expect(screen.queryByText('Connected')).toBeNull();
    });

    it('uses shared themed variants for lobby shell actions', () => {
        renderLobbyPage();

        expect(screen.getByTestId('host-lobby')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));

        expect(screen.getByTestId('confirm-join')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );

        cleanup();

        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: true }],
        };

        renderLobbyPage();

        expect(screen.getByTestId('lobby-leave-btn')).toHaveAttribute(
            'data-ch-button-variant',
            'danger',
        );
        expect(screen.getByTestId('start-game')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );
    });

    it('pads the dialog with the standard container spacing token (via the shared Modal)', () => {
        // The dialog surface is the shared chrome-less Modal; the page module
        // paints no panel of its own.
        const dialogRule = /\.dialog\s*\{[^}]*\}/s.exec(modalCss)?.[0] ?? '';

        expect(dialogRule).toContain('padding: var(--ch-space-lg)');
        expect(pageCss).not.toContain('background-color: var(--ch-color-surface-raised)');
    });

    it('constrains the host/join entry fields to half the panel width (F56)', () => {
        const fieldRule = /\.entry-field\s*\{[^}]*\}/s.exec(pageCss)?.[0] ?? '';

        expect(fieldRule).toContain('inline-size: 50%');
    });

    it('uses shared Typography primitives for shell copy', () => {
        renderLobbyPage();

        // Caption heading removed — no h1 with lobby title should appear.
        expect(screen.queryByRole('heading', { level: 1, name: 'Multiplayer Lobby' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));

        expect(screen.getByLabelText('Lobby Code:')).toHaveAttribute(
            'data-testid',
            'address-input',
        );
    });

    it('sets stubbed local seat ids after successful host', async () => {
        const host = vi.fn(async () => ({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' }));

        Object.defineProperty(window, '__chimera', {
            value: {
                lobby: {
                    host,
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p2'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: {
                    onConnectionStatus: vi.fn(() => () => undefined),
                },
            },
            configurable: true,
        });

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('host-lobby'));

        await waitFor(() => {
            expect(host).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        });
    });
});

describe('Start Game button enable/disable', () => {
    beforeEach(() => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: false },
                { playerId: 'p2', displayName: 'Client', ready: false },
            ],
        };
        mockLocalSeatIds = [];

        Object.defineProperty(window, '__chimera', {
            value: {
                lobby: {
                    host: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p1'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: {
                    onConnectionStatus: vi.fn(() => () => undefined),
                },
            },
            configurable: true,
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('is disabled when local player is not the host (client window)', () => {
        mockLocalPlayerId = 'p2'; // client, not host
        renderLobbyPage();
        expect(screen.getByTestId('start-game').hasAttribute('disabled')).toBe(true);
    });

    it('is disabled when local player is host but not all players are ready', () => {
        mockLocalPlayerId = 'p1'; // host, but players not ready
        renderLobbyPage();
        expect(screen.getByTestId('start-game').hasAttribute('disabled')).toBe(true);
    });

    it('is enabled when local player is host and all players are ready', () => {
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Client', ready: true },
            ],
        };
        renderLobbyPage();
        expect(screen.getByTestId('start-game').hasAttribute('disabled')).toBe(false);
    });

    it('becomes disabled again when any player toggles back to unready', () => {
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Client', ready: true },
            ],
        };
        const { rerender } = renderLobbyPage();
        expect(screen.getByTestId('start-game').hasAttribute('disabled')).toBe(false);

        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Client', ready: false },
            ],
        };
        rerender(renderLobbyPageElement());
        expect(screen.getByTestId('start-game').hasAttribute('disabled')).toBe(true);
    });
});

describe('LobbyPage chat panel', () => {
    beforeEach(() => {
        mockLocalSeatIds = [];
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };
        mockPush.mockReset();

        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p1'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: { onConnectionStatus: vi.fn(() => () => undefined) },
                game: { sendAction: vi.fn() },
            },
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        delete (window as unknown as { __chimera?: unknown }).__chimera;
    });

    // Chat is an in-match-only UI: the lobby page must not mount ChatPanel
    // (in any state), even while a live lobby session exists.
    it('does not mount the chat panel during an active lobby', () => {
        renderLobbyPage();

        // The active-lobby branch rendered…
        expect(screen.getByTestId('lobby-dialog')).toBeTruthy();
        expect(screen.getByTestId('start-game')).toBeTruthy();
        // …without any chat surface.
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(screen.queryByTestId('chat-unavailable')).toBeNull();
        expect(screen.queryByTestId('chat-body-input')).toBeNull();
    });

    it('does not mount the chat panel before a lobby is joined', () => {
        mockLobbyState = null;
        mockLocalPlayerId = null;

        renderLobbyPage();

        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(screen.queryByTestId('chat-unavailable')).toBeNull();
    });
});

describe('LobbyPage password (F56)', () => {
    let hostFn: ReturnType<typeof vi.fn>;
    let joinFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockLocalSeatIds = [];
        mockLocalPlayerId = null;
        mockLobbyState = null;
        mockPush.mockReset();

        hostFn = vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' }));
        joinFn = vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' }));

        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: hostFn,
                    join: joinFn,
                    getLocalPlayerId: vi.fn(async () => 'p2'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: { onConnectionStatus: vi.fn(() => () => undefined) },
            },
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        delete (window as unknown as { __chimera?: unknown }).__chimera;
    });

    it('renders a password field on the Host tab instead of the Game/Seats panel', () => {
        renderLobbyPage();

        expect(screen.getByTestId('host-password-input')).toBeVisible();
        // The old Game/Seats definition list is gone.
        expect(screen.queryByText('Seats')).toBeNull();
        expect(screen.queryByText('Game')).toBeNull();
    });

    it('renders a password field on the Join tab', () => {
        renderLobbyPage();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));

        expect(screen.getByTestId('join-password-input')).toBeVisible();
    });

    it('forwards a trimmed host password when one is entered', async () => {
        renderLobbyPage();

        fireEvent.change(screen.getByTestId('host-password-input'), {
            target: { value: '  hunter2  ' },
        });
        fireEvent.click(screen.getByTestId('host-lobby'));

        await waitFor(() => {
            expect(hostFn).toHaveBeenCalledWith({
                gameId: 'tactics',
                maxPlayers: 4,
                password: 'hunter2',
            });
        });
    });

    it('omits the password when the host field is left blank', async () => {
        renderLobbyPage();

        fireEvent.click(screen.getByTestId('host-lobby'));

        await waitFor(() => {
            expect(hostFn).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        });
    });

    it('forwards a trimmed join password when one is entered', async () => {
        renderLobbyPage();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));
        fireEvent.change(screen.getByTestId('address-input'), {
            target: { value: '127.0.0.1:7777:tok' },
        });
        fireEvent.change(screen.getByTestId('join-password-input'), {
            target: { value: ' s3cret ' },
        });
        fireEvent.click(screen.getByTestId('confirm-join'));

        await waitFor(() => {
            expect(joinFn).toHaveBeenCalledWith({
                address: '127.0.0.1:7777:tok',
                password: 's3cret',
            });
        });
    });

    it('marks the join password field invalid on rejection without any message text', async () => {
        joinFn.mockRejectedValueOnce(
            new Error("Error invoking remote method 'chimera:lobby:join': Error: invalid_password"),
        );
        renderLobbyPage();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));
        fireEvent.change(screen.getByTestId('address-input'), {
            target: { value: '127.0.0.1:7777:tok' },
        });
        fireEvent.click(screen.getByTestId('confirm-join'));

        const passwordInput = screen.getByTestId('join-password-input');
        await waitFor(() => {
            expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
        });
        // The red invalid state is the only cue — no message text, no top banner.
        expect(screen.queryByText('Incorrect password.')).toBeNull();
        expect(screen.queryByTestId('lobby-error')).toBeNull();
    });

    it('clears the invalid state once the field is edited', async () => {
        joinFn.mockRejectedValueOnce(
            new Error("Error invoking remote method 'chimera:lobby:join': Error: invalid_password"),
        );
        renderLobbyPage();

        fireEvent.click(screen.getByRole('tab', { name: 'Join' }));
        fireEvent.change(screen.getByTestId('address-input'), {
            target: { value: '127.0.0.1:7777:tok' },
        });
        fireEvent.click(screen.getByTestId('confirm-join'));

        const passwordInput = screen.getByTestId('join-password-input');
        await waitFor(() => {
            expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
        });

        fireEvent.change(passwordInput, { target: { value: 'retry' } });

        expect(passwordInput).not.toHaveAttribute('aria-invalid');
    });
});

describe('LobbyPage game-provided lobby screen', () => {
    let setMatchSetting: ReturnType<typeof vi.fn>;
    let setPlayerAttribute: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockLocalSeatIds = [];
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Guest', ready: true },
            ],
        };
        mockLobbyShell = { LobbyScreen: StubLobbyScreen };
        mockPush.mockReset();

        // A game-provided screen renders only in that game's explicit shell
        // context — the URL must carry ?gameId= (no default-game fallback).
        window.history.pushState({}, '', '/lobby?gameId=tactics');

        setMatchSetting = vi.fn(async () => undefined);
        setPlayerAttribute = vi.fn(async () => undefined);

        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: {
                lobby: {
                    host: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'p1', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p1'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
                    updatePlayerReadyState: vi.fn(async () => undefined),
                    setMatchSetting,
                    setPlayerAttribute,
                },
                system: { onConnectionStatus: vi.fn(() => () => undefined) },
            },
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        mockLobbyShell = {};
        delete (window as unknown as { __chimera?: unknown }).__chimera;
    });

    it('renders the game-provided LobbyScreen instead of the engine default', async () => {
        renderLobbyPage();

        expect(await screen.findByTestId('stub-lobby-screen')).toBeTruthy();
        expect(screen.queryByTestId('active-lobby-panel')).toBeNull();
    });

    it('renders the engine Leave/Start modal footer alongside the game-provided screen', async () => {
        renderLobbyPage();

        expect(await screen.findByTestId('stub-lobby-screen')).toBeTruthy();

        const actionBar = screen.getByTestId('lobby-action-bar');
        const labels = Array.from(actionBar.querySelectorAll('button')).map(
            (button) => button.textContent,
        );
        expect(labels).toEqual(['Leave Lobby', 'Start Game']);
    });

    it('falls back to the engine-default ActiveLobbyPanel when no LobbyScreen is provided', async () => {
        mockLobbyShell = {};

        renderLobbyPage();

        expect(await screen.findByTestId('active-lobby-panel')).toBeTruthy();
        expect(screen.queryByTestId('stub-lobby-screen')).toBeNull();
    });

    it('keeps the engine-default panel on a bare URL — no game context to brand from', async () => {
        // The registry would deliver a LobbyScreen, but game context arrives ONLY
        // as an external `?gameId=`; the engine derives none. With no context the
        // lobby stays engine-default rather than guessing a game.
        window.history.pushState({}, '', '/lobby');

        renderLobbyPage();

        expect(await screen.findByTestId('active-lobby-panel')).toBeTruthy();
        expect(screen.queryByTestId('stub-lobby-screen')).toBeNull();
    });

    it('disables hosting with no game context — the engine picks no game', async () => {
        window.history.pushState({}, '', '/lobby');
        mockLobbyState = null;

        renderLobbyPage();

        expect(await screen.findByTestId('host-lobby')).toBeDisabled();
    });

    it('keeps the engine-default panel when the explicit gameId does not match the lobby game', async () => {
        // Explicit context for a DIFFERENT game than the one the lobby hosts:
        // the mismatched shell must not brand this lobby.
        window.history.pushState({}, '', '/lobby?gameId=other-game');

        renderLobbyPage();

        expect(await screen.findByTestId('active-lobby-panel')).toBeTruthy();
        expect(screen.queryByTestId('stub-lobby-screen')).toBeNull();
    });

    it('forwards host-authored board and owner-authored colour edits to the lobby IPC', async () => {
        renderLobbyPage(); // local player is the host (p1)

        fireEvent.click(await screen.findByTestId('stub-edit-board'));
        fireEvent.click(screen.getByTestId('stub-edit-color'));

        await waitFor(() => {
            expect(setMatchSetting).toHaveBeenCalledWith('boardColor', 'amber');
            expect(setPlayerAttribute).toHaveBeenCalledWith(playerId('p1'), 'color', 'blue');
        });
    });

    it('lets a non-host client forward its own colour edit but not the host-only board', async () => {
        mockLocalPlayerId = 'p2'; // host is p1

        renderLobbyPage();

        // Board colour is host-only → read-only for the client.
        expect(await screen.findByTestId('stub-readonly')).toBeTruthy();
        expect(screen.queryByTestId('stub-edit-board')).toBeNull();

        // Own colour is owner-authored → the client can still author it.
        fireEvent.click(screen.getByTestId('stub-edit-color'));
        await waitFor(() => {
            expect(setPlayerAttribute).toHaveBeenCalledWith(playerId('p2'), 'color', 'blue');
        });
    });
});
