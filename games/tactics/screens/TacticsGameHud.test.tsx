// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import type { GameHudProps } from '@chimera/shared/game-screen-contract.js';
import { TacticsGameHud } from './TacticsGameHud';

afterEach(() => {
    cleanup();
});

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 7,
        viewerId: id,
        players: { [id]: { id } },
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
