// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/electron/preload/api-types.js';
import { TacticsGameResultBanner } from './TacticsGameResultBanner.js';

afterEach(() => {
    cleanup();
});

describe('TacticsGameResultBanner', () => {
    it('shows a hint to press Enter to continue to the summary', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByTestId('game-result-hint').textContent).toBe('Press Enter to continue');
    });

    it('shows a tactics victory message when the local player won', () => {
        const localPlayerId = playerId('p1');

        render(
            <TacticsGameResultBanner
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('win');
        expect(screen.getByTestId('game-result-text').textContent).toBe('Tactical Victory');
    });

    it('renders the result message as status content rather than a document heading', () => {
        const localPlayerId = playerId('p1');

        render(
            <TacticsGameResultBanner
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.queryByRole('heading', { name: 'Tactical Victory' })).toBeNull();
    });

    it('renders the result panel with the shared card primitive', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-surface',
            'raised',
        );
        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-elevation',
            'md',
        );
        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-padding',
            'lg',
        );
    });

    it('shows a tactics defeat message when another player won', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Tactical Defeat');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('loss');
    });

    it('shows stalemate when the tactics result has no winners', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Stalemate');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('draw');
    });

    it('shows a neutral tactics message when the viewer is unknown', () => {
        render(<TacticsGameResultBanner gameResult={{ winnerIds: [playerId('p2')] }} />);

        expect(screen.getByTestId('game-result-text').textContent).toBe('Battle Concluded');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('unknown');
    });

    it('renders an accessible win icon when the local player won', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Victory' })).toBeTruthy();
    });

    it('renders an accessible loss icon when the local player lost', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Defeat' })).toBeTruthy();
    });

    it('renders an accessible draw icon on stalemate', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Draw' })).toBeTruthy();
    });

    it('renders an accessible neutral icon when the viewer is unknown', () => {
        render(<TacticsGameResultBanner gameResult={{ winnerIds: [playerId('p2')] }} />);

        expect(screen.getByRole('img', { name: 'Concluded' })).toBeTruthy();
    });
});
