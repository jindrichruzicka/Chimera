// renderer/app/lobby/page.write-lock.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LobbyPage from './page';

const host = vi.fn(async () => ({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' }));
const join = vi.fn(async () => ({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' }));
const leave = vi.fn(async () => undefined);
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
            localSeatIds: ['p1', 'p1-local-seat-2'],
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
        updatePlayerReadyState,
    }),
}));

describe('LobbyPage write lock', () => {
    beforeEach(() => {
        mockLobbyState = null;
        host.mockReset();
        join.mockReset();
        leave.mockReset();
        updatePlayerReadyState.mockReset();

        host.mockResolvedValue({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' });
        join.mockResolvedValue({ sessionId: 's1', hostId: 'p1', gameId: 'tactics' });
        leave.mockResolvedValue(undefined);
        updatePlayerReadyState.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('dispatches host and leave through useLobbyApi without direct store writes', async () => {
        const rendered = render(<LobbyPage />);

        fireEvent.click(screen.getByTestId('lobby-host-btn'));
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
        rendered.rerender(<LobbyPage />);

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

        render(<LobbyPage />);

        fireEvent.click(screen.getByText('Toggle Ready'));

        await waitFor(() => {
            expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
        });
    });
});
