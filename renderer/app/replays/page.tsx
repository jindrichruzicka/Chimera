'use client';

/**
 * Replay Browser (§4.28).
 *
 * Lists saved replays for the active game by the user-entered name (an "Untitled
 * replay" fallback when unnamed). Perspective replays (the player's own point of
 * view) come from `window.__chimera.replay.perspective.list`, which now carries
 * the `name` alongside the opaque path — still no frames or `viewerId` until the
 * replay is opened (Invariant #98 intact: the name is user metadata, not
 * projected state) — and are always shown. Deterministic replays
 * (`window.__chimera.replay.list`, rich metadata) are a debug-only artifact —
 * written to disk by main only in a non-packaged build and never in the packaged
 * production app (Invariants #71/#98), and surfaced here only outside that app
 * (see `deterministicReplayGate`) and marked with a neutral "Deterministic" badge.
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
import type {
    PerspectiveReplayListItem,
    ReplayListItem,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { Badge, Caption, DismissButton, Modal } from '../../components/ui';
import { REPLAYS_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { useReplayApi } from '../../hooks/useReplayApi';
import { areDeterministicReplaysVisible } from './deterministicReplayGate';
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
          readonly perspectiveItems: readonly PerspectiveReplayListItem[];
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

/**
 * Compact trailing delete control for a replay row. Rendered as a **sibling** of
 * the open button (a `<button>` may not nest another), so clicking it never
 * triggers the row's open handler. The shared DismissButton owns the
 * ghost-at-rest, danger-on-hover treatment.
 */
