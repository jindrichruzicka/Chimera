// @vitest-environment jsdom

/**
 * games/tactics/shell/TacticsLobbyScreen.test.tsx
 *
 * RTL coverage for the custom Tactics lobby screen: the host gets an editable
 * board-colour select (host-authored), while each player edits only their OWN
 * per-player colour (owner-authored, F53) and sees every other seat's colour
 * read-only. Edits route through the engine-provided setters. Also asserts the
 * roster reflects names, ready state, and the chosen colour swatch.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId, type LobbyState } from '@chimera/electron/preload/api-types.js';
import type { GameLobbyScreenProps } from '@chimera/shared/game-lobby-contract.js';
import { TACTICS_PLAYER_COLOR_HEX } from '../lobby/lobby-setup.js';
import { TacticsLobbyScreen } from './TacticsLobbyScreen.js';

const HOST_ID = playerId('host');
const CLIENT_ID = playerId('p2');

function makeLobbyState(overrides: Partial<LobbyState> = {}): LobbyState {
    return {
        info: { sessionId: 'sess-1', hostId: HOST_ID, gameId: 'tactics' },
        players: [
            { playerId: HOST_ID, displayName: 'Alice', ready: true, attributes: { color: 'blue' } },
            { playerId: CLIENT_ID, displayName: 'Bob', ready: false, attributes: { color: 'red' } },
        ],
        matchSettings: { boardColor: 'navy' },
        ...overrides,
    };
}

function makeProps(overrides: Partial<GameLobbyScreenProps> = {}): GameLobbyScreenProps {
    return {
        lobbyState: makeLobbyState(),
        localPlayerId: HOST_ID,
        isHost: true,
        canStartGame: true,
        pendingAction: null,
        setMatchSetting: vi.fn(),
        setPlayerAttribute: vi.fn(),
        onToggleReady: vi.fn(async () => undefined),
        onStartGame: vi.fn(async () => undefined),
        onLeave: vi.fn(async () => undefined),
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
});

describe('TacticsLobbyScreen', () => {
    it('renders one roster row per player with name, ready badge, and colour swatch', () => {
        render(<TacticsLobbyScreen {...makeProps()} />);

        const rows = screen.getAllByTestId('tactics-lobby-player');
        expect(rows).toHaveLength(2);

        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();

        const aliceRow = rows.find((row) => row.getAttribute('data-player-id') === HOST_ID);
        expect(aliceRow?.getAttribute('data-ready')).toBe('true');
        expect(aliceRow?.querySelector('[data-ch-badge-variant="success"]')?.textContent).toBe(
            'Ready',
        );

        const swatch = screen.getByTestId(`tactics-player-swatch-${HOST_ID}`);
        expect(swatch).toHaveStyle({ backgroundColor: TACTICS_PLAYER_COLOR_HEX['blue'] });
    });

    it('marks the local player with a (You) indicator', () => {
        render(<TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />);
        const bobRow = screen
            .getAllByTestId('tactics-lobby-player')
            .find((row) => row.getAttribute('data-player-id') === CLIENT_ID);
        expect(bobRow?.textContent).toContain('(You)');
    });

    describe('board colour (host-authored)', () => {
        it('gives the host an editable board-colour select that routes to setMatchSetting', () => {
            const setMatchSetting = vi.fn();
            render(<TacticsLobbyScreen {...makeProps({ setMatchSetting })} />);

            const boardSelect = screen.getByTestId('tactics-board-color-select');
            expect(boardSelect).toBeEnabled();
            expect(boardSelect).toHaveValue('navy');

            fireEvent.change(boardSelect, { target: { value: 'stone' } });
            expect(setMatchSetting).toHaveBeenCalledWith('boardColor', 'stone');
        });

        it('renders the board-colour select disabled for a non-host client', () => {
            render(
                <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
            );
            expect(screen.getByTestId('tactics-board-color-select')).toBeDisabled();
        });
    });

    describe('per-player colour (owner-authored)', () => {
        it('lets the local player edit their OWN colour, routing to setPlayerAttribute', () => {
            const setPlayerAttribute = vi.fn();
            // Local player is the host (Alice) editing her own row.
            render(<TacticsLobbyScreen {...makeProps({ setPlayerAttribute })} />);

            const ownSelect = screen.getByTestId(`tactics-player-color-select-${HOST_ID}`);
            expect(ownSelect).toBeEnabled();

            fireEvent.change(ownSelect, { target: { value: 'green' } });
            expect(setPlayerAttribute).toHaveBeenCalledWith(HOST_ID, 'color', 'green');
        });

        it("disables another player's colour select for the local player (even the host)", () => {
            // Local player is the host; Bob's row must be read-only.
            render(<TacticsLobbyScreen {...makeProps()} />);
            expect(screen.getByTestId(`tactics-player-color-select-${CLIENT_ID}`)).toBeDisabled();
        });

        it('lets a non-host client edit their OWN colour (owner-authored, not host-gated)', () => {
            const setPlayerAttribute = vi.fn();
            render(
                <TacticsLobbyScreen
                    {...makeProps({ localPlayerId: CLIENT_ID, isHost: false, setPlayerAttribute })}
                />,
            );

            const ownSelect = screen.getByTestId(`tactics-player-color-select-${CLIENT_ID}`);
            expect(ownSelect).toBeEnabled();

            fireEvent.change(ownSelect, { target: { value: 'amber' } });
            expect(setPlayerAttribute).toHaveBeenCalledWith(CLIENT_ID, 'color', 'amber');
        });

        it("disables a client's view of another player's colour select", () => {
            render(
                <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
            );
            expect(screen.getByTestId(`tactics-player-color-select-${HOST_ID}`)).toBeDisabled();
        });
    });

    describe('lifecycle controls', () => {
        it('invokes onStartGame and onLeave from the action bar', () => {
            const onStartGame = vi.fn(async () => undefined);
            const onLeave = vi.fn(async () => undefined);
            render(<TacticsLobbyScreen {...makeProps({ onStartGame, onLeave })} />);

            fireEvent.click(screen.getByTestId('start-game'));
            fireEvent.click(screen.getByTestId('lobby-leave-btn'));
            expect(onStartGame).toHaveBeenCalledTimes(1);
            expect(onLeave).toHaveBeenCalledTimes(1);
        });

        it('disables Start when the game cannot start', () => {
            render(<TacticsLobbyScreen {...makeProps({ canStartGame: false })} />);
            expect(screen.getByTestId('start-game')).toBeDisabled();
        });

        it('toggles the local player ready state', () => {
            const onToggleReady = vi.fn(async () => undefined);
            render(<TacticsLobbyScreen {...makeProps({ onToggleReady })} />);

            // Local player (Alice/host) is currently ready → toggle requests not-ready.
            fireEvent.click(screen.getByTestId('tactics-ready-toggle'));
            expect(onToggleReady).toHaveBeenCalledWith(false);
        });

        it('renders the ready control as a pressed toggle reflecting the local ready state', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            // Local player (Alice/host) is ready → the toggle is pressed.
            const toggle = screen.getByTestId('tactics-ready-toggle');
            expect(toggle).toHaveAttribute('aria-pressed', 'true');
        });

        it('renders the ready toggle unpressed when the local player is not ready', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            players: [
                                {
                                    playerId: HOST_ID,
                                    displayName: 'Alice',
                                    ready: false,
                                    attributes: { color: 'blue' },
                                },
                                {
                                    playerId: CLIENT_ID,
                                    displayName: 'Bob',
                                    ready: false,
                                    attributes: { color: 'red' },
                                },
                            ],
                        }),
                    })}
                />,
            );

            const toggle = screen.getByTestId('tactics-ready-toggle');
            expect(toggle).toHaveAttribute('aria-pressed', 'false');
        });
    });

    describe('Tactics-specific control layout', () => {
        it('constrains the board-colour select width', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            // The select root (the field container) gets the narrow layout class.
            const boardSelect = screen.getByTestId('tactics-board-color-select');
            const root = boardSelect.closest('[class*="board-color-select"]');
            expect(root).not.toBeNull();
        });

        it('visually hides the redundant per-player colour label', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            // The per-player select keeps its accessible label for a11y but hides it.
            const colorSelect = screen.getByTestId(`tactics-player-color-select-${HOST_ID}`);
            const label = screen.getByText('Alice colour');
            expect(label.className).toContain('labelHidden');
            // Accessible name preserved.
            expect(colorSelect).toHaveAccessibleName('Alice colour');
        });
    });
});
