'use client';

import React from 'react';
import {
    Badge,
    Button,
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
import type { ReplayExportBridge } from '@chimera/shared/replay-bridge-contract.js';
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

/**
 * Async status for the post-game replay actions. Modelled as a discriminated
 * union so no impossible intermediate state can be represented: the buttons are
 * disabled while `working`, and exactly one of the terminal `saved`/`error`
 * surfaces renders.
 */
type ReplayActionStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'working' }
    | { readonly kind: 'saved' }
    | { readonly kind: 'error'; readonly message: string };

const REPLAY_ACTION_IDLE: ReplayActionStatus = { kind: 'idle' };

const MISSING_BRIDGE_ERROR = 'Chimera replay API not available';

/**
 * The export / open-in-player slice of the Chimera preload replay bridge, read
 * off `globalThis` (≡ `window.__chimera` at runtime). A game screen
 * (`games/<name>/screens/*.tsx`) may import only `simulation/`, `ai/`,
 * `shared/`, and its own files (§3 Module Boundary Table; Invariant #96), so it
 * may not reach the canonical `ReplayAPI` (`electron/*`) nor the `useReplayApi`
 * hook (`renderer/*`); instead it reads the bridge off `globalThis`, typed
 * against the shared {@link ReplayExportBridge} contract — the same pattern the
 * sibling Replays main-menu task uses for `replay.perspective`.
 */
function requireReplayBridge(): ReplayExportBridge {
    const bridge = (globalThis as { __chimera?: { replay?: ReplayExportBridge } }).__chimera
        ?.replay;
    if (bridge === undefined) {
        throw new Error(MISSING_BRIDGE_ERROR);
    }
    return bridge;
}

/**
 * Replay / Save Replay actions (F44 / T8). Mounted only once the match has
 * resolved (`gameResult !== null`), so its `useState` hook runs unconditionally
 * within this component. Replay access reads the preload bridge off `globalThis`
 * (Invariant #96 — no renderer hook/IPC bridge import); feedback is inline,
 * with fixed user-facing copy so raw main-process error text never reaches the
 * UI, because game code may not reach the renderer toast store.
 */
function PostGameReplayActions(): React.ReactElement {
    const [status, setStatus] = React.useState<ReplayActionStatus>(REPLAY_ACTION_IDLE);
    const busy = status.kind === 'working';

    const handleSaveReplay = React.useCallback(async (): Promise<void> => {
        setStatus({ kind: 'working' });
        try {
            await requireReplayBridge().exportCurrentMatch('save');
            setStatus({ kind: 'saved' });
        } catch {
            setStatus({ kind: 'error', message: 'Could not save replay.' });
        }
    }, []);

    const handleReplay = React.useCallback(async (): Promise<void> => {
        setStatus({ kind: 'working' });
        try {
            const bridge = requireReplayBridge();
            // 'view' intent: export only to obtain a stable on-disk path for the
            // player — main suppresses the "Replay saved" toast (§4.30).
            const path = await bridge.exportCurrentMatch('view');
            await bridge.openInPlayer(path);
            // Success navigates to the replay player via the main-pushed
            // `chimera:replay:navigate`; the summary unmounts, so no terminal
            // status is set here.
        } catch {
            setStatus({ kind: 'error', message: 'Could not open replay.' });
        }
    }, []);

    return (
        <div className={styles['actions']} data-testid="post-game-actions">
            <Button
                data-testid="post-game-replay-btn"
                disabled={busy}
                onClick={() => void handleReplay()}
                variant="primary"
            >
                Replay
            </Button>
            <Button
                data-testid="post-game-save-replay-btn"
                disabled={busy}
                onClick={() => void handleSaveReplay()}
                variant="secondary"
            >
                Save Replay
            </Button>
            {status.kind === 'saved' && (
                <Caption
                    className={styles['status']}
                    data-testid="post-game-replay-status"
                    tone="success"
                >
                    Replay saved
                </Caption>
            )}
            {status.kind === 'error' && (
                <Caption
                    className={styles['status']}
                    data-testid="post-game-replay-error"
                    tone="error"
                >
                    {status.message}
                </Caption>
            )}
        </div>
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
                {snapshot.gameResult !== null && <PostGameReplayActions />}
            </Panel>
        </section>
    );
}

export default TacticsPostGameSummary;
