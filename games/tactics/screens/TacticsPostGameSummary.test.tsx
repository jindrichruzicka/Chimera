// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import type { GameScreenProps } from '@chimera/shared/game-screen-contract.js';
import { TacticsPostGameSummary } from './TacticsPostGameSummary.js';

afterEach(() => {
    cleanup();
});

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const localPlayerId = playerId('p1');
    const remotePlayerId = playerId('p2');
    const scoutId = entityId('scout-1');
    const guardId = entityId('guard-1');

    return {
        tick: 24,
        viewerId: localPlayerId,
        players: {
            [localPlayerId]: { id: localPlayerId },
            [remotePlayerId]: { id: remotePlayerId },
        },
        entities: {
            [scoutId]: { id: scoutId },
            [guardId]: { id: guardId },
        },
        phase: gamePhase('ended'),
        events: [{ type: 'tactics:unit_defeated' }],
        gameResult: { winnerIds: [localPlayerId] },
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: false,
        ...overrides,
    };
}

function makeSummaryProps(overrides: Partial<GameScreenProps> = {}): GameScreenProps {
    return {
        snapshot: makeSnapshot(),
        localPlayerId: playerId('p1'),
        sendAction: vi.fn(),
        ...overrides,
    };
}

describe('TacticsPostGameSummary', () => {
    it('renders the summary through shared UI primitives', () => {
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'win');
        expect(screen.getByTestId('post-game-summary-panel')).toHaveAttribute(
            'data-ch-panel-variant',
            'raised',
        );
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'success',
        );
        expect(screen.getByTestId('post-game-summary-heading')).toHaveAttribute(
            'data-ch-heading-size',
            'lg',
        );
        expect(screen.getByTestId('post-game-summary-message')).toHaveAttribute(
            'data-ch-caption-tone',
            'success',
        );
    });

    it('summarizes the winning battlefield state with metric cards', () => {
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByRole('region', { name: 'Post-Game Summary' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Tactical Victory' })).toBeTruthy();
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Victory');

        const tickCard = screen.getByTestId('post-game-summary-final-tick');
        expect(tickCard).toHaveAttribute('data-ch-card-surface', 'overlay');
        expect(within(tickCard).getByText('Final tick')).toBeTruthy();
        expect(within(tickCard).getByText('24')).toBeTruthy();

        const unitsCard = screen.getByTestId('post-game-summary-visible-units');
        expect(unitsCard).toHaveAttribute('data-ch-card-padding', 'sm');
        expect(within(unitsCard).getByText('Visible units')).toBeTruthy();
        expect(within(unitsCard).getByText('2')).toBeTruthy();

        const commandersCard = screen.getByTestId('post-game-summary-commanders');
        expect(within(commandersCard).getByText('Commanders')).toBeTruthy();
        expect(within(commandersCard).getByText('2')).toBeTruthy();
    });

    it('uses defeat, draw, and unknown outcome variants', () => {
        const localPlayerId = playerId('p1');

        const { rerender } = render(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: { winnerIds: [playerId('p2')] } }),
                    localPlayerId,
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'loss');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'error',
        );
        expect(screen.getByRole('heading', { name: 'Tactical Defeat' })).toBeTruthy();

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: { winnerIds: [] } }),
                    localPlayerId,
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'draw');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'warning',
        );
        expect(screen.getByRole('heading', { name: 'Tactical Stalemate' })).toBeTruthy();

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: null }),
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'unknown');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'neutral',
        );
        expect(screen.getByRole('heading', { name: 'Battle Concluded' })).toBeTruthy();
    });
});
