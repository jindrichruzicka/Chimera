'use client';

import React from 'react';
import { resolveGameResultOutcome } from '@chimera/shared/game-screen-contract.js';
import type {
    GameResultBannerProps,
    GameResultOutcome,
} from '@chimera/shared/game-screen-contract.js';
import { Card } from '@chimera/renderer/components/ui/index.js';
import styles from './TacticsGameResultBanner.module.css';

const OUTCOME_ICONS = {
    win: '🏆',
    loss: '⚔️',
    draw: '⚖️',
    unknown: '🏁',
} as const satisfies Readonly<Record<GameResultOutcome, string>>;

const OUTCOME_ICON_LABELS = {
    win: 'Victory',
    loss: 'Defeat',
    draw: 'Draw',
    unknown: 'Concluded',
} as const satisfies Readonly<Record<GameResultOutcome, string>>;

function resolveTacticsResultMessage({ gameResult, localPlayerId }: GameResultBannerProps): string {
    if (gameResult.winnerIds.length === 0) {
        return 'Stalemate';
    }
    if (localPlayerId === undefined) {
        return 'Battle Concluded';
    }
    return gameResult.winnerIds.includes(localPlayerId) ? 'Tactical Victory' : 'Tactical Defeat';
}

export function TacticsGameResultBanner(props: GameResultBannerProps): React.ReactElement {
    const outcome = resolveGameResultOutcome(props.gameResult, props.localPlayerId);

    return (
        <div
            data-testid="game-result-banner"
            data-game-result-outcome={outcome}
            role="status"
            className={styles['overlay']}
        >
            <Card
                className={styles['card']}
                data-testid="game-result-card"
                elevation="md"
                padding="lg"
                surface="raised"
            >
                <span
                    data-testid="game-result-icon"
                    role="img"
                    aria-label={OUTCOME_ICON_LABELS[outcome]}
                    className={styles['icon']}
                >
                    {OUTCOME_ICONS[outcome]}
                </span>
                <p className={styles['text']} data-testid="game-result-text">
                    {resolveTacticsResultMessage(props)}
                </p>
                <p className={styles['hint']} data-testid="game-result-hint">
                    Press Enter to continue
                </p>
            </Card>
        </div>
    );
}

export default TacticsGameResultBanner;
