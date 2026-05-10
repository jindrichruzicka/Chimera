// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { playerId } from '@chimera/electron/preload/api-types.js';
import { TacticsMatchResultBanner } from './TacticsMatchResultBanner.js';

afterEach(() => {
    cleanup();
});

describe('TacticsMatchResultBanner', () => {
    it('shows a tactics victory message when the local player won', () => {
        const localPlayerId = playerId('p1');

        render(
            <TacticsMatchResultBanner
                localPlayerId={localPlayerId}
                matchResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('match-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('win');
        expect(screen.getByTestId('match-result-text').textContent).toBe('Tactical Victory');
    });

    it('shows a tactics defeat message when another player won', () => {
        render(
            <TacticsMatchResultBanner
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Tactical Defeat');
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('loss');
    });

    it('shows stalemate when the tactics result has no winners', () => {
        render(
            <TacticsMatchResultBanner
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Stalemate');
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('draw');
    });

    it('shows a neutral tactics message when the viewer is unknown', () => {
        render(<TacticsMatchResultBanner matchResult={{ winnerIds: [playerId('p2')] }} />);

        expect(screen.getByTestId('match-result-text').textContent).toBe('Battle Concluded');
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('unknown');
    });
});
