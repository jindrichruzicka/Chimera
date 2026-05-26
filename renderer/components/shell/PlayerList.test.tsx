// renderer/components/shell/PlayerList.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerList } from './PlayerList';

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

let mockLobbyState: MockLobbyStoreState['lobbyState'] = null;

function getPlayerRow(playerId: string): HTMLElement {
    const row = screen
        .getAllByTestId('player-list-item')
        .find((element) => element.getAttribute('data-player-id') === playerId);

    if (row === undefined) {
        throw new Error(`Missing player row for ${playerId}`);
    }

    return row;
}

vi.mock('../../state/lobbyStore', () => {
    return {
        useLobbyStore: <TSelected,>(selector: (state: MockLobbyStoreState) => TSelected) =>
            selector({ lobbyState: mockLobbyState }),
    };
});

describe('PlayerList', () => {
    beforeEach(() => {
        mockLobbyState = null;
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders empty container when lobbyState is null', () => {
        mockLobbyState = null;
        render(<PlayerList />);

        const container = screen.getByTestId('player-list');
        expect(container).toBeTruthy();

        const heading = screen.getByText(/Players \(0\)/);
        expect(heading).toBeTruthy();
    });

    it('renders one row per player in the roster with the page object test id', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
                { playerId: 'player-3', displayName: 'Charlie', ready: true },
            ],
        };

        render(<PlayerList />);

        // Verify heading shows correct count
        expect(screen.getByText(/Players \(3\)/)).toBeTruthy();

        const rows = screen.getAllByTestId('player-list-item');
        expect(rows.length).toBe(3);
        expect(getPlayerRow('player-1')).toBeTruthy();
        expect(getPlayerRow('player-2')).toBeTruthy();
        expect(getPlayerRow('player-3')).toBeTruthy();

        // Verify player names are displayed (use matcher for split text)
        expect(screen.getByText(/Alice/)).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getByText('Charlie')).toBeTruthy();
    });

    it('renders distinct badge variants for ready and not-ready states', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList />);

        // Get the row containers
        const aliceRow = getPlayerRow('player-1');
        const bobRow = getPlayerRow('player-2');

        // Verify ready state labels are rendered
        expect(aliceRow.textContent).toContain('Ready');
        expect(bobRow.textContent).toContain('Not Ready');

        const readyBadge = Array.from(aliceRow.querySelectorAll('span')).find(
            (span) => span.textContent === 'Ready',
        )!;
        const notReadyBadge = Array.from(bobRow.querySelectorAll('span')).find(
            (span) => span.textContent === 'Not Ready',
        )!;

        expect(readyBadge).toHaveAttribute('data-ch-badge-variant', 'success');
        expect(notReadyBadge).toHaveAttribute('data-ch-badge-variant', 'warning');
    });

    it('exposes each player ready state on the row data-ready attribute', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList />);

        expect(getPlayerRow('player-1').getAttribute('data-ready')).toBe('true');
        expect(getPlayerRow('player-2').getAttribute('data-ready')).toBe('false');
    });

    it('shows (You) indicator and toggle button only for local player', () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={onToggleReady} />);

        // Alice (local player) should have (You) indicator
        const aliceRow = getPlayerRow('player-1');
        expect(aliceRow.textContent).toContain('(You)');

        // Bob should NOT have (You) indicator
        const bobRow = getPlayerRow('player-2');
        expect(bobRow.textContent).not.toContain('(You)');

        // Alice should have a Toggle Ready button
        const aliceToggleButton = Array.from(aliceRow.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Toggle Ready',
        );
        expect(aliceToggleButton).toBeTruthy();

        // Bob should NOT have a Toggle Ready button
        const bobToggleButton = Array.from(bobRow.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Toggle Ready',
        );
        expect(bobToggleButton).toBeFalsy();
    });

    it('invokes onToggleReady callback with inverted ready value when local player clicks toggle', async () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={onToggleReady} />);

        const aliceRow = getPlayerRow('player-1');
        const toggleButton = aliceRow.querySelector('button');

        expect(toggleButton).toBeTruthy();
        fireEvent.click(toggleButton!);

        expect(onToggleReady).toHaveBeenCalledOnce();
        expect(onToggleReady).toHaveBeenCalledWith(false); // Alice is ready, so toggle to false
    });

    it('invokes callback with false when clicking toggle for a ready player', async () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: true }],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={onToggleReady} />);

        const toggleButton = screen.getByText('Toggle Ready');
        fireEvent.click(toggleButton);

        expect(onToggleReady).toHaveBeenCalledWith(false);
    });

    it('invokes callback with true when clicking toggle for a not-ready player', async () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: false }],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={onToggleReady} />);

        const toggleButton = screen.getByText('Toggle Ready');
        fireEvent.click(toggleButton);

        expect(onToggleReady).toHaveBeenCalledWith(true);
    });

    it('updates rendered list when lobbyState changes', async () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: false }],
        };

        const { rerender } = render(<PlayerList />);

        // Initial state: 1 player, not ready
        expect(screen.getByText(/Players \(1\)/)).toBeTruthy();
        expect(getPlayerRow('player-1')).toBeTruthy();
        expect(screen.getByText(/Alice/)).toBeTruthy();
        expect(screen.getByText('Not Ready')).toBeTruthy();

        // Update lobbyState to add a player and change ready state
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        rerender(<PlayerList />);

        // Verify updates
        expect(screen.getByText(/Players \(2\)/)).toBeTruthy();
        expect(getPlayerRow('player-2')).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();

        // Verify Alice's ready state changed
        const aliceReadyBadges = Array.from(screen.getAllByText('Ready')).filter((el) =>
            el.closest('[data-testid="player-list-item"][data-player-id="player-1"]'),
        );
        expect(aliceReadyBadges.length).toBeGreaterThan(0);
    });

    it('removes player row when roster is updated to exclude that player', async () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        const { rerender } = render(<PlayerList />);

        expect(getPlayerRow('player-1')).toBeTruthy();
        expect(getPlayerRow('player-2')).toBeTruthy();

        // Remove Bob from the roster
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: true }],
        };

        rerender(<PlayerList />);

        expect(getPlayerRow('player-1')).toBeTruthy();
        expect(() => getPlayerRow('player-2')).toThrow();
        expect(screen.getByText(/Players \(1\)/)).toBeTruthy();
    });

    it('supports a non-host joiner as the local player with explicit localPlayerId prop', () => {
        const onToggleReady = vi.fn();

        // Scenario: Alice is host (player-1), but Bob (player-2) is the local player
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: false },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList localPlayerId="player-2" onToggleReady={onToggleReady} />);

        // Bob's row should have (You) indicator and toggle button
        const bobRow = getPlayerRow('player-2');
        expect(bobRow.textContent).toContain('(You)');

        const bobToggleButton = Array.from(bobRow.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Toggle Ready',
        );
        expect(bobToggleButton).toBeTruthy();

        // Alice's row should NOT have (You) indicator or toggle button
        const aliceRow = getPlayerRow('player-1');
        expect(aliceRow.textContent).not.toContain('(You)');

        const aliceToggleButton = Array.from(aliceRow.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Toggle Ready',
        );
        expect(aliceToggleButton).toBeFalsy();

        // Verify Bob can toggle ready
        fireEvent.click(bobToggleButton!);
        expect(onToggleReady).toHaveBeenCalledWith(true);
    });

    it('shows no local player when localPlayerId is not provided or null', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        render(<PlayerList localPlayerId={null} />);

        // Neither player should have (You) indicator
        const aliceRow = getPlayerRow('player-1');
        const bobRow = getPlayerRow('player-2');

        expect(aliceRow.textContent).not.toContain('(You)');
        expect(bobRow.textContent).not.toContain('(You)');

        // Neither should have toggle buttons
        const buttons = screen.queryAllByText('Toggle Ready');
        expect(buttons.length).toBe(0);
    });

    it('maintains correct local player indicator when roster updates', () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
            ],
        };

        const { rerender } = render(
            <PlayerList localPlayerId="player-2" onToggleReady={onToggleReady} />,
        );

        // Initial: Bob is local
        expect(getPlayerRow('player-2').textContent).toContain('(You)');

        // A third player joins
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: false },
                { playerId: 'player-3', displayName: 'Charlie', ready: true },
            ],
        };

        rerender(<PlayerList localPlayerId="player-2" onToggleReady={onToggleReady} />);

        // Bob should still be marked as local
        expect(getPlayerRow('player-2').textContent).toContain('(You)');
        expect(getPlayerRow('player-1').textContent).not.toContain('(You)');
        expect(getPlayerRow('player-3').textContent).not.toContain('(You)');
    });
});
