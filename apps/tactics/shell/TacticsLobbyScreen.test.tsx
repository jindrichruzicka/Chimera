// @vitest-environment jsdom

/**
 * apps/tactics/shell/TacticsLobbyScreen.test.tsx
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
import { act, cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId, type LobbyState } from '@chimera-engine/electron/preload/api-types.js';
import {
    ALLOW_SPECTATORS_SETTING,
    type GameLobbyScreenProps,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { tacticsBundleCs } from './translations/cs.js';
import { tacticsBundleEn } from './translations/en.js';
import { TacticsLobbyScreen } from './TacticsLobbyScreen.js';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

// The lobby screen renders its labels through useTranslate() (throws outside a
// provider). Wrap every render in the English Tactics bundle so `game.tactics.*`
// resolve to the pre-tokenisation text the assertions expect.
function EnProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return <I18nProvider gameOverride={tacticsBundleEn}>{children}</I18nProvider>;
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EnProviders });

const HOST_ID = playerId('host');
const CLIENT_ID = playerId('p2');

// The palette now arrives as the generic `content` prop (loaded from the content
// database in the running app). Mirrors apps/tactics/data/{player,board}-colors.
const TACTICS_CONTENT: GameContent = {
    'player-colors': [
        { id: 'blue', name: 'Blue', hex: '#2563eb' },
        { id: 'red', name: 'Red', hex: '#dc2626' },
        { id: 'green', name: 'Green', hex: '#16a34a' },
        { id: 'amber', name: 'Amber', hex: '#f59e0b' },
    ],
    'board-colors': [
        { id: 'slate', name: 'Slate', hex: '#3f3f46' },
        { id: 'stone', name: 'Stone', hex: '#44403c' },
        { id: 'navy', name: 'Navy', hex: '#1e293b' },
    ],
};

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
        content: TACTICS_CONTENT,
        isHost: true,
        canStartGame: true,
        pendingAction: null,
        setMatchSetting: vi.fn(),
        setPlayerAttribute: vi.fn(),
        addAiPlayer: vi.fn(async () => undefined),
        removeAiPlayer: vi.fn(async () => undefined),
        onToggleReady: vi.fn(async () => undefined),
        onStartGame: vi.fn(async () => undefined),
        onLeave: vi.fn(async () => undefined),
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
});

/** Install a clipboard spy; jsdom leaves `navigator.clipboard` undefined. */
function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    return writeText;
}

