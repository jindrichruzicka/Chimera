'use client';

/**
 * renderer/app/replays/page.tsx — Replay Browser (§4.28, F44 / T6, #660).
 *
 * Lists saved replays for the active game via `window.__chimera.replay.list`
 * (through {@link useReplayApi}). Selecting a replay calls `openInPlayer`, which
 * the main process answers with a `navigate` push handled app-wide by
 * `ReplayNavigationBridge` — so this page never routes directly.
 *
 * Engine shell page: imports no `games/*` or `electron/` runtime modules
 * (Invariants #94/#1). All buttons use `<Button>` (Invariant #92) and only
 * design tokens are used for styling (Invariant #91).
 */

import React from 'react';
import type { ReplayListItem } from '@chimera/electron/preload/api-types.js';
import { Button, Caption, Heading } from '../../components/ui';
import { useReplayApi } from '../../hooks/useReplayApi';
import { resolveShellGameId } from '../../shell/resolveMainMenuGameId';

type LoadState =
    | { readonly status: 'loading' }
    | { readonly status: 'loaded'; readonly items: readonly ReplayListItem[] }
    | { readonly status: 'error'; readonly message: string };

const pageStyle: React.CSSProperties = {
    fontFamily: 'var(--ch-font-ui)',
    padding: 'calc(var(--ch-space-md) * 2)',
};

const listStyle: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-md)',
    padding: 'var(--ch-space-sm) var(--ch-space-md)',
    borderBottom: 'var(--ch-border-width-sm) solid var(--ch-color-border-subtle)',
};

const errorStyle: React.CSSProperties = {
    padding: 'calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
    marginBottom: 'var(--ch-space-md)',
    background: 'var(--ch-color-error-surface-muted)',
    border: 'var(--ch-border-width-sm) solid var(--ch-color-error-border-muted)',
    borderRadius: 'var(--ch-radius-sm)',
    color: 'var(--ch-color-error-text-muted)',
};

function formatRecordedAt(recordedAt: string): string {
    const date = new Date(recordedAt);
    return Number.isNaN(date.getTime()) ? recordedAt : date.toLocaleString();
}

function ReplayRow({
    item,
    onOpen,
}: {
    readonly item: ReplayListItem;
    readonly onOpen: (path: string) => void;
}): React.ReactElement {
    return (
        <li style={rowStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ch-space-xs)' }}>
                <span>
                    v{item.gameVersion} · {item.durationTicks} ticks
                </span>
                <Caption tone="muted">
                    {formatRecordedAt(item.recordedAt)} · {item.playerIds.join(', ')}
                </Caption>
            </div>
            <Button
                size="sm"
                variant="primary"
                aria-label={`Open replay recorded ${formatRecordedAt(item.recordedAt)}`}
                onClick={() => onOpen(item.path)}
            >
                Open
            </Button>
        </li>
    );
}

export default function ReplaysPage(): React.ReactElement {
    const replayApi = useReplayApi();
    const gameId = React.useMemo(
        () => resolveShellGameId(new URLSearchParams(window.location.search)) ?? 'tactics',
        [],
    );
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });

    React.useEffect(() => {
        let active = true;
        setState({ status: 'loading' });
        replayApi
            .list(gameId)
            .then((items) => {
                if (active) {
                    setState({ status: 'loaded', items });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({
                        status: 'error',
                        message: error instanceof Error ? error.message : 'Failed to load replays',
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [replayApi, gameId]);

    const handleOpen = React.useCallback(
        (path: string) => {
            void replayApi.openInPlayer(path);
        },
        [replayApi],
    );

    return (
        <main style={pageStyle}>
            <Heading level={1} size="xl">
                Replays
            </Heading>

            {state.status === 'loading' && (
                <div role="status" aria-label="Loading replays">
                    Loading…
                </div>
            )}

            {state.status === 'error' && (
                <div style={errorStyle} role="alert">
                    {state.message}
                </div>
            )}

            {state.status === 'loaded' && state.items.length === 0 && (
                <div aria-label="No replays saved yet" style={{ paddingTop: 'var(--ch-space-md)' }}>
                    <Caption tone="muted">No replays saved yet.</Caption>
                </div>
            )}

            {state.status === 'loaded' && state.items.length > 0 && (
                <ul style={listStyle}>
                    {state.items.map((item) => (
                        <ReplayRow key={item.path} item={item} onOpen={handleOpen} />
                    ))}
                </ul>
            )}
        </main>
    );
}
