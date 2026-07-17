// renderer/components/shell/PlayerList.test.tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerList } from './PlayerList';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';

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

// PlayerList reads its heading and control strings through useTranslate(), which
// throws outside an I18nProvider. Mount it inert (engine English, en-US) for
// every render so the default-locale text assertions stay identical to the ship
// strings; a `gameOverride` bundle re-keys engine tokens to prove the strings
// are token-driven. Using the `wrapper` option keeps the provider in place
// across RTL `rerender` calls.
function render(
    ui: React.ReactElement,
    gameOverride?: TranslationBundle,
): ReturnType<typeof baseRender> {
    // Spread `gameOverride` only when supplied: I18nProviderProps declares it
    // optional and the tree compiles with exactOptionalPropertyTypes, so an
    // explicit `undefined` is rejected.
    const providerProps = gameOverride !== undefined ? { gameOverride } : {};
    return baseRender(ui, {
        wrapper: ({ children }: { children: React.ReactNode }) => (
            <I18nProvider {...providerProps}>{children}</I18nProvider>
        ),
    });
}

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

        // The ready badge leads with the shared check glyph; not-ready has none.
        expect(readyBadge.querySelector('svg[data-ch-icon="check"]')).not.toBeNull();
        expect(notReadyBadge.querySelector('svg[data-ch-icon="check"]')).toBeNull();
    });

    it('renders an avatar initial for every player row', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'bob', ready: false },
            ],
        };

        render(<PlayerList />);

        // Decorative initial derived from the display name, uppercased.
        const aliceAvatar = getPlayerRow('player-1').querySelector('[data-testid="player-avatar"]');
        const bobAvatar = getPlayerRow('player-2').querySelector('[data-testid="player-avatar"]');
        expect(aliceAvatar?.textContent).toBe('A');
        expect(bobAvatar?.textContent).toBe('B');
        expect(aliceAvatar).toHaveAttribute('aria-hidden', 'true');
    });

    it('summarises the ready count in a heading chip that turns success when everyone is ready', () => {
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

        const chip = screen.getByTestId('lobby-ready-summary');
        expect(chip.textContent).toBe('Ready: 1/2');
        expect(chip).toHaveAttribute('data-ch-badge-variant', 'neutral');

        // Everyone ready → the chip flips to the success variant.
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [
                { playerId: 'player-1', displayName: 'Alice', ready: true },
                { playerId: 'player-2', displayName: 'Bob', ready: true },
            ],
        };
        rerender(<PlayerList />);

        const readyChip = screen.getByTestId('lobby-ready-summary');
        expect(readyChip.textContent).toBe('Ready: 2/2');
        expect(readyChip).toHaveAttribute('data-ch-badge-variant', 'success');
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

        // Alice's ready control is an icon toggle carrying the check glyph and
        // reflecting her ready state via aria-pressed.
        const aliceToggle = aliceRow.querySelector('[data-testid="ready-toggle"]');
        expect(aliceToggle).toBeTruthy();
        expect(aliceToggle).toHaveAttribute('aria-pressed', 'true');
        expect(aliceToggle).toHaveAccessibleName('Toggle Ready');
        expect(aliceToggle?.querySelector('svg[data-ch-icon="check"]')).not.toBeNull();

        // The toggle IS the local ready indicator — no redundant ready badge
        // next to it (the badge stays for remote players only).
        expect(aliceRow.querySelector('[data-ch-badge-variant="success"]')).toBeNull();
        expect(aliceRow.querySelector('[data-ch-badge-variant="warning"]')).toBeNull();
        expect(bobRow.querySelector('[data-ch-badge-variant="warning"]')).not.toBeNull();

        // Bob should NOT have a ready toggle
        expect(bobRow.querySelector('[data-testid="ready-toggle"]')).toBeNull();
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
        const toggleButton = aliceRow.querySelector('[data-testid="ready-toggle"]');

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

        const toggleButton = screen.getByTestId('ready-toggle');
        expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
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

        const toggleButton = screen.getByTestId('ready-toggle');
        expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
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

        // Bob's row should have (You) indicator and the icon ready toggle
        const bobRow = getPlayerRow('player-2');
        expect(bobRow.textContent).toContain('(You)');

        const bobToggleButton = bobRow.querySelector('[data-testid="ready-toggle"]');
        expect(bobToggleButton).toBeTruthy();

        // Alice's row should NOT have (You) indicator or toggle button
        const aliceRow = getPlayerRow('player-1');
        expect(aliceRow.textContent).not.toContain('(You)');
        expect(aliceRow.querySelector('[data-testid="ready-toggle"]')).toBeNull();

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
        expect(screen.queryAllByTestId('ready-toggle').length).toBe(0);
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

    it('disables the ready toggle while an update is in flight', () => {
        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: false }],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={vi.fn()} isTogglePending />);

        expect(screen.getByTestId('ready-toggle')).toBeDisabled();
    });

    it('renders game-overridden heading and control labels (token-driven)', () => {
        const onToggleReady = vi.fn();

        mockLobbyState = {
            info: {
                sessionId: 'session-1',
                hostId: 'player-1',
                gameId: 'tactics',
            },
            players: [{ playerId: 'player-1', displayName: 'Alice', ready: false }],
        };

        render(<PlayerList localPlayerId="player-1" onToggleReady={onToggleReady} />, {
            'engine.lobby.playersHeading': 'Seats ({n})',
            'engine.lobby.readySummary': 'Armed {ready} of {total}',
            'engine.lobby.toggleReady': 'I am ready',
            'engine.lobby.you': '(Me)',
        });

        expect(screen.getByText('Seats (1)')).toBeTruthy();
        expect(screen.getByTestId('lobby-ready-summary').textContent).toBe('Armed 0 of 1');
        const aliceRow = getPlayerRow('player-1');
        expect(aliceRow.textContent).toContain('(Me)');
        // The icon toggle carries its game-overridden label as accessible name.
        expect(screen.getByTestId('ready-toggle')).toHaveAccessibleName('I am ready');
    });
});
