'use client';

// renderer/components/debug/DiffViewPanel.tsx
//
// Inspector Diff View (§4.12 — Runtime Debug Layer, F47 T9, #698). Pick any
// two recorded ticks and see the flat list of changed paths with
// before/after values plus the added/removed/changed summary, resolved by
// the bridge's structural differ.
//
// The pickers are seeded once from the shared Inspector selection (its tick
// as `toTick`, the entry before it as `fromTick`; the oldest tick has no
// predecessor, so it seeds the first recorded pair instead of a self-diff)
// and are fully user-driven afterwards — the page keeps panels mounted, so
// a later selection change never stomps an in-progress comparison.
//
// The page never unmounts panels, so ticks recorded after the Inspector
// opens only reach the pickers through the Refresh button: it re-fetches
// the tick list, keeps the current pair when both ticks are still
// recorded, and re-seeds when the ring buffer evicted either one.

import React, { useEffect, useRef, useState } from 'react';
import type {
    ChimeraDebugApi,
    DiffEntry,
    SnapshotDiff,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';
import { Badge } from '../ui/Badge';
import { Caption } from '../ui/Caption';
import { IconButton } from '../ui/IconButton';
import { ScrollArea } from '../ui/ScrollArea';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import styles from './DiffViewPanel.module.css';

export interface DiffViewPanelProps {
    readonly api: ChimeraDebugApi;
    /** Shared Inspector selection; seeds the initial `toTick` only. */
    readonly selectedTick: number | null;
}

type TickListState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly ticks: readonly number[] }
    | { readonly kind: 'error'; readonly message: string };

type DiffState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly diff: SnapshotDiff }
    | { readonly kind: 'error'; readonly message: string };

const VALUE_PREVIEW_MAX_CHARS = 80;

const KIND_VARIANT = { added: 'success', removed: 'error', changed: 'warning' } as const;

function valuePreview(entry: DiffEntry, key: 'before' | 'after'): string {
    if (!Object.hasOwn(entry, key)) {
        return '—';
    }
    // FixedPoint state is bigint (Invariant #75) and survives structured-clone
    // IPC, so diff values can carry it; plain JSON.stringify would throw.
    const json =
        JSON.stringify(entry[key], (_jsonKey, value: unknown) =>
            typeof value === 'bigint' ? `${value}n` : value,
        ) ?? 'undefined';
    return json.length > VALUE_PREVIEW_MAX_CHARS
        ? `${json.slice(0, VALUE_PREVIEW_MAX_CHARS)}…`
        : json;
}

