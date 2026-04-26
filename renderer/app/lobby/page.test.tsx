// renderer/app/lobby/page.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LobbyPage from './page';

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

describe('LobbyPage pending actions', () => {
    let hostDeferred: DeferredPromise;

    beforeEach(() => {
        hostDeferred = createDeferredPromise();
        mockLocalSeatIds = [];
        mockLocalPlayerId = null;
        mockLobbyState = null;

        Object.defineProperty(window, '__chimera', {
            value: {
                lobby: {
                    host: vi.fn(() => hostDeferred.promise),
                    join: vi.fn(async () => ({ sessionId: 's', hostId: 'h', gameId: 'tactics' })),
                    getLocalPlayerId: vi.fn(async () => 'p2'),
                    leave: vi.fn(async () => undefined),
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

    it('disables join while hosting is in progress', async () => {
        render(<LobbyPage />);

        const hostButton = screen.getByTestId('lobby-host-btn');
        const joinButton = screen.getByTestId('lobby-join-btn');

        fireEvent.click(hostButton);

        await waitFor(() => {
            expect(screen.getByText('Hosting...')).toBeTruthy();
            expect(joinButton.hasAttribute('disabled')).toBe(true);
        });

        hostDeferred.resolve();
    });

    it('does not update state after unmount while host request is still pending', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const rendered = render(<LobbyPage />);
        const hostButton = screen.getByTestId('lobby-host-btn');

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

    it('does not render SeatSwitcher outside an active session', () => {
        mockLocalSeatIds = ['p1', 'p2'];
        mockLobbyState = null;

        render(<LobbyPage />);

        expect(screen.queryByTestId('seat-switcher')).toBeNull();
    });

    it('renders SeatSwitcher when session exists and there is more than one local seat', () => {
        mockLocalSeatIds = ['p1', 'p2'];
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        render(<LobbyPage />);

        expect(screen.getByTestId('seat-switcher')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-p1')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-p2')).toBeTruthy();
    });

    it('does not render SeatSwitcher when there is only one local seat', () => {
        mockLocalSeatIds = ['p1'];

        render(<LobbyPage />);

        expect(screen.queryByTestId('seat-switcher')).toBeNull();
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
                    updatePlayerReadyState: vi.fn(async () => undefined),
                },
                system: {
                    onConnectionStatus: vi.fn(() => () => undefined),
                },
            },
            configurable: true,
        });

        render(<LobbyPage />);

        fireEvent.click(screen.getByTestId('lobby-host-btn'));

        await waitFor(() => {
            expect(host).toHaveBeenCalledWith({ gameId: 'tactics', maxPlayers: 4 });
        });
    });
});
