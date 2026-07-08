'use client';

/**
 * renderer/app/saves/page.tsx — Saves Browser (§4.11, F68 / #824).
 *
 * Pure load/delete browser over the save slots in `saveStore.slots`, rebuilt on
 * the replay-browser pattern (`renderer/app/replays/page.tsx`) so the two
 * browsers read as one design. Saves are created in-game and by autosave —
 * this screen never writes a slot.
 *
 * Row click loads the slot; the page does not navigate on load (the shell
 * navigates when the restored snapshot lands). Deletes are gated behind a
 * confirm Modal; the store refreshes itself through the `onSlotUpdate` push
 * wired by SaveStoreBootstrap, so no refetch happens here.
 *
 * Invariants:
 *   #1 — GameSnapshot never leaves the main process; this page reads only
 *         SaveSlotMeta from saveStore, never raw SaveFile or GameSnapshot.
 *   #4 — The renderer reads state; all writes go through `window.__chimera`.
 *   #74 — Toast titles are static literals carrying no save metadata.
 *   #80/#94 — Engine shell page: no `games/*` or `apps/*` imports; the active
 *         game comes from the `?gameId=` URL param.
 *   #91/#96 — Tokens-only CSS module; UI primitives via the components barrel.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import type { SaveSlotMeta, SlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import { Caption, IconButton, Modal } from '../../components/ui';
import { useSavesApi } from '../../hooks/useSavesApi.js';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useSaveStore } from '../../state/saveStore.js';
import { useToastStore } from '../../state/toastStore.js';
import styles from './page.module.css';

function formatSavedAt(savedAt: number): string {
    const date = new Date(savedAt);
    return Number.isNaN(date.getTime()) ? String(savedAt) : date.toLocaleString();
}

/**
 * Compact trailing delete control for a save row. Rendered as a **sibling** of
 * the load button (a `<button>` may not nest another), so clicking it never
 * triggers the row's load handler. Ghost at rest; the icon shifts to the danger
 * tokens on hover/focus (Invariant #91: tokens only).
 */
function DeleteSaveButton({
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
            data-testid="save-delete-btn"
            onClick={onDelete}
        >
            <span aria-hidden="true">🗑</span>
        </IconButton>
    );
}

function SaveSlotRow({
    slot,
    onLoad,
    onDelete,
}: {
    readonly slot: SaveSlotMeta;
    readonly onLoad: (slotId: SlotId) => void;
    readonly onDelete: (slotId: SlotId) => void;
}): React.ReactElement {
    const title = slot.label ?? slot.slotId;
    return (
        <li className={styles['rowItem']}>
            <button
                type="button"
                className={styles['row']}
                aria-label={`Load ${title}`}
                data-testid="save-load-btn"
                onClick={() => onLoad(slot.slotId)}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--ch-space-xs)',
                    }}
                >
                    <span>{title}</span>
                    <Caption tone="muted">
                        {formatSavedAt(slot.savedAt)} · tick {slot.tick}
                    </Caption>
                </div>
            </button>
            <DeleteSaveButton label={`Delete ${title}`} onDelete={() => onDelete(slot.slotId)} />
        </li>
    );
}

export default function SavesPage(): React.ReactElement {
    const slots = useSaveStore((s) => s.slots);
    const isLoading = useSaveStore((s) => s.isLoading);
    const savesApi = useSavesApi();
    const router = useRouter();
    // Surface load rejections inline (BLOCK-3 wiring rejects when no session is
    // active, load can throw SaveNotFoundError, etc.) so users see what went wrong.
    const [error, setError] = React.useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = React.useState<SlotId | null>(null);

    const handleLoad = React.useCallback(
        (slotId: SlotId): void => {
            setError(null);
            // No navigation here — the shell navigates when the restored
            // snapshot lands. The detail stays in the inline alert (no toast).
            void savesApi.load(slotId).catch((e: unknown) => {
                setError(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
            });
        },
        [savesApi],
    );

    const handleClose = React.useCallback(() => {
        // Return to the main menu, carrying the active `?gameId=` from the URL
        // (resolved fresh, nullable) — main-menu deliberately has no
        // default-game fallback, so never fabricate one.
        const shellGameId = resolveShellGameId(new URLSearchParams(window.location.search));
        router.push(withShellGameId('/main-menu', shellGameId));
    }, [router]);

    const handleRequestDelete = React.useCallback((slotId: SlotId) => {
        setPendingDelete(slotId);
    }, []);

    const handleCancelDelete = React.useCallback(() => {
        setPendingDelete(null);
    }, []);

    const handleConfirmDelete = React.useCallback(async () => {
        if (pendingDelete === null) return;
        const slotId = pendingDelete;
        // Close the dialog up front — the delete runs in the background and the
        // row drops when the store's `onSlotUpdate` push lands.
        setPendingDelete(null);
        try {
            await savesApi.delete(slotId);
            // §4.30: static-literal toast title — carries no save metadata.
            useToastStore.getState().push({ severity: 'success', title: 'Save deleted' });
        } catch {
            useToastStore.getState().push({ severity: 'error', title: 'Delete failed' });
        }
    }, [pendingDelete, savesApi]);

    const isEmpty = !isLoading && slots.length === 0;

    // The page renders as the shared chrome-less Modal; closing (footer button
    // or Escape) routes back to the main menu. The delete-confirm Modal nests
    // inside the body — the overlay stack routes Escape to it first and keeps
    // the page modal's focus trap inert while it is open.
    return (
        <Modal
            open
            actions={[{ label: 'Close', variant: 'secondary', testId: 'saves-close-btn' }]}
            data-testid="saves-page"
            onClose={handleClose}
            size="lg"
            title="Saves"
        >
            {isLoading && (
                <div role="status" aria-label="Loading save slots">
                    Loading…
                </div>
            )}

            {error !== null && (
                <div className={styles['error']} role="alert">
                    {error}
                </div>
            )}

            {isEmpty && (
                <div aria-label="No saves yet" style={{ paddingTop: 'var(--ch-space-md)' }}>
                    <Caption tone="muted">No saves yet.</Caption>
                </div>
            )}

            {!isLoading && !isEmpty && (
                <ul className={styles['list']}>
                    {slots.map((slot) => (
                        <SaveSlotRow
                            key={slot.slotId}
                            slot={slot}
                            onLoad={handleLoad}
                            onDelete={handleRequestDelete}
                        />
                    ))}
                </ul>
            )}

            {pendingDelete !== null && (
                <Modal
                    open
                    title="Delete save?"
                    onClose={handleCancelDelete}
                    data-testid="save-delete-dialog"
                    actions={[
                        { label: 'Cancel', testId: 'save-delete-cancel' },
                        {
                            label: 'Delete',
                            variant: 'danger',
                            testId: 'save-delete-confirm',
                            onClick: () => {
                                void handleConfirmDelete();
                            },
                        },
                    ]}
                >
                    <Caption tone="muted">
                        This save will be permanently deleted. This cannot be undone.
                    </Caption>
                </Modal>
            )}
        </Modal>
    );
}
