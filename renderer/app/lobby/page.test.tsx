// renderer/app/lobby/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameLobbyScreenProps } from '@chimera/shared/game-lobby-contract.js';
import { playerId } from '@chimera/electron/preload/api-types.js';
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
    setMatchSetting,
    setPlayerAttribute,
}: GameLobbyScreenProps): React.ReactElement {
    return (
        <div data-testid="stub-lobby-screen">
            {isHost ? (
                <>
                    <button
                        data-testid="stub-edit-board"
                        onClick={() => {
                            setMatchSetting('boardColor', 'amber');
                        }}
                        type="button"
                    >
                        Board colour
                    </button>
                    <button
                        data-testid="stub-edit-color"
                        onClick={() => {
                            setPlayerAttribute(playerId('p2'), 'color', 'blue');
                        }}
                        type="button"
                    >
                        Player colour
                    </button>
                </>
            ) : (
                <span data-testid="stub-readonly">read-only</span>
            )}
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

function renderLobbyPage(): ReturnType<typeof render> {
    return render(
        <ThemeProvider>
            <LobbyPage />
        </ThemeProvider>,
    );
}

describe('LobbyPage pending actions', () => {
    let hostDeferred: DeferredPromise;

    beforeEach(() => {
        hostDeferred = createDeferredPromise();
        mockLocalSeatIds = [];
        mockLocalPlayerId = null;
        mockLobbyState = null;
        mockPush.mockReset();

        Object.defineProperty(window, '__chimera', {
            value: {
                lobby: {
                    host: vi.fn(() => hostDeferred.promise),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p2'),
                    leave: vi.fn(async () => undefined),
                    startGame: vi.fn(async () => undefined),
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

    it('closes the modal back to the main menu with game context preserved', () => {
        window.history.pushState({}, '', '/lobby?gameId=tactics');

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('lobby-close'));

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
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

    it('calls router.push("/game") after handleStartGame succeeds', async () => {
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
            expect(mockPush).toHaveBeenCalledWith('/game');
        });
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
        // No aria-modal: focus is not trapped, so claiming virtual-browsing
        // restriction would be inconsistent with keyboard behavior (WARN-2).
        expect(dialog).not.toHaveAttribute('aria-modal');
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

    it('pads the dialog with the standard container spacing token', () => {
        const dialogRule = /\.dialog\s*\{[^}]*\}/s.exec(pageCss)?.[0] ?? '';

        expect(dialogRule).toContain('padding: var(--ch-space-lg)');
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
        rerender(
            <ThemeProvider>
                <LobbyPage />
            </ThemeProvider>,
        );
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

    it('falls back to the engine-default ActiveLobbyPanel when no LobbyScreen is provided', async () => {
        mockLobbyShell = {};

        renderLobbyPage();

        expect(await screen.findByTestId('active-lobby-panel')).toBeTruthy();
        expect(screen.queryByTestId('stub-lobby-screen')).toBeNull();
    });

    it('gives the host editable controls whose edits invoke the host-authority IPC', async () => {
        renderLobbyPage();

        fireEvent.click(await screen.findByTestId('stub-edit-board'));
        fireEvent.click(screen.getByTestId('stub-edit-color'));

        await waitFor(() => {
            expect(setMatchSetting).toHaveBeenCalledWith('boardColor', 'amber');
            expect(setPlayerAttribute).toHaveBeenCalledWith(playerId('p2'), 'color', 'blue');
        });
    });

    it('renders the screen read-only for a client (non-host)', async () => {
        mockLocalPlayerId = 'p2'; // host is p1

        renderLobbyPage();

        expect(await screen.findByTestId('stub-readonly')).toBeTruthy();
        expect(screen.queryByTestId('stub-edit-board')).toBeNull();
        expect(screen.queryByTestId('stub-edit-color')).toBeNull();
    });
});
