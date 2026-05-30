'use client';

import React from 'react';
import {
    Badge,
    Caption,
    Card,
    Divider,
    Heading,
    Panel,
    type BadgeVariant,
    type CaptionTone,
} from '@chimera/renderer/components/ui/index.js';
import {
    resolveGameResultOutcome,
    type GameScreenProps,
    type GameResultOutcome,
} from '@chimera/shared/game-screen-contract.js';
import styles from './TacticsPostGameSummary.module.css';

interface SummaryCopy {
    readonly badgeLabel: string;
    readonly badgeVariant: BadgeVariant;
    readonly captionTone: CaptionTone;
    readonly heading: string;
    readonly message: string;
}

interface SummaryMetric {
    readonly id: string;
    readonly label: string;
    readonly testId: string;
    readonly value: string;
}

const SUMMARY_COPY = {
    win: {
        badgeLabel: 'Victory',
        badgeVariant: 'success',
        captionTone: 'success',
        heading: 'Tactical Victory',
        message: 'Mission accomplished. Your formation controls the field.',
    },
    loss: {
        badgeLabel: 'Defeat',
        badgeVariant: 'error',
        captionTone: 'error',
        heading: 'Tactical Defeat',
        message: 'Operation failed. Regroup and prepare a new strategy.',
    },
    draw: {
        badgeLabel: 'Stalemate',
        badgeVariant: 'warning',
        captionTone: 'neutral',
        heading: 'Tactical Stalemate',
        message: 'No decisive winner. Tactical parity achieved.',
    },
    unknown: {
        badgeLabel: 'Concluded',
        badgeVariant: 'neutral',
        captionTone: 'muted',
        heading: 'Battle Concluded',
        message: 'Game completed. Final battlefield report is available.',
    },
} as const satisfies Readonly<Record<GameResultOutcome, SummaryCopy>>;

function resolveOutcome(
    snapshot: GameScreenProps['snapshot'],
    localPlayerId?: GameScreenProps['localPlayerId'],
): GameResultOutcome {
    if (snapshot.gameResult === null) {
        return 'unknown';
    }
    return resolveGameResultOutcome(snapshot.gameResult, localPlayerId);
}

function buildSummaryMetrics(snapshot: GameScreenProps['snapshot']): readonly SummaryMetric[] {
    return [
        {
            id: 'final-tick',
            label: 'Final tick',
            testId: 'post-game-summary-final-tick',
            value: String(snapshot.tick),
        },
        {
            id: 'visible-units',
            label: 'Visible units',
            testId: 'post-game-summary-visible-units',
            value: String(Object.keys(snapshot.entities).length),
        },
        {
            id: 'commanders',
            label: 'Commanders',
            testId: 'post-game-summary-commanders',
            value: String(Object.keys(snapshot.players).length),
        },
    ];
}

function SummaryMetricCard({ label, testId, value }: SummaryMetric): React.ReactElement {
    return (
        <Card
            as="article"
            className={styles['metricCard']}
            data-testid={testId}
            elevation="none"
            padding="sm"
            surface="overlay"
        >
            <span className={styles['metricLabel']}>{label}</span>
            <strong className={styles['metricValue']}>{value}</strong>
        </Card>
    );
}

export function TacticsPostGameSummary({
    snapshot,
    localPlayerId,
}: GameScreenProps): React.ReactElement {
    const outcome = resolveOutcome(snapshot, localPlayerId);
    const summary = SUMMARY_COPY[outcome];
    const metrics = buildSummaryMetrics(snapshot);

    return (
        <section className={styles['root']} data-testid="post-game-summary" data-outcome={outcome}>
            <Panel
                className={styles['panel']}
                data-testid="post-game-summary-panel"
                title="Post-Game Summary"
                variant="raised"
            >
                <div className={styles['header']}>
                    <Badge
                        className={styles['badge']}
                        data-testid="post-game-summary-badge"
                        variant={summary.badgeVariant}
                    >
                        {summary.badgeLabel}
                    </Badge>
                    <Heading
                        className={styles['heading']}
                        data-testid="post-game-summary-heading"
                        level={3}
                        size="lg"
                    >
                        {summary.heading}
                    </Heading>
                    <Caption
                        className={styles['message']}
                        data-testid="post-game-summary-message"
                        tone={summary.captionTone}
                    >
                        {summary.message}
                    </Caption>
                </div>
                <Divider className={styles['divider']} orientation="horizontal" />
                <div aria-label="Battlefield metrics" className={styles['metrics']}>
                    {metrics.map((metric) => (
                        <SummaryMetricCard key={metric.id} {...metric} />
                    ))}
                </div>
            </Panel>
        </section>
    );
}

export default TacticsPostGameSummary;
