// renderer/app/lobby/page.write-lock.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EscapeStackProvider } from '../../components/shell/EscapeStack';
import { ThemeProvider } from '../../theme/ThemeProvider';
import LobbyPage from './page';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

// The lobby page resolves the active game's shell via the registry; stub it with
// an empty shell so these write-lock tests exercise the engine-default panel and
// never trigger a real `games/*` dynamic import.
vi.mock('../../game/rendererGameRegistry', () => ({
    getDefaultRendererGameId: () => 'tactics',
    loadRendererGameShell: () => Promise.resolve({}),
}));

const host = vi.fn(async () => ({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' }));
const join = vi.fn(async () => ({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' }));
const leave = vi.fn(async () => undefined);
const startGame = vi.fn(async () => undefined);
const updatePlayerReadyState = vi.fn(async () => undefined);

let mockLobbyState: {
    info: { sessionId: string; hostId: string; gameId: string };
    players: readonly { playerId: string; displayName: string; ready: boolean }[];
} | null = null;

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: Object.assign(
        (
            selector: (state: {
                lobbyState: {
                    info: { sessionId: string; hostId: string; gameId: string };
                    players: readonly { playerId: string; displayName: string; ready: boolean }[];
                } | null;
            }) => unknown,
        ) =>
            selector({
                lobbyState: mockLobbyState,
            }),
        {
            getState: () => {
                throw new Error('Direct lobbyStore.getState() write is forbidden in LobbyPage');
            },
        },
    ),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: (
        selector: (state: {
            localPlayerId: string | null;
            localSeatIds: readonly string[];
        }) => unknown,
    ) =>
        selector({
            localPlayerId: 'p1',
            localSeatIds: ['p1', 'p2'],
        }),
}));

vi.mock('../../state/lobbyStoreBootstrap', () => ({
    bootstrapLobbyStore: vi.fn(() => () => undefined),
}));

vi.mock('./useLobbyApi', () => ({
    getLobbyBridge: vi.fn(() => ({
        lobby: { onUpdate: vi.fn() },
        system: { onConnectionStatus: vi.fn() },
    })),
    useLobbyApi: () => ({
        host,
        join,
        leave,
        startGame,
        updatePlayerReadyState,
    }),
}));

// The page renders through the shared Modal, whose Escape handling registers on
// the overlay stack — every render must sit inside an EscapeStackProvider.
function renderLobbyPage(): ReturnType<typeof render> {
    return render(renderLobbyPageElement());
}

function renderLobbyPageElement(): React.ReactElement {
    return (
        <EscapeStackProvider>
            <ThemeProvider>
                <LobbyPage />
            </ThemeProvider>
        </EscapeStackProvider>
    );
}

describe('LobbyPage write lock', () => {
    beforeEach(() => {
        mockLobbyState = null;
        host.mockReset();
        join.mockReset();
        leave.mockReset();
        startGame.mockReset();
        updatePlayerReadyState.mockReset();

        host.mockResolvedValue({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' });
        join.mockResolvedValue({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' });
        leave.mockResolvedValue(undefined);
        startGame.mockResolvedValue(undefined);
        updatePlayerReadyState.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('dispatches host and leave through useLobbyApi without direct store writes', async () => {
        const rendered = renderLobbyPage();

        fireEvent.click(screen.getByTestId('host-lobby'));
        await waitFor(() => {
            expect(host).toHaveBeenCalledOnce();
        });

        mockLobbyState = {
            info: {
                sessionId: 's1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };
        rendered.rerender(renderLobbyPageElement());

        fireEvent.click(screen.getByTestId('lobby-leave-btn'));
        await waitFor(() => {
            expect(leave).toHaveBeenCalledOnce();
        });
    });

    it('dispatches ready-state update through useLobbyApi', async () => {
        mockLobbyState = {
            info: {
                sessionId: 's1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('ready-toggle'));

        await waitFor(() => {
            expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
        });
    });

    it('dispatches start-game through useLobbyApi without direct store writes', async () => {
        mockLobbyState = {
            info: {
                sessionId: 's1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: true }],
        };

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('start-game'));

        await waitFor(() => {
            expect(startGame).toHaveBeenCalledOnce();
        });
    });

    it('shows a visible error when ready-state update fails', async () => {
        updatePlayerReadyState.mockRejectedValueOnce(new Error('ready failed'));
        mockLobbyState = {
            info: {
                sessionId: 's1',
                hostId: 'p1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'p1', displayName: 'Host', ready: false }],
        };

        renderLobbyPage();

        fireEvent.click(screen.getByTestId('ready-toggle'));

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('ready failed');
        });
    });
});
