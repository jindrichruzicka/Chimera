'use client';

// renderer/components/debug/TimelinePanel.tsx
//
// Inspector Timeline panel (§4.12 — Runtime Debug Layer, F47 T8, #697).
// Scrollable tick list backed by `listTicks()`, with ring-buffered ticks
// highlighted (O(1) snapshot retrieval) and a live mode fed by `LIVE_TICK`
// pushes. The live subscription runs for the panel's lifetime; `liveMode`
// gates only the follow-the-newest auto-scroll, so pausing never stops the
// timeline from growing.
//
// Known limitation: rows appended from live pushes are marked
// `inRingBuffer: true`, and older rows' flags go stale as the buffer evicts
// behind them; only a fresh `listTicks()` (remount) re-syncs the flags.

import React, { useEffect, useRef, useState } from 'react';
import type { ChimeraDebugApi, TickEntry } from '@chimera/electron/preload/debug-api-types.js';
import { Badge } from '../ui/Badge';
import { Caption } from '../ui/Caption';
import { ScrollArea } from '../ui/ScrollArea';
import { Spinner } from '../ui/Spinner';
import { ToggleButton } from '../ui/ToggleButton';
import { acquireLiveSubscription } from './liveSubscription';
import styles from './TimelinePanel.module.css';

export interface TimelinePanelProps {
    readonly api: ChimeraDebugApi;
    readonly selectedTick: number | null;
    readonly liveMode: boolean;
    /** Row click; the panel also pauses live mode so the selection sticks. */
    readonly onSelectTick: (tick: number) => void;
    readonly onLiveModeChange: (live: boolean) => void;
    /** Fired once with the initial `listTicks()` result (page defaults selection). */
    readonly onTicksLoaded: (ticks: readonly TickEntry[]) => void;
}

type LoadStatus =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready' }
    | { readonly kind: 'error'; readonly message: string };

/** Scroll positions this close to the bottom still count as "pinned". */
const SCROLL_EPSILON_PX = 4;

/**
 * Union of the backfilled list and live-appended rows, ascending by tick.
 * Backfill entries win on collision — they carry action metadata that a
 * live push (tick number only) cannot provide.
 */
function mergeTicks(
    backfill: readonly TickEntry[],
    existing: readonly TickEntry[],
): readonly TickEntry[] {
    const byTick = new Map<number, TickEntry>();
    for (const entry of existing) {
        byTick.set(entry.tick, entry);
    }
    for (const entry of backfill) {
        byTick.set(entry.tick, entry);
    }
    return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export function TimelinePanel({
    api,
    selectedTick,
    liveMode,
    onSelectTick,
    onLiveModeChange,
    onTicksLoaded,
}: TimelinePanelProps): React.ReactElement {
    const [status, setStatus] = useState<LoadStatus>({ kind: 'loading' });
    const [ticks, setTicks] = useState<readonly TickEntry[]>([]);
    const listRef = useRef<HTMLUListElement | null>(null);

    useEffect(() => {
        let active = true;

        // Listener first so no push can slip through the subscribe gap; live
        // rows landing before the backfill resolves are merged tick-wise.
        const unsubscribe = api.onLiveTick((event) => {
            if (!active) {
                return;
            }
            setTicks((prev) =>
                prev.some((entry) => entry.tick === event.tick)
                    ? prev
                    : mergeTicks([], [...prev, { tick: event.tick, inRingBuffer: true }]),
            );
        });
        // Refcounted: the main-side subscription is one slot per window,
        // shared with every other live panel (e.g. Performance).
        const releaseLive = acquireLiveSubscription(api);

        api.listTicks()
            .then((loaded) => {
                if (!active) {
                    return;
                }
                setTicks((prev) => mergeTicks(loaded, prev));
                setStatus({ kind: 'ready' });
                onTicksLoaded(loaded);
            })
            .catch((error: unknown) => {
                if (active) {
                    setStatus({
                        kind: 'error',
                        message: error instanceof Error ? error.message : 'Failed to load ticks',
                    });
                }
            });

        return () => {
            active = false;
            unsubscribe();
            releaseLive();
        };
        // onTicksLoaded is intentionally not a dependency: the subscription
        // must not churn when the parent re-creates the callback.
    }, [api]);

    // Follow the newest tick while live: re-pin whenever a row lands or live
    // mode re-engages. Programmatic scrollTop fires no scroll event, so this
    // never trips the scroll-away pause below.
    const newestTick = ticks.length > 0 ? ticks[ticks.length - 1]?.tick : undefined;
    useEffect(() => {
        if (!liveMode) {
            return;
        }
        const scroller = listRef.current?.closest('[data-ch-scroll-area]');
        if (scroller instanceof HTMLElement) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }, [newestTick, liveMode]);

    function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_EPSILON_PX;
        if (!atBottom && liveMode) {
            onLiveModeChange(false);
        }
    }

    return (
        <div className={styles['root']} data-testid="timeline-panel">
            <div className={styles['toolbar']}>
                <ToggleButton
                    className={styles['liveToggle']}
                    onPressedChange={onLiveModeChange}
                    pressed={liveMode}
                >
                    Live
                </ToggleButton>
            </div>

            {status.kind === 'loading' && <Spinner label="Loading ticks" />}

            {status.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {status.message}
                </p>
            )}

            {status.kind === 'ready' && ticks.length === 0 && (
                <Caption tone="muted">No ticks recorded yet.</Caption>
            )}

            {status.kind === 'ready' && ticks.length > 0 && (
                <ScrollArea
                    aria-label="Timeline ticks"
                    className={styles['scroll']}
                    onScroll={handleScroll}
                >
                    <ul className={styles['list']} ref={listRef}>
                        {ticks.map((entry) => (
                            <TimelineRow
                                entry={entry}
                                key={entry.tick}
                                onSelect={() => {
                                    onSelectTick(entry.tick);
                                    onLiveModeChange(false);
                                }}
                                selected={entry.tick === selectedTick}
                            />
                        ))}
                    </ul>
                </ScrollArea>
            )}
        </div>
    );
}

interface TimelineRowProps {
    readonly entry: TickEntry;
    readonly selected: boolean;
    readonly onSelect: () => void;
}

function TimelineRow({ entry, selected, onSelect }: TimelineRowProps): React.ReactElement {
    const meta = [
        entry.actionType ?? '—',
        entry.playerId,
        entry.turnNumber !== undefined ? `turn ${entry.turnNumber}` : undefined,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <li className={styles['row']}>
            <button
                aria-current={selected ? 'true' : undefined}
                className={styles['rowButton']}
                data-buffered={String(entry.inRingBuffer)}
                data-testid={`timeline-tick-${entry.tick}`}
                onClick={onSelect}
                type="button"
            >
                <span className={styles['tick']}>{entry.tick}</span>
                <span className={styles['meta']}>{meta}</span>
                {entry.inRingBuffer ? <Badge variant="success">buffered</Badge> : null}
            </button>
        </li>
    );
}
