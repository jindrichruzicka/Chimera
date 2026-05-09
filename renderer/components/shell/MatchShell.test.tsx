// renderer/components/shell/MatchShell.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera/electron/preload/api-types.js';
import { MatchShell } from './MatchShell';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MatchShell page object locators', () => {
    it('renders the §13.6 match HUD locator surface', () => {
        render(
            <MatchShell tick={42} canUndo={true} canRedo={false} isGameOver={true}>
                <div>Board slot</div>
            </MatchShell>,
        );

        expect(screen.getByTestId('match-canvas').textContent).toContain('Board slot');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
        expect(screen.getByTestId('game-over-banner')).toBeTruthy();
        expect(screen.getByTestId('hud-tick').textContent).toBe('42');
    });

    it('wires HUD controls through game-agnostic callbacks', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();

        render(
            <MatchShell
                tick={7}
                canUndo={true}
                canRedo={true}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
            />,
        );

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(onUndo).toHaveBeenCalledOnce();
        expect(onRedo).toHaveBeenCalledOnce();
        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('disables end-turn button when canEndTurn is false', () => {
        const onEndTurn = vi.fn();

        render(
            <MatchShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={false}
                onEndTurn={onEndTurn}
            />,
        );

        const endTurnButton = screen.getByTestId('end-turn');
        expect(endTurnButton.hasAttribute('disabled')).toBe(true);

        fireEvent.click(endTurnButton);
        expect(onEndTurn).not.toHaveBeenCalled();
    });

    it('enables end-turn button when canEndTurn is true (or not specified)', () => {
        const onEndTurn = vi.fn();

        render(
            <MatchShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={true}
                onEndTurn={onEndTurn}
            />,
        );

        const endTurnButton = screen.getByTestId('end-turn');
        expect(endTurnButton.hasAttribute('disabled')).toBe(false);

        fireEvent.click(endTurnButton);
        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('shows You won when the local player is a winner', () => {
        const localPlayerId = playerId('p1');

        render(
            <MatchShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={localPlayerId}
                matchResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('game-over-banner')).toBeTruthy();
        expect(screen.getByTestId('match-result-banner')).toBeTruthy();
        expect(screen.getByTestId('match-result-text').textContent).toBe('You won');
    });

    it('shows You lose when the local player is not a winner', () => {
        render(
            <MatchShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('You lose');
    });

    it('shows Draw when matchResult has no winners', () => {
        render(
            <MatchShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Draw');
    });

    it('shows neutral message when localPlayerId is undefined (unknown viewer)', () => {
        render(
            <MatchShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                matchResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Match ended');
    });
});
