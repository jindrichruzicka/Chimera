'use client';

import React from 'react';
import { resolveGameResultOutcome } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type {
    GameResultBannerProps,
    GameResultOutcome,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { Card } from '@chimera-engine/renderer/components/ui';
import { useTranslate, type TranslateFn } from '@chimera-engine/renderer/i18n';
import { RESULT_KEYS } from '../shell/translations/keys.js';
import styles from './TacticsGameResultBanner.module.css';

const OUTCOME_ICONS = {
    win: '🏆',
    loss: '⚔️',
    draw: '⚖️',
    unknown: '🏁',
} as const satisfies Readonly<Record<GameResultOutcome, string>>;

const OUTCOME_ICON_KEYS = {
    win: RESULT_KEYS.iconVictory,
    loss: RESULT_KEYS.iconDefeat,
    draw: RESULT_KEYS.iconDraw,
    unknown: RESULT_KEYS.iconConcluded,
} as const satisfies Readonly<
    Record<GameResultOutcome, (typeof RESULT_KEYS)[keyof typeof RESULT_KEYS]>
>;

function resolveTacticsResultMessage(
    { gameResult, localPlayerId }: GameResultBannerProps,
    t: TranslateFn,
): string {
    if (gameResult.winnerIds.length === 0) {
        return t(RESULT_KEYS.stalemate);
    }
    if (localPlayerId === undefined) {
        return t(RESULT_KEYS.concluded);
    }
    return gameResult.winnerIds.includes(localPlayerId)
        ? t(RESULT_KEYS.victory)
        : t(RESULT_KEYS.defeat);
}

export function TacticsGameResultBanner(props: GameResultBannerProps): React.ReactElement {
    const t = useTranslate();
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
                    aria-label={t(OUTCOME_ICON_KEYS[outcome])}
                    className={styles['icon']}
                >
                    {OUTCOME_ICONS[outcome]}
                </span>
                <p className={styles['text']} data-testid="game-result-text">
                    {resolveTacticsResultMessage(props, t)}
                </p>
                <p className={styles['hint']} data-testid="game-result-hint">
                    {t(RESULT_KEYS.continueHint)}
                </p>
            </Card>
        </div>
    );
}

export default TacticsGameResultBanner;