function DeleteReplayButton({
    onDelete,
    label,
}: {
    readonly onDelete: () => void;
    readonly label: string;
}): React.ReactElement {
    return (
        <DismissButton
            className={styles['deleteBtn']}
            aria-label={label}
            data-testid="replay-delete-btn"
            onClick={onDelete}
        />
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
    const t = useTranslate();
    const recorded = formatRecordedAt(item.recordedAt);
    // The user-entered name is the row title; unnamed/legacy replays fall back to
    // a localized "Untitled replay".
    const title =
        item.name !== undefined && item.name.length > 0
            ? item.name
            : t(REPLAYS_KEYS.untitledReplay);
    return (
        <li className={styles['rowItem']}>
            <button
                type="button"
                className={styles['row']}
                aria-label={t(REPLAYS_KEYS.openDeterministicAriaLabel, { recorded })}
                data-testid="replay-open-btn"
                onClick={() => onOpen(item.path)}
            >
                {/* Compact, same shape as a perspective row: just the name, with a
                    neutral "Deterministic" badge as the sole distinguishing mark. */}
                <span style={titleRowStyle}>
                    <Badge variant="neutral">{t(REPLAYS_KEYS.deterministicBadge)}</Badge>
                    <span>{title}</span>
                </span>
            </button>
            <DeleteReplayButton
                label={t(REPLAYS_KEYS.deleteDeterministicAriaLabel, { recorded })}
                onDelete={() => onDelete(item.path)}
            />
        </li>
    );
}

function PerspectiveReplayRow({
    item,
    onOpen,
    onDelete,
}: {
    readonly item: PerspectiveReplayListItem;
    readonly onOpen: (path: string) => void;
    readonly onDelete: (path: string) => void;
}): React.ReactElement {
    const t = useTranslate();
    // Show the user-entered name only (no badge, no caption); unnamed/legacy
    // replays fall back to a localized "Untitled replay". The whole row stays
    // clickable to open, and the delete control is a sibling button.
    const title =
        item.name !== undefined && item.name.length > 0
            ? item.name
            : t(REPLAYS_KEYS.untitledReplay);
    return (
        <li className={styles['rowItem']}>
            <button
                type="button"
                className={styles['row']}
                aria-label={t(REPLAYS_KEYS.openPerspectiveAriaLabel, { label: title })}
                data-testid="replay-open-btn"
                onClick={() => onOpen(item.path)}
            >
                <span>{title}</span>
            </button>
            <DeleteReplayButton
                label={t(REPLAYS_KEYS.deletePerspectiveAriaLabel, { label: title })}
                onDelete={() => onDelete(item.path)}
            />
        </li>
    );
}

export default function ReplaysPage(): React.ReactElement {
    const t = useTranslate();
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

    // Deterministic replays are a debug-only artifact — written to disk by main
    // only in a non-packaged build (never in the packaged production app), and
    // surfaced in the browser only outside that app (players just see their own
    // perspective replays). Resolved once at mount.
    const showDeterministic = React.useMemo(() => areDeterministicReplaysVisible(), []);

    // Shared fetch for both replay kinds; the mount effect (with an unmount guard)
    // and the post-delete reload both funnel through it. The deterministic list is
    // skipped entirely when hidden — no IPC round-trip, no rows — so `items` stays
    // empty and the on-disk files are left untouched.
    const fetchReplays = React.useCallback(
        () =>
            Promise.all([
                showDeterministic
                    ? replayApi.list(gameId)
                    : Promise.resolve([] as readonly ReplayListItem[]),
                replayApi.perspective.list(gameId),
            ]),
        [replayApi, gameId, showDeterministic],
    );

    React.useEffect(() => {
        let active = true;
        setState({ status: 'loading' });
        fetchReplays()
            .then(([items, perspectiveItems]) => {
                if (active) {
                    setState({ status: 'loaded', items, perspectiveItems });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({
                        status: 'error',
                        message:
                            error instanceof Error
                                ? error.message
                                : t(REPLAYS_KEYS.loadFailedError),
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [fetchReplays, t]);

    const reloadReplays = React.useCallback(async (): Promise<void> => {
        setState({ status: 'loading' });
        try {
            const [items, perspectiveItems] = await fetchReplays();
            setState({ status: 'loaded', items, perspectiveItems });
        } catch (error: unknown) {
            setState({
                status: 'error',
                message: error instanceof Error ? error.message : t(REPLAYS_KEYS.loadFailedError),
            });
        }
    }, [fetchReplays, t]);

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
            // §4.30: static toast title — carries no replay metadata.
            useToastStore
                .getState()
                .push({ severity: 'success', title: t(REPLAYS_KEYS.deletedToast) });
            await reloadReplays();
        } catch {
            useToastStore
                .getState()
                .push({ severity: 'error', title: t(REPLAYS_KEYS.deleteFailedToast) });
        }
    }, [pendingDelete, replayApi, reloadReplays, t]);

    const isEmpty =
        state.status === 'loaded' &&
        state.items.length === 0 &&
        state.perspectiveItems.length === 0;

    // The page renders as the shared chrome-less Modal; closing (footer button
    // or Escape) routes back to the main menu. The delete-confirm Modal nests
    // inside the body — the overlay stack routes Escape to it first and keeps
    // the page modal's focus trap inert while it is open.
    return (
        <Modal
            open
            actions={[
                {
                    label: t(REPLAYS_KEYS.close),
                    variant: 'secondary',
                    testId: 'replays-close-btn',
                },
            ]}
            data-testid="replays-page"
            onClose={handleClose}
            size="lg"
            title={t(REPLAYS_KEYS.title)}
        >
            {state.status === 'loading' && (
                <div role="status" aria-label={t(REPLAYS_KEYS.loadingAriaLabel)}>
                    {t(REPLAYS_KEYS.loading)}
                </div>
            )}

            {state.status === 'error' && (
                <div className={styles['error']} role="alert">
                    {state.message}
                </div>
            )}

            {isEmpty && (
                <div
                    aria-label={t(REPLAYS_KEYS.emptyAriaLabel)}
                    style={{ paddingTop: 'var(--ch-space-md)' }}
                >
                    <Caption tone="muted">{t(REPLAYS_KEYS.empty)}</Caption>
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
                    {state.perspectiveItems.map((item) => (
                        <PerspectiveReplayRow
                            key={item.path}
                            item={item}
                            onOpen={handleOpenPerspective}
                            onDelete={handleRequestDeletePerspective}
                        />
                    ))}
                </ul>
            )}

            {pendingDelete !== null && (
                <Modal
                    open
                    title={t(REPLAYS_KEYS.deleteConfirmTitle)}
                    onClose={handleCancelDelete}
                    data-testid="replay-delete-dialog"
                    actions={[
                        { label: t(REPLAYS_KEYS.deleteCancel), testId: 'replay-delete-cancel' },
                        {
                            label: t(REPLAYS_KEYS.deleteConfirm),
                            variant: 'danger',
                            testId: 'replay-delete-confirm',
                            onClick: () => {
                                void handleConfirmDelete();
                            },
                        },
                    ]}
                >
                    <Caption tone="muted">{t(REPLAYS_KEYS.deleteConfirmBody)}</Caption>
                </Modal>
            )}
        </Modal>
    );
}
