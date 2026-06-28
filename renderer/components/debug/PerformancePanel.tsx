'use client';

// renderer/components/debug/PerformancePanel.tsx
//
// Inspector Performance panel (§4.12 — Runtime Debug Layer, F47 T9, #698).
// Tick-duration graph plus avg/max tick time, ring-buffer fill, and total
// action count from the bridge's perf aggregates. Live ticks trigger a
// coalesced refetch (one in-flight request, at most one trailing), and only
// the latest aggregate is kept, so memory stays bounded no matter how long
// the session runs; the plotted window is additionally capped client-side.
//
// The live subscription is window-scoped on the main side, so it is held
// through the refcounted `acquireLiveSubscription` — unmounting this panel
// never stops another panel's pushes.

import React, { useEffect, useState } from 'react';
import type {
    ChimeraDebugApi,
    PerfStats,
    TickDurationSample,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';
import { Caption } from '../ui/Caption';
import { ProgressBar } from '../ui/ProgressBar';
import { Spinner } from '../ui/Spinner';
import { acquireLiveSubscription } from './liveSubscription';
import styles from './PerformancePanel.module.css';

export interface PerformancePanelProps {
    readonly api: ChimeraDebugApi;
}

type StatsState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly stats: PerfStats }
    | { readonly kind: 'error'; readonly message: string };

/** Defensive client-side cap; the bridge already bounds `recentSamples`. */
const MAX_PLOT_POINTS = 200;
const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 60;

export function PerformancePanel({ api }: PerformancePanelProps): React.ReactElement {
    const [state, setState] = useState<StatsState>({ kind: 'loading' });

    useEffect(() => {
        let active = true;
        let inFlight = false;
        let dirty = false;

        // Refetches replace the ready state wholesale and never flip back to
        // `loading`, so live updates don't flash the spinner.
        const fetchStats = (): void => {
            if (inFlight) {
                dirty = true;
                return;
            }
            inFlight = true;
            api.getPerfStats()
                .then((stats) => {
                    if (active) {
                        setState({ kind: 'ready', stats });
                    }
                })
                .catch((error: unknown) => {
                    if (active) {
                        setState({
                            kind: 'error',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Failed to load performance stats',
                        });
                    }
                })
                .finally(() => {
                    inFlight = false;
                    if (dirty && active) {
                        dirty = false;
                        fetchStats();
                    }
                });
        };

        // Listener first so no push can slip through the subscribe gap.
        const unsubscribe = api.onLiveTick(() => {
            if (active) {
                fetchStats();
            }
        });
        const releaseLive = acquireLiveSubscription(api);
        fetchStats();

        return () => {
            active = false;
            unsubscribe();
            releaseLive();
        };
    }, [api]);

    return (
        <div className={styles['root']} data-testid="performance-panel">
            {state.kind === 'loading' && <Spinner label="Loading performance stats" />}

            {state.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {state.message}
                </p>
            )}

            {state.kind === 'ready' && (
                <>
                    <dl className={styles['stats']}>
                        <div className={styles['stat']}>
                            <dt>Avg tick</dt>
                            <dd data-testid="stat-avg">
                                {`${state.stats.avgTickDurationMs.toFixed(2)} ms`}
                            </dd>
                        </div>
                        <div className={styles['stat']}>
                            <dt>Max tick</dt>
                            <dd data-testid="stat-max">
                                {`${state.stats.maxTickDurationMs.toFixed(2)} ms`}
                            </dd>
                        </div>
                        <div className={styles['stat']}>
                            <dt>Samples</dt>
                            <dd data-testid="stat-samples">{state.stats.sampleCount}</dd>
                        </div>
                        <div className={styles['stat']}>
                            <dt>Total actions</dt>
                            <dd data-testid="stat-actions">{state.stats.totalActionCount}</dd>
                        </div>
                    </dl>

                    <div className={styles['ringBuffer']}>
                        <ProgressBar
                            label="Ring buffer fill"
                            max={state.stats.ringBufferFill.capacity}
                            value={state.stats.ringBufferFill.used}
                        />
                        <Caption tone="muted">
                            {`${state.stats.ringBufferFill.used} / ${state.stats.ringBufferFill.capacity} snapshots buffered`}
                        </Caption>
                    </div>

                    {state.stats.recentSamples.length === 0 ? (
                        <Caption tone="muted">No tick samples yet.</Caption>
                    ) : (
                        <TickDurationGraph samples={state.stats.recentSamples} />
                    )}
                </>
            )}
        </div>
    );
}

interface TickDurationGraphProps {
    readonly samples: readonly TickDurationSample[];
}

function TickDurationGraph({ samples }: TickDurationGraphProps): React.ReactElement {
    const plotted = samples.slice(-MAX_PLOT_POINTS);
    const maxDuration = Math.max(1, ...plotted.map((sample) => sample.durationMs));
    const points =
        plotted.length === 1
            ? flatSegment(plotted[0]!, maxDuration)
            : plotted
                  .map((sample, index) => {
                      const x = (index / (plotted.length - 1)) * GRAPH_WIDTH;
                      const y = GRAPH_HEIGHT - (sample.durationMs / maxDuration) * GRAPH_HEIGHT;
                      return `${x},${y}`;
                  })
                  .join(' ');

    return (
        <figure className={styles['graph']}>
            <svg
                aria-label="Tick duration graph"
                className={styles['graphSvg']}
                data-testid="perf-graph"
                preserveAspectRatio="none"
                role="img"
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            >
                <polyline
                    className={styles['graphLine']}
                    fill="none"
                    points={points}
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
            <figcaption>
                <Caption tone="muted">
                    {`Last ${plotted.length} ticks — window max ${maxDuration.toFixed(2)} ms`}
                </Caption>
            </figcaption>
        </figure>
    );
}

function flatSegment(sample: TickDurationSample, maxDuration: number): string {
    const y = GRAPH_HEIGHT - (sample.durationMs / maxDuration) * GRAPH_HEIGHT;
    return `0,${y} ${GRAPH_WIDTH},${y}`;
}
