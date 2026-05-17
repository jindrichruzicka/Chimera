'use client';

import React from 'react';
import {
    resolveMatchResultOutcome,
    type MatchResultBannerProps,
} from '@chimera/shared/game-screen-contract.js';

const bannerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 'var(--ch-space-md)',
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
};

const messageStyle: React.CSSProperties = {
    padding: 'var(--ch-space-sm) var(--ch-space-md)',
    border: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
    background: 'var(--ch-color-surface-raised)',
    color: 'var(--ch-color-text-primary)',
    boxShadow: 'var(--ch-shadow-md)',
    fontSize: 'var(--ch-font-size-lg)',
    fontWeight: 700,
};

function resolveTacticsResultMessage({
    matchResult,
    localPlayerId,
}: MatchResultBannerProps): string {
    if (matchResult.winnerIds.length === 0) {
        return 'Stalemate';
    }
    if (localPlayerId === undefined) {
        return 'Battle Concluded';
    }
    return matchResult.winnerIds.includes(localPlayerId) ? 'Tactical Victory' : 'Tactical Defeat';
}

export function TacticsMatchResultBanner(props: MatchResultBannerProps): React.ReactElement {
    const outcome = resolveMatchResultOutcome(props.matchResult, props.localPlayerId);

    return (
        <div
            data-testid="game-result-banner"
            data-game-result-outcome={outcome}
            role="status"
            style={bannerStyle}
        >
            <span data-testid="game-result-text" style={messageStyle}>
                {resolveTacticsResultMessage(props)}
            </span>
        </div>
    );
}

export default TacticsMatchResultBanner;
