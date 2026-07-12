'use client';

// renderer/components/debug/ActionLogPanel.tsx
//
// Inspector Action Log panel (§4.12 — Runtime Debug Layer).
// Filterable `ActionHistoryEntry` table: player, action type, and inclusive
// tick range. The log is fetched once (plus on Refresh) and all three
// filters run client-side over that result — the bridge's range parameters
// would split one filter bar across two mechanisms for ring-buffer-scale
// data with no benefit.

import React, { useEffect, useMemo, useState } from 'react';
import type {
    ActionHistoryEntry,
    ChimeraDebugApi,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';
import { Caption } from '../ui/Caption';
import { IconButton } from '../ui/IconButton';
import { ScrollArea } from '../ui/ScrollArea';
import { Spinner } from '../ui/Spinner';
import { TextInput } from '../ui/TextInput';
import styles from './ActionLogPanel.module.css';

export interface ActionLogPanelProps {
    readonly api: ChimeraDebugApi;
    /** Shared Inspector selection; the matching row is visually marked. */
    readonly selectedTick: number | null;
    /** Double-click on a row — navigate to the Snapshot tab at that tick. */
    readonly onNavigateToSnapshot?: (tick: number) => void;
    /** Fires with the unfiltered entries after every successful fetch. */
    readonly onEntriesLoaded?: (entries: readonly ActionHistoryEntry[]) => void;
}

type LogState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly entries: readonly ActionHistoryEntry[] }
    | { readonly kind: 'error'; readonly message: string };

const PAYLOAD_PREVIEW_MAX_CHARS = 80;

/** Empty or non-numeric text means "no bound". */
function parseTickBound(text: string): number | undefined {
    const trimmed = text.trim();
    if (trimmed === '') {
        return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function payloadPreview(payload: Readonly<Record<string, unknown>>): string {
    const json = JSON.stringify(payload);
    return json.length > PAYLOAD_PREVIEW_MAX_CHARS
        ? `${json.slice(0, PAYLOAD_PREVIEW_MAX_CHARS)}…`
        : json;
}

export function ActionLogPanel({
    api,
    selectedTick,
    onNavigateToSnapshot,
    onEntriesLoaded,
}: ActionLogPanelProps): React.ReactElement {
    const [state, setState] = useState<LogState>({ kind: 'loading' });
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [playerFilter, setPlayerFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [fromText, setFromText] = useState('');
    const [toText, setToText] = useState('');

    useEffect(() => {
        let active = true;
        setState({ kind: 'loading' });
        api.getActionLog()
            .then((entries) => {
                if (active) {
                    setState({ kind: 'ready', entries });
                    onEntriesLoaded?.(entries);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({
                        kind: 'error',
                        message:
                            error instanceof Error ? error.message : 'Failed to load action log',
                    });
                }
            });
        return () => {
            active = false;
        };
        // onEntriesLoaded is intentionally not a dependency: the fetch must
        // not re-run when the parent re-creates the callback.
    }, [api, refreshNonce]);

    const entries = state.kind === 'ready' ? state.entries : [];
    const filtered = useMemo(() => {
        const fromTick = parseTickBound(fromText);
        const toTick = parseTickBound(toText);
        const player = playerFilter.trim().toLowerCase();
        const type = typeFilter.trim().toLowerCase();

        return entries.filter((entry) => {
            if (player !== '' && !entry.action.playerId.toLowerCase().includes(player)) {
                return false;
            }
            if (type !== '' && !entry.action.type.toLowerCase().includes(type)) {
                return false;
            }
            if (fromTick !== undefined && entry.tickApplied < fromTick) {
                return false;
            }
            if (toTick !== undefined && entry.tickApplied > toTick) {
                return false;
            }
            return true;
        });
    }, [entries, playerFilter, typeFilter, fromText, toText]);

    return (
        <div className={styles['root']} data-testid="action-log-panel">
            <div className={styles['toolbar']}>
                <TextInput
                    className={styles['filter']}
                    label="Player"
                    onValueChange={setPlayerFilter}
                    placeholder="player id…"
                    value={playerFilter}
                />
                <TextInput
                    className={styles['filter']}
                    label="Action type"
                    onValueChange={setTypeFilter}
                    placeholder="type…"
                    value={typeFilter}
                />
                <TextInput
                    className={styles['tickBound']}
                    inputMode="numeric"
                    label="From tick"
                    onValueChange={setFromText}
                    value={fromText}
                />
                <TextInput
                    className={styles['tickBound']}
                    inputMode="numeric"
                    label="To tick"
                    onValueChange={setToText}
                    value={toText}
                />
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

            {state.kind === 'loading' && <Spinner label="Loading action log" />}

            {state.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {state.message}
                </p>
            )}

            {state.kind === 'ready' && entries.length === 0 && (
                <Caption tone="muted">No actions recorded yet.</Caption>
            )}

            {state.kind === 'ready' && entries.length > 0 && filtered.length === 0 && (
                <Caption tone="muted">No entries match the current filters.</Caption>
            )}

            {state.kind === 'ready' && filtered.length > 0 && (
                <ScrollArea aria-label="Action log entries" className={styles['scroll']}>
                    <table className={styles['table']}>
                        <thead>
                            <tr>
                                <th scope="col">Tick</th>
                                <th scope="col">Turn</th>
                                <th scope="col">Type</th>
                                <th scope="col">Player</th>
                                <th scope="col">Payload</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((entry) => (
                                <tr
                                    data-selected={String(entry.tickApplied === selectedTick)}
                                    data-testid={`action-row-${entry.tickApplied}`}
                                    key={entry.tickApplied}
                                    onDoubleClick={
                                        onNavigateToSnapshot
                                            ? () => onNavigateToSnapshot(entry.tickApplied)
                                            : undefined
                                    }
                                >
                                    <td className={styles['tick']}>{entry.tickApplied}</td>
                                    <td>{entry.turnNumber}</td>
                                    <td className={styles['type']}>{entry.action.type}</td>
                                    <td>{entry.action.playerId}</td>
                                    <td className={styles['payload']}>
                                        {payloadPreview(entry.action.payload)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollArea>
            )}
        </div>
    );
}