export function DiffViewPanel({ api, selectedTick }: DiffViewPanelProps): React.ReactElement {
    const [tickList, setTickList] = useState<TickListState>({ kind: 'loading' });
    const [fromTick, setFromTick] = useState<number | null>(null);
    const [toTick, setToTick] = useState<number | null>(null);
    const [diffState, setDiffState] = useState<DiffState>({ kind: 'idle' });
    const [refreshNonce, setRefreshNonce] = useState(0);

    // The seeding fetch reads whatever the shared selection is when the tick
    // list resolves, without re-seeding on every later selection change.
    const latestSelectedTick = useRef(selectedTick);
    useEffect(() => {
        latestSelectedTick.current = selectedTick;
    }, [selectedTick]);

    // Refresh reads the pair through a ref so picking a tick doesn't re-run
    // the list fetch, yet a refresh still sees the current comparison.
    const latestPair = useRef<{ readonly from: number | null; readonly to: number | null }>({
        from: null,
        to: null,
    });
    useEffect(() => {
        latestPair.current = { from: fromTick, to: toTick };
    }, [fromTick, toTick]);

    useEffect(() => {
        let active = true;
        setTickList({ kind: 'loading' });
        api.listTicks()
            .then((entries) => {
                if (!active) {
                    return;
                }
                // Unresolvable ticks (e.g. the first action's pre-action
                // tick) would only ever produce TickNotAvailableError diffs.
                const ticks = entries
                    .filter((entry) => entry.resolvable)
                    .map((entry) => entry.tick);
                setTickList({ kind: 'ready', ticks });
                if (ticks.length < 2) {
                    return;
                }
                const pair = latestPair.current;
                if (
                    pair.from !== null &&
                    pair.to !== null &&
                    ticks.includes(pair.from) &&
                    ticks.includes(pair.to)
                ) {
                    // The in-progress comparison survived the refresh.
                    return;
                }
                const selected = latestSelectedTick.current;
                const to =
                    selected !== null && ticks.includes(selected)
                        ? selected
                        : ticks[ticks.length - 1]!;
                const toIndex = ticks.indexOf(to);
                if (toIndex > 0) {
                    setFromTick(ticks[toIndex - 1]!);
                    setToTick(to);
                } else {
                    // No predecessor to diff against: seed the first pair.
                    setFromTick(ticks[0]!);
                    setToTick(ticks[1]!);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setTickList({
                        kind: 'error',
                        message:
                            error instanceof Error ? error.message : 'Failed to load tick list',
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [api, refreshNonce]);

    useEffect(() => {
        if (fromTick === null || toTick === null) {
            setDiffState({ kind: 'idle' });
            return undefined;
        }

        let active = true;
        setDiffState({ kind: 'loading' });
        api.diff(fromTick, toTick)
            .then((diff) => {
                if (active) {
                    setDiffState({ kind: 'ready', diff });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setDiffState({
                        kind: 'error',
                        message: error instanceof Error ? error.message : 'Failed to load diff',
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [api, fromTick, toTick]);

    const tickOptions =
        tickList.kind === 'ready'
            ? tickList.ticks.map((tick) => ({ label: String(tick), value: String(tick) }))
            : [];

    return (
        <div className={styles['root']} data-testid="diff-panel">
            <div className={styles['toolbar']}>
                {tickList.kind === 'ready' &&
                    tickList.ticks.length >= 2 &&
                    fromTick !== null &&
                    toTick !== null && (
                        <>
                            <Select
                                label="From tick"
                                onValueChange={(value) => {
                                    setFromTick(Number(value));
                                }}
                                options={tickOptions}
                                value={String(fromTick)}
                            />
                            <Select
                                label="To tick"
                                onValueChange={(value) => {
                                    setToTick(Number(value));
                                }}
                                options={tickOptions}
                                value={String(toTick)}
                            />
                        </>
                    )}
                <IconButton
                    aria-label="Refresh"
                    onClick={() => {
                        setRefreshNonce((nonce) => nonce + 1);
                    }}
                    title="Refresh"
                    variant="secondary"
                >
                    ↻
                </IconButton>
            </div>

            {tickList.kind === 'loading' && <Spinner label="Loading ticks" />}

            {tickList.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {tickList.message}
                </p>
            )}

            {tickList.kind === 'ready' && tickList.ticks.length < 2 && (
                <Caption tone="muted">Need at least two recorded ticks to diff.</Caption>
            )}

            {tickList.kind === 'ready' &&
                tickList.ticks.length >= 2 &&
                fromTick !== null &&
                toTick !== null && (
                    <>
                        {diffState.kind === 'loading' && <Spinner label="Loading diff" />}

                        {diffState.kind === 'error' && (
                            <p className={styles['error']} role="alert">
                                {diffState.message}
                            </p>
                        )}

                        {diffState.kind === 'ready' && (
                            <>
                                <div className={styles['summary']}>
                                    <Badge variant="success">
                                        {`${diffState.diff.summary.added} added`}
                                    </Badge>
                                    <Badge variant="error">
                                        {`${diffState.diff.summary.removed} removed`}
                                    </Badge>
                                    <Badge variant="warning">
                                        {`${diffState.diff.summary.changed} changed`}
                                    </Badge>
                                </div>

                                {diffState.diff.entries.length === 0 ? (
                                    <Caption tone="muted">
                                        {`No differences between tick ${diffState.diff.fromTick} and tick ${diffState.diff.toTick}.`}
                                    </Caption>
                                ) : (
                                    <ScrollArea
                                        aria-label="Diff entries"
                                        className={styles['scroll']}
                                    >
                                        <table className={styles['table']}>
                                            <thead>
                                                <tr>
                                                    <th scope="col">Path</th>
                                                    <th scope="col">Kind</th>
                                                    <th scope="col">Before</th>
                                                    <th scope="col">After</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {diffState.diff.entries.map((entry) => (
                                                    <tr key={`${entry.kind}:${entry.path}`}>
                                                        <td className={styles['path']}>
                                                            {entry.path}
                                                        </td>
                                                        <td>
                                                            <Badge
                                                                variant={KIND_VARIANT[entry.kind]}
                                                            >
                                                                {entry.kind}
                                                            </Badge>
                                                        </td>
                                                        <td className={styles['value']}>
                                                            {valuePreview(entry, 'before')}
                                                        </td>
                                                        <td className={styles['value']}>
                                                            {valuePreview(entry, 'after')}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </ScrollArea>
                                )}
                            </>
                        )}
                    </>
                )}
        </div>
    );
}
