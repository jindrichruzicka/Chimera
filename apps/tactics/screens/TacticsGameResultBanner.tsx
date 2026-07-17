'use client';

import React from 'react';
import { resolveGameResultOutcome } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type {
    GameResultBannerProps,
    GameResultOutcome,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { Card, Icon } from '@chimera-engine/renderer/components/ui';
import { useTranslate, type TranslateFn } from '@chimera-engine/renderer/i18n';
import { RESULT_KEYS } from '../shell/translations/keys.js';
import styles from './TacticsGameResultBanner.module.css';

// Each outcome maps to its own heraldic emblem in the game.tactics.result-*
// family (contributed via shell/icons.tsx; see Invariant #113). The glyph renders
// game-first through the app-wide IconProvider and inherits the emblem's
// per-outcome `currentColor` — so the shape reads the result before the colour.
const OUTCOME_ICON_NAMES = {
    win: 'game.tactics.result-victory',
    loss: 'game.tactics.result-defeat',
    draw: 'game.tactics.result-draw',
    unknown: 'game.tactics.result-concluded',
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
                {/* Four gold registration ticks — the "seal" frame that binds the
                    banner and the post-game summary into one house. Decorative. */}
                <span aria-hidden="true" className={`${styles['tick']} ${styles['tickTl']}`} />
                <span aria-hidden="true" className={`${styles['tick']} ${styles['tickTr']}`} />
                <span aria-hidden="true" className={`${styles['tick']} ${styles['tickBl']}`} />
                <span aria-hidden="true" className={`${styles['tick']} ${styles['tickBr']}`} />
                {/* The emblem is the accessible image host: role="img" + the
                    translated outcome label. The heraldic <Icon> inside is purely
                    decorative, so the outcome is announced exactly once. */}
                <span
                    data-testid="game-result-icon"
                    role="img"
                    aria-label={t(OUTCOME_ICON_KEYS[outcome])}
                    className={styles['emblem']}
                >
                    <Icon name={OUTCOME_ICON_NAMES[outcome]} />
                </span>
                <span aria-hidden="true" className={styles['rule']} />
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
