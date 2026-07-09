'use client';

/**
 * renderer/app/replays/page.tsx — Replay Browser (§4.28, F44 / T6, #660; F44b / T8, #674).
 *
 * Lists saved replays for the active game — **both** deterministic and
 * perspective kinds, each row carrying a type badge. Deterministic replays come
 * from `window.__chimera.replay.list` (rich metadata); perspective replays come
 * from `window.__chimera.replay.perspective.list`, which returns opaque path
 * handles only (their metadata is read on open, Invariant #98).
 *
 * Opening a deterministic replay calls `openInPlayer`, which main answers with a
 * `navigate` push handled app-wide by `ReplayNavigationBridge`. That shared push
 * is path-only, so perspective rows instead route directly to the player with
 * `?kind=perspective` (the route re-validates the path on open).
 *
 * Engine shell page: imports no `games/*` or `electron/` runtime modules
 * (Invariants #94/#1). All buttons use `<Button>` (Invariant #92) and only
 * design tokens are used for styling (Invariant #91).
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import type { ReplayListItem } from '@chimera-engine/simulation/bridge/api-types.js';
import { Badge, Caption, IconButton, Modal } from '../../components/ui';
import { useReplayApi } from '../../hooks/useReplayApi';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useToastStore } from '../../state/toastStore.js';
import styles from './page.module.css';

/** Which replay surface a pending deletion targets (deterministic vs perspective). */
type ReplayKind = 'deterministic' | 'perspective';

/** The replay a confirm dialog is currently gating for deletion. */
interface PendingDelete {
    readonly path: string;
    readonly kind: ReplayKind;
}

type LoadState =
    | { readonly status: 'loading' }
    | {
          readonly status: 'loaded';
          readonly items: readonly ReplayListItem[];
          readonly perspectivePaths: readonly string[];
      }
    | { readonly status: 'error'; readonly message: string };

const titleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ch-space-sm)',
};

function formatRecordedAt(recordedAt: string): string {
    const date = new Date(recordedAt);
    return Number.isNaN(date.getTime()) ? recordedAt : date.toLocaleString();
}

/** Filename handle shown for a perspective replay (no metadata until opened). */
function perspectiveLabel(path: string): string {
    return path.split('/').pop() ?? path;
}

/**
 * Compact trailing delete control for a replay row. Rendered as a **sibling** of
 * the open button (a `<button>` may not nest another), so clicking it never
 * triggers the row's open handler. Ghost at rest; the icon shifts to the danger
 * tokens on hover/focus (Invariant #91: tokens only).
 */
function DeleteReplayButton({
    onDelete,
    label,
}: {
    readonly onDelete: () => void;
    readonly label: string;
}): React.ReactElement {
    return (
        <IconButton
            variant="ghost"
            className={styles['deleteBtn']}
            aria-label={label}
            data-testid="replay-delete-btn"
            onClick={onDelete}
        >
            <span aria-hidden="true">&times;</span>
        </IconButton>
    );
}

function ReplayRow({
    item,
    onOpen,
    onDelete,
}: {
    readonly item: ReplayListItem;
    readonly onOpen: (path: string) => void;
    readonly onDelete: (path: string) => void;
}): React.ReactElement {
    const recorded = formatRecordedAt(item.recordedAt);
    return (
        <li className={styles['rowItem']}>
            <button
                type="button"
                className={styles['row']}
                aria-label={`Open replay recorded ${recorded}`}
                data-testid="replay-open-btn"
                onClick={() => onOpen(item.path)}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--ch-space-xs)',
                    }}
                >
                    <span style={titleRowStyle}>
                        <Badge variant="neutral">Deterministic</Badge>
                        <span>
                            v{item.gameVersion} · {item.durationTicks} ticks
                        </span>
                    </span>
                    <Caption tone="muted">
                        {recorded} · {item.playerIds.join(', ')}
                    </Caption>
                </div>
            </button>
            <DeleteReplayButton
                label={`Delete replay recorded ${recorded}`}
                onDelete={() => onDelete(item.path)}
            />
        </li>
    );
}

function PerspectiveReplayRow({
    path,
    onOpen,
    onDelete,
}: {
    readonly path: string;
    readonly onOpen: (path: string) => void;
    readonly onDelete: (path: string) => void;
}): React.ReactElement {
    const label = perspectiveLabel(path);
    return (
        <li className={styles['rowItem']}>
            <button
                type="button"
                className={styles['row']}
                aria-label={`Open perspective replay ${label}`}
                data-testid="replay-open-btn"
                onClick={() => onOpen(path)}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--ch-space-xs)',
                    }}
                >
                    <span style={titleRowStyle}>
                        <Badge variant="success">Perspective</Badge>
                        <span>{label}</span>
                    </span>
                    <Caption tone="muted">Single-viewer replay</Caption>
                </div>
            </button>
            <DeleteReplayButton
                label={`Delete perspective replay ${label}`}
                onDelete={() => onDelete(path)}
            />
        </li>
    );
}

