// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import type { GameHudProps } from '@chimera/shared/game-screen-contract.js';
import { TacticsGameHud } from './TacticsGameHud';

beforeEach(() => {
    // The HUD now mounts the shared ChatPanel, which resolves past its
    // loading/unavailable states via the host chat IPC bridge; stub it.
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            chat: {
                send: vi.fn().mockResolvedValue({ ok: true }),
                onMessage: vi.fn().mockReturnValue(vi.fn()),
                history: vi.fn().mockResolvedValue([]),
                mute: vi.fn(),
                unmute: vi.fn(),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    delete (window as unknown as { __chimera?: unknown }).__chimera;
});

// The viewer's own stamina rides along on the projected player state at runtime
// (#721). The generic `ObservedPlayerState` type is just `{ id }`, so tests cast
// the richer projected shape into `players`, mirroring the board test's
// `ProjectedUnitFixture` approach. `'absent'` models a pre-#721 snapshot with no
// stamina field; `null` models a masked (non-owner) entry.
interface ProjectedPlayerFixture {
    readonly id: PlayerId;
    readonly stamina?: { readonly current: number; readonly max: number } | null;
}

function makeSnapshot(
    overrides: Partial<PlayerSnapshot> = {},
    viewerStamina: { readonly current: number; readonly max: number } | null | 'absent' = {
        current: 2,
        max: 3,
    },
): PlayerSnapshot {
    const id = playerId('p1');
    const player: ProjectedPlayerFixture =
        viewerStamina === 'absent' ? { id } : { id, stamina: viewerStamina };
    const players: Record<string, ProjectedPlayerFixture> = { [id]: player };
    return {
        tick: 7,
        viewerId: id,
        players,
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

function makeHudProps(overrides: Partial<GameHudProps> = {}): GameHudProps {
    return {
        snapshot: makeSnapshot(),
        localPlayerId: playerId('p1'),
        sendAction: vi.fn(),
        tick: 7,
        undoDisabled: false,
        redoDisabled: true,
        endTurnDisabled: false,
        handleUndo: vi.fn(),
        handleRedo: vi.fn(),
        handleEndTurn: vi.fn(),
        ...overrides,
    };
}

describe('TacticsGameHud', () => {
    it('renders the stable game HUD locator surface', () => {
        render(<TacticsGameHud {...makeHudProps({ tick: 12 })} />);

        expect(screen.getByLabelText('Game HUD')).toBeTruthy();
        expect(screen.getByTestId('hud-tick').textContent).toBe('12');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
    });

    it('keeps the in-match chat collapsed by default so it cannot cover the board', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // Collapsed by default: only the toggle is mounted; the ChatPanel is not
        // in the tree, so it cannot occlude board interaction behind it.
        const toggle = screen.getByTestId('tactics-chat-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(screen.queryByTestId('chat-unavailable')).toBeNull();
    });

    it('opens the chat inside the shared Drawer dialog when toggled, as a sibling of the HUD footer', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        fireEvent.click(screen.getByTestId('tactics-chat-toggle'));

        // Tactics mounts the shared ChatPanel inside the shared Drawer primitive,
        // so in-match chat is a proper accessible dialog rather than an ad-hoc div.
        const dialog = await screen.findByRole('dialog', { name: 'Match chat' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');

        const chatPanel = screen.getByTestId('chat-panel');
        expect(dialog.contains(chatPanel)).toBe(true);
        expect(screen.getByTestId('tactics-chat-toggle')).toHaveAttribute('aria-expanded', 'true');

        // The drawer is a sibling of the HUD footer, not nested inside the landmark.
        expect(screen.getByLabelText('Game HUD').contains(chatPanel)).toBe(false);
    });

    it('collapses the chat drawer again when toggled off', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const toggle = screen.getByTestId('tactics-chat-toggle');
        fireEvent.click(toggle);
        expect(await screen.findByRole('dialog', { name: 'Match chat' })).toBeTruthy();

        fireEvent.click(toggle);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes the chat drawer through the shared Drawer dismissal affordances, keeping the toggle in sync', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const toggle = screen.getByTestId('tactics-chat-toggle');
        fireEvent.click(toggle);
        expect(await screen.findByRole('dialog', { name: 'Match chat' })).toBeTruthy();

        // The Drawer owns Escape-to-dismiss; closing it drives the toggle state so
        // the corner button reflects the collapsed chat afterwards.
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders engine controls with shared UI button primitives', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.getByTestId('undo')).toHaveAttribute('data-ch-button-variant', 'secondary');
        expect(screen.getByTestId('redo')).toHaveAttribute('data-ch-button-variant', 'secondary');
        expect(screen.getByTestId('end-turn')).toHaveAttribute('data-ch-button-variant', 'primary');
    });

    it('presents turn status through shared panel and badge primitives', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.getByTestId('tactics-hud-panel')).toHaveAttribute(
            'data-ch-panel-variant',
            'raised',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveAttribute(
            'data-ch-badge-variant',
            'success',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveTextContent('Your turn');
    });

    it("shows the local player's stamina as current/max while it is their turn", () => {
        render(
            <TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({ isMyTurn: true }) })} />,
        );

        expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
        // Active on the viewer's turn — not dimmed.
        expect(screen.getByTestId('hud-stamina-group')).not.toHaveAttribute('data-dimmed');
    });

    it('keeps the stamina readout but dims it when it is not the local turn', () => {
        render(
            <TacticsGameHud
                {...makeHudProps({
                    snapshot: makeSnapshot({ isMyTurn: false }),
                    endTurnDisabled: true,
                })}
            />,
        );

        expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
        expect(screen.getByTestId('hud-stamina-group')).toHaveAttribute('data-dimmed', 'true');
    });

    it('omits the stamina readout when the projected snapshot carries no viewer stamina', () => {
        const { rerender } = render(
            <TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({}, null) })} />,
        );

        // Masked (non-owner) → null stamina: nothing to show.
        expect(screen.queryByTestId('hud-stamina')).toBeNull();
        expect(screen.queryByTestId('hud-stamina-group')).toBeNull();

        // Pre-#721 snapshot with no stamina field at all → still nothing to show.
        rerender(<TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({}, 'absent') })} />);
        expect(screen.queryByTestId('hud-stamina')).toBeNull();
    });

    it('marks the HUD as waiting when it is not the local turn', () => {
        render(
            <TacticsGameHud
                {...makeHudProps({
                    snapshot: makeSnapshot({ isMyTurn: false }),
                    endTurnDisabled: true,
                })}
            />,
        );

        expect(screen.getByTestId('tactics-turn-status')).toHaveAttribute(
            'data-ch-badge-variant',
            'warning',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveTextContent('Waiting');
    });

    it('uses the engine-owned callbacks and disabled states', () => {
        const handleUndo = vi.fn();
        const handleRedo = vi.fn();
        const handleEndTurn = vi.fn();

        render(
            <TacticsGameHud
                {...makeHudProps({
                    undoDisabled: false,
                    redoDisabled: true,
                    endTurnDisabled: false,
                    handleUndo,
                    handleRedo,
                    handleEndTurn,
                })}
            />,
        );

        expect(screen.getByTestId('undo')).not.toBeDisabled();
        expect(screen.getByTestId('redo')).toBeDisabled();
        expect(screen.getByTestId('end-turn')).not.toBeDisabled();

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(handleUndo).toHaveBeenCalledOnce();
        expect(handleRedo).not.toHaveBeenCalled();
        expect(handleEndTurn).toHaveBeenCalledOnce();
    });
});