describe('TacticsLobbyScreen', () => {
    it('renders the lobby chrome in Czech when the Czech bundle is active', () => {
        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={TACTICS_LANGUAGES}
                locale="cs-CZ"
            >
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] }),
                    })}
                />
            </I18nProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Nastavení bitvy' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Hráči' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Přidat hráče AI' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Odebrat hráče AI 1' })).toBeInTheDocument();
    });

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
        // Blue hex sourced from the content prop (player-colors/blue.json).
        expect(swatch).toHaveStyle({ backgroundColor: '#2563eb' });
    });

    it('marks the local player with a (You) indicator', () => {
        render(<TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />);
        const bobRow = screen
            .getAllByTestId('tactics-lobby-player')
            .find((row) => row.getAttribute('data-player-id') === CLIENT_ID);
        expect(bobRow?.textContent).toContain('(You)');
    });

    it('renders no host/player role badge (removed in the modernized layout)', () => {
        // Host view: the old "Host" role badge is gone.
        const { rerender } = render(<TacticsLobbyScreen {...makeProps()} />);
        expect(screen.queryByText('Host')).not.toBeInTheDocument();

        // Client view: the old "Player" role badge is gone too.
        rerender(
            <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
        );
        expect(screen.queryByText('Player')).not.toBeInTheDocument();
    });

    describe('lobby address sharing (host-only)', () => {
        it('shows the host the joinable lobby address so it can be shared', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            info: {
                                sessionId: '127.0.0.1:7777:abc123',
                                hostId: HOST_ID,
                                gameId: 'tactics',
                            },
                        }),
                    })}
                />,
            );

            expect(screen.getByTestId('lobby-address')).toHaveTextContent('127.0.0.1:7777:abc123');
        });

        it('does not show the lobby address to a non-host client', () => {
            render(
                <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
            );

            expect(screen.queryByTestId('lobby-address')).not.toBeInTheDocument();
            expect(screen.queryByTestId('lobby-address-copy')).not.toBeInTheDocument();
        });

        it('copies the lobby address to the clipboard when the host clicks copy', () => {
            const writeText = stubClipboard();
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            info: {
                                sessionId: '127.0.0.1:7777:abc123',
                                hostId: HOST_ID,
                                gameId: 'tactics',
                            },
                        }),
                    })}
                />,
            );

            fireEvent.click(screen.getByTestId('lobby-address-copy'));
            expect(writeText).toHaveBeenCalledWith('127.0.0.1:7777:abc123');
        });

        it('shows the shared copy icon on the copy affordance, named by its aria-label', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            const copyButton = screen.getByTestId('lobby-address-copy');
            expect(copyButton.querySelector('svg[data-ch-icon="copy"]')).not.toBeNull();
            expect(copyButton).toHaveAccessibleName('Copy lobby address');
            // Borderless (ghost) affordance — a chrome-less icon button.
            expect(copyButton).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        });
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

    describe('commitment scheme (host-authored)', () => {
        it('labels the toggle "Simultaneous turns" with no helper text', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            const toggle = screen.getByTestId('tactics-commitment-scheme-toggle');
            expect(toggle).toHaveAccessibleName('Simultaneous turns');
            // The explanatory helper line was removed to save vertical space.
            expect(screen.queryByText(/act in secret/i)).not.toBeInTheDocument();
        });

        it('gives the host an enabled toggle, off by default, that routes to setMatchSetting', () => {
            const setMatchSetting = vi.fn();
            render(<TacticsLobbyScreen {...makeProps({ setMatchSetting })} />);

            const toggle = screen.getByTestId('tactics-commitment-scheme-toggle');
            expect(toggle).toBeEnabled();
            expect(toggle).not.toBeChecked();

            fireEvent.click(toggle);
            expect(setMatchSetting).toHaveBeenCalledWith('turnMode', 'commitment');
        });

        it('reflects an enabled commitment mode and toggles back to sequential', () => {
            const setMatchSetting = vi.fn();
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        setMatchSetting,
                        lobbyState: makeLobbyState({
                            matchSettings: { boardColor: 'navy', turnMode: 'commitment' },
                        }),
                    })}
                />,
            );

            const toggle = screen.getByTestId('tactics-commitment-scheme-toggle');
            expect(toggle).toBeChecked();

            fireEvent.click(toggle);
            expect(setMatchSetting).toHaveBeenCalledWith('turnMode', 'sequential');
        });

        it('renders the commitment toggle disabled (read-only) for a non-host client', () => {
            render(
                <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
            );
            expect(screen.getByTestId('tactics-commitment-scheme-toggle')).toBeDisabled();
        });
    });

    describe('allow spectators (host-authored)', () => {
        it('labels the toggle "Allow spectators"', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            expect(screen.getByTestId('tactics-allow-spectators-toggle')).toHaveAccessibleName(
                'Allow spectators',
            );
        });

        it('gives the host an enabled toggle, off by default, that routes to setMatchSetting', () => {
            const setMatchSetting = vi.fn();
            render(<TacticsLobbyScreen {...makeProps({ setMatchSetting })} />);

            const toggle = screen.getByTestId('tactics-allow-spectators-toggle');
            expect(toggle).toBeEnabled();
            expect(toggle).not.toBeChecked();

            fireEvent.click(toggle);
            expect(setMatchSetting).toHaveBeenCalledWith(ALLOW_SPECTATORS_SETTING, 'true');
        });

        it('reflects an enabled state and toggles back off', () => {
            const setMatchSetting = vi.fn();
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        setMatchSetting,
                        lobbyState: makeLobbyState({
                            matchSettings: {
                                boardColor: 'navy',
                                [ALLOW_SPECTATORS_SETTING]: 'true',
                            },
                        }),
                    })}
                />,
            );

            const toggle = screen.getByTestId('tactics-allow-spectators-toggle');
            expect(toggle).toBeChecked();

            fireEvent.click(toggle);
            expect(setMatchSetting).toHaveBeenCalledWith(ALLOW_SPECTATORS_SETTING, 'false');
        });

        it('renders the toggle disabled (read-only) for a non-host client', () => {
            render(
                <TacticsLobbyScreen {...makeProps({ localPlayerId: CLIENT_ID, isHost: false })} />,
            );
            expect(screen.getByTestId('tactics-allow-spectators-toggle')).toBeDisabled();
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

    describe('AI players (host-only)', () => {
        it('renders icon-only Add/Remove controls with shared icon glyphs and accessible names', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] }),
                    })}
                />,
            );

            // Icon button: the shared plus glyph, full accessible name carried
            // by aria-label (the decorative Icon carries none).
            const addButton = screen.getByTestId('tactics-add-ai');
            expect(addButton.querySelector('svg[data-ch-icon="plus"]')).not.toBeNull();
            expect(addButton).toHaveAccessibleName('Add AI player');
            // Borderless (ghost) affordance — a chrome-less icon button.
            expect(addButton).toHaveAttribute('data-ch-icon-button-variant', 'ghost');

            // Remove is the shared minus glyph keeping its distinct accessible name.
            const removeButton = screen.getByTestId('tactics-remove-ai-1');
            expect(removeButton.querySelector('svg[data-ch-icon="minus"]')).not.toBeNull();
            expect(removeButton).toHaveAccessibleName('Remove AI Player 1');
            expect(removeButton).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        });

        it('renders an enabled Add-AI button for the host when the lobby is not full', () => {
            // 2 humans + 1 AI = 3 occupants < maxPlayers (4) → not full.
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] }),
                    })}
                />,
            );
            expect(screen.getByTestId('tactics-add-ai')).toBeEnabled();
        });

        it('disables the Add-AI button when humans + AI reach maxPlayers', () => {
            // 2 humans + 2 AI = 4 occupants = maxPlayers (4) → full.
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            agentSlots: [
                                { slotIndex: 1, kind: 'ai' },
                                { slotIndex: 2, kind: 'ai' },
                            ],
                        }),
                    })}
                />,
            );
            expect(screen.getByTestId('tactics-add-ai')).toBeDisabled();
        });

        it('renders AI players in a separate list beneath the human roster with a Remove control', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            agentSlots: [
                                { slotIndex: 1, kind: 'ai' },
                                { slotIndex: 3, kind: 'ai' },
                            ],
                        }),
                    })}
                />,
            );

            const aiRows = screen.getAllByTestId('tactics-lobby-ai-player');
            expect(aiRows).toHaveLength(2);
            expect(aiRows.map((row) => row.getAttribute('data-slot-index'))).toStrictEqual([
                '1',
                '3',
            ]);
            expect(screen.getByTestId('tactics-remove-ai-1')).toBeInTheDocument();
            expect(screen.getByTestId('tactics-remove-ai-3')).toBeInTheDocument();
        });

        it('invokes addAiPlayer when the host clicks Add-AI', async () => {
            const addAiPlayer = vi.fn(async () => undefined);
            render(<TacticsLobbyScreen {...makeProps({ addAiPlayer })} />);

            // `act` flushes the pending-flag reset that runs when the round-trip settles.
            await act(async () => {
                fireEvent.click(screen.getByTestId('tactics-add-ai'));
            });
            expect(addAiPlayer).toHaveBeenCalledTimes(1);
        });

        it('invokes removeAiPlayer with the slot index when the host clicks Remove', async () => {
            const removeAiPlayer = vi.fn(async () => undefined);
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        removeAiPlayer,
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 2, kind: 'ai' }] }),
                    })}
                />,
            );

            await act(async () => {
                fireEvent.click(screen.getByTestId('tactics-remove-ai-2'));
            });
            expect(removeAiPlayer).toHaveBeenCalledWith(2);
        });

        it('gives each Remove button a distinct accessible name', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        lobbyState: makeLobbyState({
                            agentSlots: [
                                { slotIndex: 1, kind: 'ai' },
                                { slotIndex: 3, kind: 'ai' },
                            ],
                        }),
                    })}
                />,
            );

            // Multiple "Remove" buttons must be distinguishable to assistive tech.
            expect(screen.getByRole('button', { name: 'Remove AI Player 1' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Remove AI Player 3' })).toBeInTheDocument();
        });

        it('disables the AI controls while an add round-trip is in flight (no double-submit)', () => {
            // A never-settling promise keeps the action pending so the gate holds.
            const addAiPlayer = vi.fn(() => new Promise<void>(() => undefined));
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        addAiPlayer,
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] }),
                    })}
                />,
            );

            const addButton = screen.getByTestId('tactics-add-ai');
            expect(addButton).toBeEnabled();

            fireEvent.click(addButton);

            // One invocation, and both Add and Remove are now gated.
            expect(addAiPlayer).toHaveBeenCalledTimes(1);
            expect(addButton).toBeDisabled();
            expect(screen.getByTestId('tactics-remove-ai-1')).toBeDisabled();
        });

        it('hides Add/Remove controls for a non-host and shows the AI list read-only', () => {
            render(
                <TacticsLobbyScreen
                    {...makeProps({
                        localPlayerId: CLIENT_ID,
                        isHost: false,
                        lobbyState: makeLobbyState({ agentSlots: [{ slotIndex: 1, kind: 'ai' }] }),
                    })}
                />,
            );

            // The AI roster is still visible to clients...
            expect(screen.getAllByTestId('tactics-lobby-ai-player')).toHaveLength(1);
            // ...but the host-only controls are absent.
            expect(screen.queryByTestId('tactics-add-ai')).not.toBeInTheDocument();
            expect(screen.queryByTestId('tactics-remove-ai-1')).not.toBeInTheDocument();
        });
    });

    describe('lifecycle controls', () => {
        it('renders no Leave/Start action bar of its own — the lobby page Modal footer owns them', () => {
            render(<TacticsLobbyScreen {...makeProps()} />);

            expect(screen.queryByTestId('start-game')).not.toBeInTheDocument();
            expect(screen.queryByTestId('lobby-leave-btn')).not.toBeInTheDocument();
            expect(screen.queryByTestId('lobby-action-bar')).not.toBeInTheDocument();
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