export default function ReplaysPage(): React.ReactElement {
    const replayApi = useReplayApi();
    const router = useRouter();
    // Read at render time (not in an effect), so guard the static-prerender pass
    // where `window` is absent — the real query string is read on the client.
    const gameId = React.useMemo(
        () =>
            resolveShellGameId(
                new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''),
            ) ?? 'tactics',
        [],
    );
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });
    const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);

    // Shared fetch for both replay kinds; the mount effect (with an unmount guard)
    // and the post-delete reload both funnel through it.
    const fetchReplays = React.useCallback(
        () => Promise.all([replayApi.list(gameId), replayApi.perspective.list(gameId)]),
        [replayApi, gameId],
    );

    React.useEffect(() => {
        let active = true;
        setState({ status: 'loading' });
        fetchReplays()
            .then(([items, perspectivePaths]) => {
                if (active) {
                    setState({ status: 'loaded', items, perspectivePaths });
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
    }, [fetchReplays]);

    const reloadReplays = React.useCallback(async (): Promise<void> => {
        setState({ status: 'loading' });
        try {
            const [items, perspectivePaths] = await fetchReplays();
            setState({ status: 'loaded', items, perspectivePaths });
        } catch (error: unknown) {
            setState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to load replays',
            });
        }
    }, [fetchReplays]);

    const handleOpenDeterministic = React.useCallback(
        (path: string) => {
            void replayApi.openInPlayer(path);
        },
        [replayApi],
    );

    const handleOpenPerspective = React.useCallback(
        (path: string) => {
            // Trailing slash matches next.config `trailingSlash: true`. The
            // player reads `?path=`/`?kind=` reactively via `useSearchParams`,
            // so the query survives this soft navigation. Carry the active
            // `?gameId=` from the URL onto the player route (resolved fresh, not the
            // page's 'tactics' fallback) so leaving the replay keeps resolving the
            // game's shell/menu instead of dropping to the engine default.
            const target = `/replays/player/?path=${encodeURIComponent(path)}&kind=perspective`;
            const shellGameId = resolveShellGameId(new URLSearchParams(window.location.search));
            router.push(withShellGameId(target, shellGameId));
        },
        [router],
    );

    const handleClose = React.useCallback(() => {
        // Return to the main menu, carrying the active `?gameId=` from the URL
        // (resolved fresh, nullable) so we don't fabricate the page's 'tactics'
        // fallback — main-menu deliberately has no default-game fallback.
        const shellGameId = resolveShellGameId(new URLSearchParams(window.location.search));
        router.push(withShellGameId('/main-menu', shellGameId));
    }, [router]);

    const handleRequestDelete = React.useCallback((path: string, kind: ReplayKind) => {
        setPendingDelete({ path, kind });
    }, []);

    const handleRequestDeleteDeterministic = React.useCallback(
        (path: string) => handleRequestDelete(path, 'deterministic'),
        [handleRequestDelete],
    );

    const handleRequestDeletePerspective = React.useCallback(
        (path: string) => handleRequestDelete(path, 'perspective'),
        [handleRequestDelete],
    );

    const handleCancelDelete = React.useCallback(() => {
        setPendingDelete(null);
    }, []);

    const handleConfirmDelete = React.useCallback(async () => {
        if (pendingDelete === null) return;
        const { path, kind } = pendingDelete;
        // Close the dialog up front — the delete + reload run in the background.
        setPendingDelete(null);
        try {
            await (kind === 'perspective'
                ? replayApi.perspective.delete(path)
                : replayApi.delete(path));
            // §4.30: static-literal toast title — carries no replay metadata.
            useToastStore.getState().push({ severity: 'success', title: 'Replay deleted' });
            await reloadReplays();
        } catch {
            useToastStore.getState().push({ severity: 'error', title: 'Delete failed' });
        }
    }, [pendingDelete, replayApi, reloadReplays]);

    const isEmpty =
        state.status === 'loaded' &&
        state.items.length === 0 &&
        state.perspectivePaths.length === 0;

    // The page renders as the shared chrome-less Modal; closing (footer button
    // or Escape) routes back to the main menu. The delete-confirm Modal nests
    // inside the body — the overlay stack routes Escape to it first and keeps
    // the page modal's focus trap inert while it is open.
    return (
        <Modal
            open
            actions={[{ label: 'Close', variant: 'secondary', testId: 'replays-close-btn' }]}
            data-testid="replays-page"
            onClose={handleClose}
            size="lg"
            title="Replays"
        >
            {state.status === 'loading' && (
                <div role="status" aria-label="Loading replays">
                    Loading…
                </div>
            )}

            {state.status === 'error' && (
                <div className={styles['error']} role="alert">
                    {state.message}
                </div>
            )}

            {isEmpty && (
                <div aria-label="No replays saved yet" style={{ paddingTop: 'var(--ch-space-md)' }}>
                    <Caption tone="muted">No replays saved yet.</Caption>
                </div>
            )}

            {state.status === 'loaded' && !isEmpty && (
                <ul className={styles['list']}>
                    {state.items.map((item) => (
                        <ReplayRow
                            key={item.path}
                            item={item}
                            onOpen={handleOpenDeterministic}
                            onDelete={handleRequestDeleteDeterministic}
                        />
                    ))}
                    {state.perspectivePaths.map((path) => (
                        <PerspectiveReplayRow
                            key={path}
                            path={path}
                            onOpen={handleOpenPerspective}
                            onDelete={handleRequestDeletePerspective}
                        />
                    ))}
                </ul>
            )}

            {pendingDelete !== null && (
                <Modal
                    open
                    title="Delete replay?"
                    onClose={handleCancelDelete}
                    data-testid="replay-delete-dialog"
                    actions={[
                        { label: 'Cancel', testId: 'replay-delete-cancel' },
                        {
                            label: 'Delete',
                            variant: 'danger',
                            testId: 'replay-delete-confirm',
                            onClick: () => {
                                void handleConfirmDelete();
                            },
                        },
                    ]}
                >
                    <Caption tone="muted">
                        This replay will be permanently deleted. This cannot be undone.
                    </Caption>
                </Modal>
            )}
        </Modal>
    );
}
