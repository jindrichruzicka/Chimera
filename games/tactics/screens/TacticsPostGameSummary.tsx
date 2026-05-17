'use client';

import React from 'react';
import {
    resolveGameResultOutcome,
    type GameScreenProps,
    type GameResultOutcome,
} from '@chimera/shared/game-screen-contract.js';

const summaryContainerStyle: React.CSSProperties = {
    display: 'grid',
    gap: 'var(--ch-space-sm)',
    justifyItems: 'start',
    alignContent: 'start',
    padding: 'var(--ch-space-md)',
    border: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
    background: 'var(--ch-color-surface-raised)',
    boxShadow: 'var(--ch-shadow-md)',
};

const headingStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--ch-font-size-xl)',
    fontWeight: 700,
    color: 'var(--ch-color-text-primary)',
};

const detailsStyle: React.CSSProperties = {
    margin: 0,
    color: 'var(--ch-color-text-secondary)',
    fontSize: 'var(--ch-font-size-md)',
};

function resolveSummaryMessage(outcome: GameResultOutcome): string {
    switch (outcome) {
        case 'win':
            return 'Mission accomplished. Your formation controls the field.';
        case 'loss':
            return 'Operation failed. Regroup and prepare a new strategy.';
        case 'draw':
            return 'No decisive winner. Tactical parity achieved.';
        default:
            return 'Game completed. Final battlefield report is available.';
    }
}

function resolveOutcome(
    snapshot: GameScreenProps['snapshot'],
    localPlayerId?: GameScreenProps['localPlayerId'],
): GameResultOutcome {
    if (snapshot.gameResult === null) {
        return 'unknown';
    }
    return resolveGameResultOutcome(snapshot.gameResult, localPlayerId);
}

export function TacticsPostGameSummary({
    snapshot,
    localPlayerId,
}: GameScreenProps): React.ReactElement {
    const outcome = resolveOutcome(snapshot, localPlayerId);

    return (
        <section
            data-testid="post-game-summary"
            data-outcome={outcome}
            style={summaryContainerStyle}
        >
            <h2 style={headingStyle}>Post-Game Summary</h2>
            <p style={detailsStyle}>{resolveSummaryMessage(outcome)}</p>
        </section>
    );
}

export default TacticsPostGameSummary;
