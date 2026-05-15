// renderer/app/lobby/page.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme/ThemeProvider';
import LobbyPage from './page';

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
                    startMatch: vi.fn(async () => undefined),
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

    it('disables join while hosting is in progress', async () => {
        renderLobbyPage();

        const hostButton = screen.getByTestId('host-lobby');
        const joinButton = screen.getByTestId('confirm-join');

        fireEvent.click(hostButton);

        await waitFor(() => {
            expect(screen.getByText('Hosting...')).toBeTruthy();
            expect(joinButton.hasAttribute('disabled')).toBe(true);
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
        expect(screen.getByTestId('confirm-join')).toBeTruthy();
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
        expect(screen.getByTestId('start-match')).toBeTruthy();
    });

    it('still renders lobby heading when a snapshot is active (no GameShell in lobby)', () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        // Lobby heading must remain; GameShell must NOT be rendered.
        expect(screen.getByRole('heading', { level: 1, name: 'Multiplayer Lobby' })).toBeTruthy();
        expect(screen.queryByTestId('match-canvas')).toBeNull();
    });

    it('calls router.push("/match") after handleStartMatch succeeds', async () => {
        mockLocalPlayerId = 'p1';
        mockLobbyState = {
            info: { sessionId: 'session-1', hostId: 'p1', gameId: 'tactics' },
            players: [
                { playerId: 'p1', displayName: 'Host', ready: true },
                { playerId: 'p2', displayName: 'Guest', ready: true },
            ],
        };

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('start-match'));

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/match');
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

        expect(screen.getByRole('heading', { level: 1, name: 'Multiplayer Lobby' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Current Lobby' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Lobby Information' })).toBeNull();

        expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby', 'lobby-heading');

        const mainText = screen.getByRole('main').textContent ?? '';
        expect(mainText.includes('Session ID:')).toBe(true);
        expect(mainText.includes('Host ID:')).toBe(true);
        expect(mainText.includes('Game:')).toBe(false);

        const infoSection = screen.getByTestId('lobby-session-id').closest('div');
        const playerSection = screen.getByTestId('player-list').closest('div');

        expect(infoSection).not.toBeNull();
        expect(playerSection).not.toBeNull();
        expect(infoSection).not.toBe(playerSection);

        const startButton = screen.getByTestId('start-match');
        const leaveButton = screen.getByTestId('lobby-leave-btn');
        const actionBar = startButton.parentElement;

        expect(actionBar).toBe(leaveButton.parentElement);
        expect(actionBar).toHaveStyle({ display: 'flex', justifyContent: 'space-between' });

        expect(leaveButton).toHaveAttribute('aria-describedby', 'leave-warning');
        expect(document.getElementById('leave-warning')).toBeTruthy();

        const actionButtons = Array.from(actionBar?.querySelectorAll('button') ?? []);

        expect(actionButtons).toHaveLength(2);
        expect(actionButtons[0]).toBe(leaveButton);
        expect(actionButtons[1]).toBe(startButton);
    });

    it('uses readable token colors for the active lobby shell and information surfaces', () => {
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

        expect(screen.getByRole('main')).toHaveStyle({
            backgroundColor: 'var(--ch-color-surface)',
            color: 'var(--ch-color-text-primary)',
            minHeight: '100vh',
        });

        const configSummary = screen.getByTestId('lobby-config-summary');
        expect(configSummary).toHaveStyle({
            backgroundColor: 'var(--ch-color-surface-raised)',
            color: 'var(--ch-color-text-primary)',
        });

        const infoSection = screen.getByTestId('lobby-session-id').closest('div');
        expect(infoSection).not.toBeNull();
        expect(infoSection).toHaveStyle({
            backgroundColor: 'var(--ch-color-surface-raised)',
            color: 'var(--ch-color-text-primary)',
        });
    });

    it('uses shared themed variants for lobby shell actions', () => {
        renderLobbyPage();

        expect(screen.getByTestId('host-lobby')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
        );
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
        expect(screen.getByTestId('start-match')).toHaveAttribute(
            'data-ch-button-variant',
            'primary',
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
                    startMatch: vi.fn(async () => undefined),
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

describe('Start Match button enable/disable', () => {
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
                    startMatch: vi.fn(async () => undefined),
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
        expect(screen.getByTestId('start-match').hasAttribute('disabled')).toBe(true);
    });

    it('is disabled when local player is host but not all players are ready', () => {
        mockLocalPlayerId = 'p1'; // host, but players not ready
        renderLobbyPage();
        expect(screen.getByTestId('start-match').hasAttribute('disabled')).toBe(true);
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
        expect(screen.getByTestId('start-match').hasAttribute('disabled')).toBe(false);
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
        expect(screen.getByTestId('start-match').hasAttribute('disabled')).toBe(false);

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
        expect(screen.getByTestId('start-match').hasAttribute('disabled')).toBe(true);
    });
});
